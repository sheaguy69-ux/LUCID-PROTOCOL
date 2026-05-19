# Project rules for Claude

## Global rules (always apply)

- **Verify completion.** Every time the user asks for something, double-check the work is actually done before reporting back. Don't claim a task is finished based on intent — confirm it with a concrete check:
  - File changes: `git status` / `git diff` shows the expected diff, or `Read` the file back to confirm content.
  - Commits: `git log -1` shows the new commit on the expected branch.
  - Pushes: `git push` output shows the ref was advanced on the remote, or `git ls-remote origin <branch>` matches local HEAD.
  - PRs / deploys: the PR shows the new commit SHA and CI is green (or note the failures explicitly).
  - UI / image / asset swaps: re-read the asset after replacing it, and confirm the page that references it points at the right path.
  - "It's pushed" is not the same as "it's live on prod" — production sites build from `main`; PR branches show on preview URLs only. State which one the user is looking at.
- If a step can't be verified (network blocked, no access, etc.), say so explicitly rather than assuming success.
