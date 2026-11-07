# Architecture

GitHawk has three layers:

| Layer | Path | Role |
| --- | --- | --- |
| Core library | `crates/githawk-core/` | All git logic. No Tauri dependency, so it is tested on its own. |
| Desktop shell | `src-tauri/` | Tauri commands that expose the core to the UI, plus the file watcher, terminal, hosting providers, AI and SSH/GPG keys. |
| UI | `src/` | React 19 + TypeScript. Talks to the shell only through `src/lib/api.ts`. |

## Reads and writes

Reading and writing use different paths on purpose.

**Reads use libgit2** (the `git2` crate): the commit graph (`graph.rs`), status, diffs, refs and commit details (`repo.rs`), blame, history, reflog, worktrees and submodules (`inspect.rs`). This is fast and has no process overhead.

**Writes use the `git` CLI.** Every change to a repository is an `Op` in `crates/githawk-core/src/ops.rs`. Running the real CLI means hooks, Git LFS, commit signing and credential helpers behave exactly as in a terminal. Each `Op`:

- is deserialized from JSON sent by the UI (`{ "op": "create-branch", "name": "x", "at": "HEAD", "checkout": true }`),
- turns into one or more argument lists in `Op::commands()`; there is no shell and no string concatenation, and user-supplied names pass through `arg()`, which rejects values that start with `-`,
- has a human label from `Op::label()` for the undo history,
- streams progress if `Op::is_long()` returns true (fetch, pull, push, clone, submodule updates).

`ops::git()` builds every command with `GIT_TERMINAL_PROMPT=0` so git never blocks on a prompt, a no-op editor, literal pathspecs, and the active profile's identity. Every invocation is written to the command log shown in the UI.

A few writes need more than one git command chained with logic between them, such as line staging (`patch.rs`) and interactive rebase (`rebase.rs`). They still shell out to `git`.

## Undo

`src-tauri/src/lib.rs` `run_op` snapshots HEAD and every branch and tag before and after an op, then records the pair in `.git/githawk/oplog.json` (`oplog.rs`, last 100 entries). Undo moves refs back to the "before" snapshot; redo moves them to "after". A commit is undone with a soft reset so its changes come back staged. Working-tree files are not snapshotted, so undo never touches uncommitted changes.

## Keeping the UI current

`watch` (in `src-tauri/src/lib.rs`) watches the repository with `notify` and emits `repo-changed` with `refs: true` when something under `.git` that affects refs changed, or `false` for working-tree edits only. The UI reloads status, and the graph and refs only when `refs` is true. Long operations emit `git-progress` lines that show in the status bar.

## Adding a git operation

1. Add a variant to `Op` in `crates/githawk-core/src/ops.rs` and fill in `label()`, `commands()` and, if it talks to the network, `is_long()`.
2. Add a test in the same file. The existing tests create a temporary repository with the real CLI; copy one.
3. Add the matching shape to the `Op` union in `src/lib/api.ts`. Fields are camelCase; the `op` tag is kebab-case.
4. Call it from the UI through the `run(op, label)` helper in `RepoView.tsx`, which wraps `api.run(root, op)` with error toasts and a refresh, and add it to a context menu or the command palette. If the op is long, also add it to the `LONG` set there so the busy indicator shows.

No new Tauri command is needed: `run_op` handles every `Op`, including undo recording and progress.

## Adding a read

Add a function to the core (`repo.rs` or `inspect.rs`), expose it as a `#[tauri::command]` in `src-tauri/src/lib.rs` and register it in `invoke_handler`, then add a typed wrapper in `src/lib/api.ts`. Tauri maps camelCase arguments from JavaScript to snake_case Rust parameters.

## Secrets

Provider tokens and AI keys are stored with the `keyring` crate (macOS Keychain, Windows Credential Manager, Secret Service). They never go into settings files, the command log or error messages. Hosting API calls live in `src-tauri/src/hosting.rs`, AI calls in `src-tauri/src/ai.rs`.
