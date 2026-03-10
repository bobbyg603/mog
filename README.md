<img height="320" alt="claude moggin issues" src="https://github.com/user-attachments/assets/72b347d2-b128-47b5-8dcd-e15248350fe0" />


# mog — Sandboxed Claude Issue Mogging

One command to go from GitHub issue to pull request, powered by Claude Code running in a Docker sandbox.

```
mog workingdevshero/automate-it 123
```

That's it. `mog` will:

1. Fetch the issue title, description, and labels via `gh` CLI
2. Create a git worktree on a clean branch (`123-fix-broken-login`)
3. Run Claude Code inside a persistent Docker sandbox (microVM) with `--dangerously-skip-permissions`
4. Push the branch and open a PR that `Closes #123`

## Prerequisites

- **macOS or Windows** (Docker sandbox microVMs require Docker Desktop)
- **Docker Desktop 4.40+** — running and up to date. Docker sandbox support (required by mog) was introduced in Docker Desktop 4.40. Verify with `docker sandbox ls`.
- **Bun** — install from [bun.sh](https://bun.sh)
- **GitHub CLI** (`gh`) — authenticated via `gh auth login`
- **Git** with push access to your target repos

## Install

```bash
bun install -g @bobbyg603/mog
```

## Quick start

```bash
# 1. One-time setup: create sandbox & authenticate
mog init
# This launches Claude Code — use /login to authenticate with your Max subscription
# Once logged in, type /exit to return

# 2. Start mogging issues
mog workingdevshero/automate-it 123
```

## How authentication works

`mog init` creates a **persistent** Docker sandbox named `mog`. When it launches, you authenticate once using `/login` inside the Claude Code session. Your auth persists in the sandbox across all future `mog` runs — you never need to login again.

If your session ever expires, just run `mog init` again to re-authenticate.

## Usage

```bash
# One-time setup
mog init

# Basic usage
mog owner/repo issue_number

# Examples
mog workingdevshero/automate-it 123
mog sparx-tech/hub-firmware 45
```

## How it works

```
┌──────────────────────────────────────────────────────────┐
│  Host machine                                            │
│                                                          │
│  1. gh issue view #123 → fetch title, body, labels       │
│  2. git worktree add → clean branch from default branch  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Docker sandbox "mog" (persistent microVM)         │  │
│  │                                                    │  │
│  │  • ~/mog-repos mounted as workspace                │  │
│  │  • Auth persists across runs (login once)          │  │
│  │  • Isolated from host (own Docker daemon)          │  │
│  │  • claude --dangerously-skip-permissions -p "..."  │  │
│  │  • Reads code, implements fix, commits             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  3. git push origin branch                               │
│  4. gh pr create --body "Closes #123"                    │
└──────────────────────────────────────────────────────────┘
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `MOG_REPOS_DIR` | `~/mog-repos` | Where repos are cloned and worktrees created (also the sandbox workspace) |
| `MOG_MAX_ITERATIONS` | `10` | Max build loop iterations per issue |
| `MOG_MAX_CONTINUATIONS` | — | Legacy alias for `MOG_MAX_ITERATIONS` |

## Worktree management

`mog` uses bare clones and git worktrees so you can run multiple issues concurrently without conflicts:

```
~/mog-repos/
  owner/
    repo/                    ← bare clone (or full clone)
    repo-worktrees/
      123-fix-broken-login/  ← worktree for issue #123
      456-add-dark-mode/     ← worktree for issue #456
```

Clean up when done:

```bash
cd ~/mog-repos/owner/repo
git worktree remove ../repo-worktrees/123-fix-broken-login
```

## Security notes

- Claude Code runs inside a **microVM** via Docker sandbox — it has its own Docker daemon and cannot access your host system, terminal, or files outside `~/mog-repos`.
- `--dangerously-skip-permissions` is safe here because the sandbox provides the isolation boundary.
- `gh` credentials stay on your host — the sandbox has **no access** to your GitHub token. Pushing and PR creation happen on the host after Claude finishes.
- The sandbox has network access (required for the Anthropic API).

## Troubleshooting

**"Docker sandbox not available"** — Make sure Docker Desktop is running and up to date.

**"Sandbox 'mog' not found"** — Run `mog init` first to create the sandbox and authenticate.

**"Failed to fetch issue"** — Check `gh auth status` and verify the repo/issue exist.

**"No changes detected"** — Claude may have struggled with the issue. Check the worktree manually, or re-run with a more detailed issue description.

**"Failed to push"** — Ensure `gh` is authenticated with push access. Try `gh auth login` and select HTTPS.

## Managing the sandbox

```bash
# List sandboxes
docker sandbox ls

# Stop the sandbox (preserves auth)
docker sandbox stop mog

# Remove and recreate (you'll need to /login again)
docker sandbox rm mog
mog init
```
