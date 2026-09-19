# GitHub repository forensics

## Remote coverage

The GitHub remote `https://github.com/Mageester/client-growth.git` was added only to the isolated recovery clone and fetched read-only into `refs/remotes/github/*`. The fetched set contains 17 remote branches, including `main`, `ops/activate-deepseek-production`, all listed `codex/*` branches, product/marketing branches, and release-safety branches. Their tips and latest commit metadata are in `branch-commits.txt` and `branch-commits.json`.

## Candidate search

- `candidate-files.json` is an empty array: none of the requested production-only filenames are present in any reachable GitHub branch object/path.
- `symbol-history.json` is an empty array for the production-only symbols and model strings searched with `git log --remotes=github --full-history -S`.
- Existing branches contain the older `DeepSeekEvaluator.ts` and `DEEPSEEK_MODEL=deepseek-chat` configuration, but not the production-only visual-review, lifecycle, provider-usage, synthesis, or publication modules named in the recovery brief.
- The branch tips remain useful source baselines for older modules, route/UI work, safety gates, and the pre-production DeepSeek adapter.

## Reproducibility

The script `recovery/tools/git-forensics.ps1` records remote branch tips, reachable object paths, candidate filenames, symbol-history searches, and branch subjects without changing branches or refs. No force push, ref rewrite, prune, or reset was used.
