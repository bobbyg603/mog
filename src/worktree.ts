import fs from "fs";
import { log } from "./log";

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

  return { defaultBranch: branchProc.stdout.toString().trim() };
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
    // Try using existing branch
    const fallback = Bun.spawnSync(
      ["git", "worktree", "add", worktreeDir, branchName],
      { cwd: repoDir }
    );

    if (fallback.exitCode !== 0) {
      log.die(`Failed to create worktree. Branch '${branchName}' may already exist.`);
    }
  }

  // Init submodules in the worktree if present
  Bun.spawnSync(["git", "submodule", "update", "--init", "--recursive"], { cwd: worktreeDir });

  log.ok(`Worktree created at ${worktreeDir}`);
  return { worktreeDir, branchName };
}
