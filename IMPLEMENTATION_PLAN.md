# Implementation Plan for #4

- [x] Add `detectRepo()` function to `src/worktree.ts` that extracts `owner/repo` from the current directory's git remote URL (supporting both HTTPS and SSH formats), returning `null` if not in a git repo or no valid remote is found
- [x] Refactor CLI argument parsing in `src/index.ts` to support `mog <issue_number>` shorthand — when the first arg is numeric, call `detectRepo()` to resolve the repo automatically instead of requiring `owner/repo` as the first argument
- [x] Add `listIssues(repo: string, verbose: boolean)` function to `src/github.ts` that uses `gh issue list` to fetch and display open issues for a given repo, with a compact format (number + title) by default and full details (body, labels, assignees) when verbose
- [ ] Wire up `mog list [--verbose]` command in `src/index.ts` — detect the `list` subcommand, resolve the repo (from args or auto-detect), and call `listIssues()`; also support `mog <owner/repo> list [--verbose]` for explicit repo targeting
