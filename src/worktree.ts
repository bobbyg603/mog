import fs from "fs";
import { log } from "./log";

export function detectRepo(): string | null {
  const result = Bun.spawnSync(["git", "remote", "get-url", "origin"]);
  if (result.exitCode !== 0) {
    return null;
  }

  const url = result.stdout.toString().trim();

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return null;
}

export function ensureRepo(
  repo: string,
  owner: string,
  repoName: string,
  reposDir: string
): { defaultBranch: string } {
  const repoDir = `${reposDir}/${owner}/${repoName}`;

  if (!fs.existsSync(repoDir)) {
    log.info(`Cloning ${repo} into ${repoDir}...`);
    fs.mkdirSync(`${reposDir}/${owner}`, { recursive: true });

    const clone = Bun.spawnSync(["gh", "repo", "clone", repo, repoDir, "--", "--recurse-submodules"], {
      stdout: "inherit",
      stderr: "inherit",
    });

    if (clone.exitCode !== 0) {
      log.die(`Failed to clone ${repo}.`);
    }
  }

  // Get default branch
  const branchProc = Bun.spawnSync([
    "gh", "repo", "view", repo,
    "--json", "defaultBranchRef",
    "--jq", ".defaultBranchRef.name",
  ]);

  if (branchProc.exitCode !== 0) {
    log.die("Failed to determine default branch.");
  }

  const defaultBranch = branchProc.stdout.toString().trim();

  // Fetch latest remote refs (no checkout/pull — avoids conflicts with existing worktrees)
  log.info(`Fetching latest from origin (${defaultBranch})...`);
  Bun.spawnSync(["git", "fetch", "origin", defaultBranch], { cwd: repoDir });

  return { defaultBranch };
}

export function createWorktree(
  reposDir: string,
  owner: string,
  repoName: string,
  defaultBranch: string,
  issueNum: string,
  issueTitle: string
): { worktreeDir: string; branchName: string } {
  const safeTitle = issueTitle
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  const branchName = `${issueNum}-${safeTitle}`;
  const repoDir = `${reposDir}/${owner}/${repoName}`;
  const worktreeDir = `${reposDir}/${owner}/${repoName}-worktrees/${branchName}`;

  if (fs.existsSync(worktreeDir)) {
    log.warn(`Worktree already exists at ${worktreeDir}, reusing.`);
    return { worktreeDir, branchName };
  }

  log.info(`Creating worktree for branch '${branchName}'...`);

  // Fetch latest
  Bun.spawnSync(["git", "fetch", "origin", defaultBranch], { cwd: repoDir });

  // Try creating branch + worktree
  const result = Bun.spawnSync(
    ["git", "worktree", "add", "-b", branchName, worktreeDir, `origin/${defaultBranch}`],
    { cwd: repoDir }
  );

  if (result.exitCode !== 0) {
    // Branch likely exists from a previous run — delete it and retry from origin
    log.info(`Branch '${branchName}' already exists, recreating from origin/${defaultBranch}...`);
    Bun.spawnSync(["git", "branch", "-D", branchName], { cwd: repoDir });

    const retry = Bun.spawnSync(
      ["git", "worktree", "add", "-b", branchName, worktreeDir, `origin/${defaultBranch}`],
      { cwd: repoDir }
    );

    if (retry.exitCode !== 0) {
      log.die(`Failed to create worktree. Branch '${branchName}' may be in use by another worktree.`);
    }
  }

  // Init submodules in the worktree if present
  Bun.spawnSync(["git", "submodule", "update", "--init", "--recursive"], { cwd: worktreeDir });

  log.ok(`Worktree created at ${worktreeDir}`);
  return { worktreeDir, branchName };
}
