#!/usr/bin/env bun

import { spawnSync } from "child_process";
import { fetchIssue } from "./github";
import { ensureRepo, createWorktree } from "./worktree";
import { runClaude } from "./sandbox";
import { pushAndCreatePR } from "./github";
import { log } from "./log";

const SANDBOX_NAME = "mog";
const TEMPLATE_TAG = "mog-template:latest";

async function init() {
  log.info("Initializing mog sandbox...");

  const reposDir = getReposDir();
  const exists = await sandboxExists(SANDBOX_NAME);

  if (exists) {
    log.warn(`Sandbox '${SANDBOX_NAME}' already exists.`);
    log.info("Launching sandbox so you can authenticate with /login...");
  } else {
    log.info(`Creating persistent sandbox '${SANDBOX_NAME}'...`);
    log.info(`Workspace: ${reposDir}`);
    const createResult = spawnSync("docker", ["sandbox", "create", "--name", SANDBOX_NAME, "claude", reposDir], {
      stdio: "inherit",
    });
    const createExit = createResult.status;
    if (createExit !== 0) {
      log.die("Failed to create sandbox.");
    }
    log.ok("Sandbox created.");
    console.log();
    log.info("Launching sandbox — authenticate with /login to use your Max subscription.");
    log.info("Once logged in, type /exit or Ctrl+C to return.");
    console.log();
  }

  const runResult = spawnSync("docker", ["sandbox", "run", SANDBOX_NAME], {
    stdio: "inherit",
  });
  const exitCode = runResult.status;
  if (exitCode !== 0) {
    log.die("Sandbox failed to run. Try 'docker sandbox ls' to check its status.");
  }

  // Save sandbox as template so it can be restored after Docker restarts
  log.info("Saving sandbox snapshot (preserves auth across Docker restarts)...");
  const saveResult = spawnSync("docker", ["sandbox", "save", SANDBOX_NAME, TEMPLATE_TAG], {
    stdio: "inherit",
  });
  if (saveResult.status !== 0) {
    log.warn("Failed to save sandbox snapshot. Auth may not persist across Docker restarts.");
  } else {
    log.ok("Snapshot saved.");
  }

  log.ok("mog is ready. Run: mog <owner/repo> <issue_number>");
}

async function main() {
  const args = process.argv.slice(2);

  // Validate dependencies
  for (const cmd of ["gh", "git", "docker"]) {
    const which = Bun.spawnSync(["which", cmd]);
    if (which.exitCode !== 0) {
      log.die(`Required command not found: ${cmd}`);
    }
  }

  // Check docker sandbox is available (may fail if sandbox state is stale after Docker restart)
  const sandboxCheck = Bun.spawnSync(["docker", "sandbox", "ls"]);
  if (sandboxCheck.exitCode !== 0) {
    const recovered = tryRecoverSandbox(getReposDir());
    if (!recovered) {
      log.die("Docker sandbox not available. Make sure Docker Desktop is running and up to date.");
    }
  }

  if (args[0] === "init") {
    await init();
    return;
  }

  if (args.length < 2) {
    console.log("Usage:");
    console.log("  mog init                      — one-time setup (create sandbox & login)");
    console.log("  mog <owner/repo> <issue_num>  — fetch issue, run Claude, open PR");
    console.log();
    console.log("Example:");
    console.log("  mog init");
    console.log("  mog workingdevshero/automate-it 123");
    return;
  }

  const repo = args[0];
  const issueNum = args[1];
  const [owner, repoName] = repo.split("/");

  if (!owner || !repoName) {
    log.die("Invalid repo format. Use: owner/repo");
  }

  // Verify sandbox exists, try to restore from template if missing
  if (!(await sandboxExists(SANDBOX_NAME))) {
    if (!templateExists()) {
      log.die(`Sandbox '${SANDBOX_NAME}' not found. Run 'mog init' first.`);
    }
    log.info("Sandbox missing — restoring from saved snapshot...");
    const reposDir = getReposDir();
    const restored = restoreSandboxFromTemplate(SANDBOX_NAME, reposDir);
    if (!restored) {
      log.die("Failed to restore sandbox from snapshot. Run 'mog init' to recreate.");
    }
    log.ok("Sandbox restored from snapshot (auth preserved).");
  }

  // Fetch issue
  const issue = await fetchIssue(repo, issueNum);
  log.ok(`Issue: ${issue.title}`);

  // Ensure repo & worktree
  const reposDir = getReposDir();
  const { defaultBranch } = await ensureRepo(repo, owner, repoName, reposDir);
  log.info(`Default branch: ${defaultBranch}`);

  const { worktreeDir, branchName } = await createWorktree(
    reposDir, owner, repoName, defaultBranch, issueNum, issue.title
  );

  // Build prompt
  const prompt = buildPrompt(repo, issueNum, issue);

  // Run Claude in sandbox
  log.info("Launching Claude Code in sandbox...");
  log.info(`Branch: ${branchName}`);
  log.info(`Worktree: ${worktreeDir}`);
  console.log();

  await runClaude(SANDBOX_NAME, worktreeDir, prompt);

  // Push and create PR
  await pushAndCreatePR(repo, worktreeDir, branchName, defaultBranch, issueNum, issue);
}

function getReposDir(): string {
  return process.env.MOG_REPOS_DIR || `${process.env.HOME}/mog-repos`;
}

async function sandboxExists(name: string): Promise<boolean> {
  const result = Bun.spawnSync(["docker", "sandbox", "ls"]);
  const output = result.stdout.toString();
  return output.includes(name);
}

function templateExists(): boolean {
  const result = Bun.spawnSync(["docker", "image", "inspect", TEMPLATE_TAG]);
  return result.exitCode === 0;
}

function restoreSandboxFromTemplate(name: string, reposDir: string): boolean {
  const create = spawnSync("docker", ["sandbox", "create", "--template", TEMPLATE_TAG, "--name", name, "claude", reposDir], {
    stdio: "inherit",
  });
  return create.status === 0;
}

function tryRecoverSandbox(reposDir: string): boolean {
  log.warn("Docker sandbox state is stale — attempting recovery...");

  // Clean up stale sandbox
  spawnSync("docker", ["sandbox", "rm", SANDBOX_NAME], { stdio: "ignore" });

  // Check if docker sandbox ls works now
  const check = Bun.spawnSync(["docker", "sandbox", "ls"]);
  if (check.exitCode !== 0) {
    // docker sandbox itself is broken, not just stale state
    return false;
  }

  // If we have a saved template, restore from it
  if (templateExists()) {
    log.info("Restoring sandbox from saved snapshot...");
    const restored = restoreSandboxFromTemplate(SANDBOX_NAME, reposDir);
    if (restored) {
      log.ok("Sandbox restored from snapshot (auth preserved).");
      return true;
    }
  }

  // Recovered docker sandbox command but no template — user needs to mog init
  log.warn("No saved snapshot found. Run 'mog init' to set up the sandbox.");
  return true;
}

function buildPrompt(repo: string, issueNum: string, issue: { title: string; body: string; labels: string }): string {
  return `You are working on GitHub issue #${issueNum} for the repository ${repo}.

## Issue: ${issue.title}

### Description
${issue.body}

### Labels
${issue.labels}

## Instructions
1. Read and understand the codebase structure first.
2. Implement the changes described in the issue above.
3. Write clean, well-documented code that follows the existing project conventions.
4. Add or update tests if applicable.
5. Make sure the code builds/lints without errors if there's a build system.
6. Commit your changes with a clear commit message referencing issue #${issueNum}.

When you are done, make a single commit (or a small, logical set of commits) with
a message like: "fix: <short description> (#${issueNum})"`;
}

main().catch((err) => {
  log.die(err.message);
});
