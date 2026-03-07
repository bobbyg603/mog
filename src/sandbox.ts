import fs from "fs";
import { log } from "./log";

interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string;
  is_error?: boolean;
}

const MAX_ITERATIONS = parseInt(
  process.env.MOG_MAX_ITERATIONS || process.env.MOG_MAX_CONTINUATIONS || "30",
  10,
);
const MAX_STALLS = 2;
const PLAN_FILENAME = "IMPLEMENTATION_PLAN.md";

export function readPlanFile(worktreeDir: string): string | null {
  const planPath = `${worktreeDir}/${PLAN_FILENAME}`;
  try {
    return fs.readFileSync(planPath, "utf-8");
  } catch {
    return null;
  }
}

export function getUncheckedItems(planContent: string): string[] {
  const matches = planContent.match(/^- \[ \] .+$/gm);
  return matches || [];
}

export function isPlanComplete(planContent: string): boolean {
  const unchecked = getUncheckedItems(planContent);
  const checked = planContent.match(/^- \[x\] .+$/gim);
  return unchecked.length === 0 && (checked?.length ?? 0) > 0;
}

function getCommitCount(sandboxName: string, worktreeDir: string): number {
  const result = Bun.spawnSync([
    "docker", "sandbox", "exec",
    "-w", worktreeDir,
    sandboxName,
    "git", "rev-list", "HEAD", "--not", "--remotes", "--count",
  ]);
  if (result.exitCode !== 0) return 0;
  return parseInt(result.stdout.toString().trim(), 10) || 0;
}

function cleanupPlanFile(sandboxName: string, worktreeDir: string): void {
  const rmResult = Bun.spawnSync([
    "docker", "sandbox", "exec",
    "-w", worktreeDir,
    sandboxName,
    "git", "rm", "-f", PLAN_FILENAME,
  ]);
  if (rmResult.exitCode !== 0) return;

  Bun.spawnSync([
    "docker", "sandbox", "exec",
    "-w", worktreeDir,
    sandboxName,
    "git", "commit", "-m", "chore: remove implementation plan",
  ]);
}

export async function runClaude(
  sandboxName: string,
  worktreeDir: string,
  planningPrompt: string,
  buildingPromptFn: (remainingItems: string[], planContent: string) => string,
): Promise<void> {
  // Phase 1 — Planning
  log.info("Phase 1: Creating implementation plan...");
  await execClaude(sandboxName, worktreeDir, ["-p", planningPrompt]);

  const planContent = readPlanFile(worktreeDir);
  const unchecked = planContent ? getUncheckedItems(planContent) : [];

  // Fallback: no plan file or no checklist items — single-shot mode
  if (!planContent || unchecked.length === 0) {
    log.warn("No implementation plan created — falling back to single-shot mode.");
    const fallbackPrompt = buildingPromptFn([], "");
    await execClaude(sandboxName, worktreeDir, ["-p", fallbackPrompt]);

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (getCommitCount(sandboxName, worktreeDir) > 0) return;
      log.warn(`No commits yet — continuing Claude (attempt ${i + 2}/${MAX_ITERATIONS + 1})...`);
      await execClaude(sandboxName, worktreeDir, [
        "--continue", "-p",
        "You stopped before finishing. The task is not done yet — there are no commits. Continue where you left off. Do NOT re-plan. Execute the implementation now and commit when done.",
      ]);
    }

    if (getCommitCount(sandboxName, worktreeDir) === 0) {
      log.warn("Claude did not produce any commits after all attempts.");
    }
    return;
  }

  log.ok(`Implementation plan created with ${unchecked.length} task(s).`);

  // Phase 2 — Building loop
  let stallCount = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const currentPlan = readPlanFile(worktreeDir);
    if (!currentPlan) {
      log.warn("Plan file disappeared — stopping build loop.");
      break;
    }

    const remaining = getUncheckedItems(currentPlan);
    if (remaining.length === 0) {
      log.ok("All plan items completed.");
      break;
    }

    const commitsBefore = getCommitCount(sandboxName, worktreeDir);
    const uncheckedBefore = remaining.length;

    log.info(`Iteration ${i + 1}/${MAX_ITERATIONS}: ${remaining[0].replace("- [ ] ", "")}`);
    log.info(`${remaining.length} task(s) remaining.`);

    await execClaude(sandboxName, worktreeDir, ["-p", buildingPromptFn(remaining, currentPlan)]);

    const planAfter = readPlanFile(worktreeDir);
    const uncheckedAfter = planAfter ? getUncheckedItems(planAfter).length : 0;
    const commitsAfter = getCommitCount(sandboxName, worktreeDir);

    if (uncheckedAfter >= uncheckedBefore && commitsAfter <= commitsBefore) {
      stallCount++;
      log.warn(`No progress detected (stall ${stallCount}/${MAX_STALLS}).`);
      if (stallCount >= MAX_STALLS) {
        log.warn("Claude appears stuck — stopping build loop.");
        break;
      }
    } else {
      stallCount = 0;
    }
  }

  // Phase 3 — Cleanup
  cleanupPlanFile(sandboxName, worktreeDir);

  const finalPlan = readPlanFile(worktreeDir);
  if (finalPlan) {
    const finalRemaining = getUncheckedItems(finalPlan);
    if (finalRemaining.length > 0) {
      log.warn(`${finalRemaining.length} task(s) were not completed.`);
    }
  } else {
    log.ok("Plan file cleaned up.");
  }
}

async function execClaude(sandboxName: string, worktreeDir: string, claudeArgs: string[]): Promise<void> {
  const proc = Bun.spawn([
    "docker", "sandbox", "exec",
    "-w", worktreeDir,
    sandboxName,
    "claude", "--dangerously-skip-permissions",
    "--verbose", "--output-format", "stream-json",
    ...claudeArgs,
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Stream and parse JSON lines from stdout
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event: StreamEvent = JSON.parse(line);
        printEvent(event);
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    try {
      const event: StreamEvent = JSON.parse(buffer);
      printEvent(event);
    } catch {
      // Skip
    }
  }

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    if (stderr.trim()) {
      log.warn(stderr.trim());
    }
    log.warn(`Claude Code exited with code ${exitCode}.`);
  }
}

function printEvent(event: StreamEvent): void {
  if (event.type === "assistant" && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        console.log(block.text);
      } else if (block.type === "tool_use" && block.name) {
        const detail = getToolDetail(block.name, block.input);
        log.tool(block.name, detail);
      }
    }
  } else if (event.type === "result") {
    if (event.is_error) {
      log.err(event.result || "Unknown error");
    } else if (event.result) {
      log.done(event.result.slice(0, 200));
    }
  }
}

function getToolDetail(name: string, input?: Record<string, unknown>): string {
  if (!input) return "";

  switch (name) {
    case "Read":
      return String(input.file_path || "");
    case "Edit":
      return String(input.file_path || "");
    case "Write":
      return String(input.file_path || "");
    case "Bash":
      return String(input.description || input.command || "");
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return String(input.pattern || "");
    default:
      return JSON.stringify(input).slice(0, 120);
  }
}
