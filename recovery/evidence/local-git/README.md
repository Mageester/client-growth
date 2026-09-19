# Local Git and cache forensics

## Git object state

- `original-fsck-full.txt` and `original-fsck-lost-found.txt` are empty.
- `recovery-fsck-full.txt` and `recovery-fsck-lost-found.txt` contain no dangling objects.
- Both repositories have empty stash lists.
- Reflog and worktree metadata are preserved in this directory.
- No unreachable blob/tree containing the requested production-only filenames was found.

## Bounded cache search

The requested filenames and distinctive production symbols were searched under:

- `C:\Users\Aidan\Documents\Repos`
- `C:\Users\Aidan\.codex`
- `C:\Users\Aidan\.claude`
- `C:\Users\Aidan\AppData\Local\Temp`
- `C:\Users\Aidan\OneDrive`
- `C:\Users\Aidan\Desktop`

No matching production source filenames were found. Content matches outside the preserved evidence were limited to the recovery plan/spec and an unrelated `morrow` project containing generic DeepSeek model tests/catalog data; it does not contain Axiom Orbit module paths and was not used as source evidence. Browser profiles, credential directories, and broad private data were not searched.
