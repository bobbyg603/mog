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

const MAX_CONTINUATIONS = parseInt(process.env.MOG_MAX_CONTINUATIONS || "5", 10);
const CONTINUE_PROMPT = `You stopped before finishing. The task is not done yet — there are no commits.
Continue where you left off. Do NOT re-plan. Execute the implementation now and commit when done.`;

export async function runClaude(sandboxName: string, worktreeDir: string, prompt: string): Promise<void> {
  // Initial run
  await execClaude(sandboxName, worktreeDir, ["-p", prompt]);

  // Continue loop: if no commits were made, nudge Claude to keep going
  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    if (hasNewCommits(sandboxName, worktreeDir)) {
      return;
    }
    log.warn(`No commits yet — continuing Claude (attempt ${i + 2}/${MAX_CONTINUATIONS + 1})...`);
    await execClaude(sandboxName, worktreeDir, ["--continue", "-p", CONTINUE_PROMPT]);
  }

  if (!hasNewCommits(sandboxName, worktreeDir)) {
    log.warn("Claude did not produce any commits after all attempts.");
  }
}

function hasNewCommits(sandboxName: string, worktreeDir: string): boolean {
  const result = Bun.spawnSync([
    "docker", "sandbox", "exec",
    "-w", worktreeDir,
    sandboxName,
    "git", "log", "--oneline", "HEAD", "--not", "--remotes", "-1",
  ]);
  return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
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
