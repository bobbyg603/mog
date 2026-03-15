import { log } from "./log";

export interface Issue {
  title: string;
  body: string;
  labels: string;
  comments: string;
}

export function fetchIssue(repo: string, issueNum: string): Issue {
  log.info(`Fetching issue #${issueNum} from ${repo}...`);

  const proc = Bun.spawnSync([
    "gh", "issue", "view", issueNum,
    "--repo", repo,
    "--json", "title,body,labels,comments",
  ]);

  if (proc.exitCode !== 0) {
    log.die(`Failed to fetch issue #${issueNum}. Check repo name and issue number.`);
  }

  const json = JSON.parse(proc.stdout.toString());

  const comments = (json.comments || [])
    .map((c: { author: { login: string }; body: string }) => `**@${c.author.login}:** ${c.body}`)
    .join("\n\n");

  return {
    title: json.title,
    body: json.body || "No description provided.",
    labels: json.labels?.map((l: { name: string }) => l.name).join(", ") || "none",
    comments,
  };
}

export function listIssues(repo: string, verbose: boolean): void {
  log.info(`Fetching open issues for ${repo}...`);

  const fields = verbose
    ? "number,title,body,labels,assignees"
    : "number,title";

  const proc = Bun.spawnSync([
    "gh", "issue", "list",
    "--repo", repo,
    "--state", "open",
    "--json", fields,
  ]);

  if (proc.exitCode !== 0) {
    log.die(`Failed to fetch issues for ${repo}. Check the repo name.`);
  }

  const issues = JSON.parse(proc.stdout.toString());

  if (issues.length === 0) {
    log.info("No open issues found.");
    return;
  }

  log.ok(`${issues.length} open issue(s):\n`);

  for (const issue of issues) {
    if (verbose) {
      const labels = issue.labels?.map((l: { name: string }) => l.name).join(", ") || "none";
      const assignees = issue.assignees?.map((a: { login: string }) => a.login).join(", ") || "unassigned";
      console.log(`  #${issue.number}  ${issue.title}`);
      console.log(`         Labels: ${labels}`);
      console.log(`         Assignees: ${assignees}`);
      console.log(`         ${(issue.body || "No description.").split("\n")[0]}`);
      console.log();
    } else {
      console.log(`  #${issue.number}  ${issue.title}`);
    }
  }
}

export interface PRFeedback {
  prNumber: number;
  prUrl: string;
  reviews: string;
}

export function fetchPRFeedback(repo: string, branchName: string): PRFeedback | null {
  const proc = Bun.spawnSync([
    "gh", "pr", "list",
    "--repo", repo,
    "--head", branchName,
    "--state", "open",
    "--json", "number,url",
  ]);

  if (proc.exitCode !== 0) return null;

  const prs = JSON.parse(proc.stdout.toString());
  if (prs.length === 0) return null;

  const prNumber = prs[0].number;
  const prUrl = prs[0].url;

  // Fetch review comments
  const reviewProc = Bun.spawnSync([
    "gh", "pr", "view", String(prNumber),
    "--repo", repo,
    "--json", "reviews,comments",
  ]);

  let reviews = "";
  if (reviewProc.exitCode === 0) {
    const data = JSON.parse(reviewProc.stdout.toString());

    const reviewEntries = (data.reviews || [])
      .filter((r: { body: string }) => r.body?.trim())
      .map((r: { author: { login: string }; state: string; body: string }) =>
        `**@${r.author.login}** (${r.state}):\n${r.body}`
      );

    const commentEntries = (data.comments || [])
      .map((c: { author: { login: string }; body: string }) =>
        `**@${c.author.login}:**\n${c.body}`
      );

    reviews = [...reviewEntries, ...commentEntries].join("\n\n");
  }

  return { prNumber, prUrl, reviews };
}

export function closePR(repo: string, prNumber: number): void {
  const result = Bun.spawnSync([
    "gh", "pr", "close", String(prNumber),
    "--repo", repo,
    "--delete-branch",
  ]);
  if (result.exitCode !== 0) {
    log.warn(`Failed to close PR #${prNumber}.`);
  }
}

export function cleanIssueTitle(title: string): string {
  return title
    .replace(/^(feat|fix|chore|docs|refactor|test|ci|build|perf|style):\s*/i, "")
    .replace(/\s*\[#\d+\]/g, "")
    .trim();
}

export function getConventionalPrefix(issue: Issue): string {
  const labels = issue.labels.split(", ").map(l => l.trim());
  return labels.includes("enhancement") || labels.includes("feature") ? "feat" : "fix";
}

export function pushAndCreatePR(
  repo: string,
  worktreeDir: string,
  branchName: string,
  defaultBranch: string,
  issueNum: string,
  issue: Issue,
  summary?: string,
  existingPR?: PRFeedback,
): void {
  // Check for unpushed commits or uncommitted changes
  const unpushed = Bun.spawnSync(["git", "log", `origin/${defaultBranch}..HEAD`, "--oneline"], { cwd: worktreeDir });
  const diffCheck = Bun.spawnSync(["git", "diff", "--quiet"], { cwd: worktreeDir });
  const cachedCheck = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], { cwd: worktreeDir });

  const hasUnpushed = unpushed.stdout.toString().trim().length > 0;
  const hasUncommitted = diffCheck.exitCode !== 0 || cachedCheck.exitCode !== 0;

  if (!hasUnpushed && !hasUncommitted) {
    log.warn("No changes detected. Claude may not have made any modifications.");
    log.warn(`Worktree: ${worktreeDir}`);
    return;
  }

  const prefix = getConventionalPrefix(issue);

  // Stage any unstaged changes Claude might have left
  if (hasUncommitted) {
    log.info("Staging uncommitted changes...");
    const addResult = Bun.spawnSync(["git", "add", "-A"], { cwd: worktreeDir });
    if (addResult.exitCode !== 0) {
      log.die("Failed to stage changes.");
    }
    const commitResult = Bun.spawnSync(["git", "commit", "-m", `${prefix}: address issue #${issueNum} - ${cleanIssueTitle(issue.title)}`], { cwd: worktreeDir });
    if (commitResult.exitCode !== 0) {
      log.warn("Commit failed — changes may already be committed.");
    }
  }

  // Squash all commits into one (use origin ref — local branch may be stale)
  const mergeBase = `origin/${defaultBranch}`;
  const commitCount = Bun.spawnSync(["git", "rev-list", "--count", `${mergeBase}..HEAD`], { cwd: worktreeDir });
  const count = parseInt(commitCount.stdout.toString().trim(), 10) || 0;
  if (count > 1) {
    log.info(`Squashing ${count} commits into one...`);
    const squash = Bun.spawnSync(["git", "reset", "--soft", mergeBase], { cwd: worktreeDir });
    if (squash.exitCode === 0) {
      const msg = `${prefix}: ${cleanIssueTitle(issue.title).toLowerCase()} (#${issueNum})`;
      Bun.spawnSync(["git", "commit", "-m", msg], { cwd: worktreeDir });
      log.ok("Commits squashed.");
    } else {
      log.warn("Failed to squash — pushing individual commits instead.");
    }
  }

  // Push — force-with-lease if the remote branch already exists
  log.info(`Pushing branch '${branchName}' to origin...`);
  const remoteRef = Bun.spawnSync(["git", "ls-remote", "--heads", "origin", branchName], { cwd: worktreeDir });
  const remoteBranchExists = remoteRef.stdout.toString().trim().length > 0;
  const pushArgs = remoteBranchExists
    ? ["git", "push", "--force-with-lease", "-u", "origin", branchName]
    : ["git", "push", "-u", "origin", branchName];
  const push = Bun.spawnSync(pushArgs, { cwd: worktreeDir });
  if (push.exitCode !== 0) {
    log.die("Failed to push. Check your git credentials.");
  }
  log.ok("Branch pushed.");

  const prTitle = `${prefix}: ${cleanIssueTitle(issue.title)} [#${issueNum}]`;
  const prBody = buildPRBody(issueNum, summary);

  if (existingPR) {
    // Update existing PR title and description
    const edit = Bun.spawnSync([
      "gh", "pr", "edit", String(existingPR.prNumber),
      "--repo", repo,
      "--title", prTitle,
      "--body", prBody,
    ], { cwd: worktreeDir });

    if (edit.exitCode !== 0) {
      log.warn("Failed to update PR title/description.");
    }

    log.ok("Existing PR updated!");
    console.log(`\x1b[0;32m${existingPR.prUrl}\x1b[0m`);
    console.log();
    log.ok(`All done! Issue #${issueNum} → Branch '${branchName}' → PR updated.`);
    log.info(`Worktree: ${worktreeDir}`);
    log.info(`To clean up the worktree later: git worktree remove ${worktreeDir}`);
    return;
  }

  // Create PR
  log.info("Opening pull request...");

  const pr = Bun.spawnSync([
    "gh", "pr", "create",
    "--repo", repo,
    "--base", defaultBranch,
    "--head", branchName,
    "--title", prTitle,
    "--body", prBody,
  ], { cwd: worktreeDir });

  if (pr.exitCode !== 0) {
    log.die("Failed to create PR. You may need to push first or the PR may already exist.");
  }

  const prUrl = pr.stdout.toString().trim();
  log.ok("Pull request created!");
  console.log(`\x1b[0;32m${prUrl}\x1b[0m`);

  console.log();
  log.ok(`All done! Issue #${issueNum} → Branch '${branchName}' → PR opened.`);
  log.info(`Worktree: ${worktreeDir}`);
  log.info(`To clean up the worktree later: git worktree remove ${worktreeDir}`);
}

function buildPRBody(issueNum: string, summary?: string): string {
  const summarySection = summary
    ? `### What was done\n\n${summary}\n\n`
    : "";

  return `## Summary

Closes #${issueNum}

${summarySection}---

This PR was generated by [mog](https://github.com/bobbyg603/mog) using Claude Code in a Docker sandbox.

*Please review the changes carefully before merging.*`;
}
