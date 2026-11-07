# Contributing to GitHawk

Thanks for helping. Bug reports, fixes and features are all welcome.

## Reporting a bug

Open an issue with:

- your OS and GitHawk version (Settings → About, or the release you installed),
- what you did, what you expected and what happened,
- the failing command from the git command log (⌘⇧R) if an operation failed.

Please remove tokens, private remote URLs and file contents you don't want public before posting.

## Proposing a feature

Open an issue first for anything bigger than a small fix, so we can agree on the approach before you spend time on it. GitHawk is local-first: features that need a GitHawk account, a server or telemetry won't be accepted.

## Getting credited

Code contributors appear automatically in Settings → About. Other help counts too: bug reports, design, translations, documentation, testing and ideas. These are listed in [`.all-contributorsrc`](.all-contributorsrc) using the [all-contributors](https://allcontributors.org/docs/en/emoji-key) categories and shown under Special thanks in the app.

To be added, open a pull request that adds yourself to that file, or ask in your issue or pull request and a maintainer will add you.

## Setting up

You need [git](https://git-scm.com), [Rust](https://rustup.rs) (stable, edition 2024), [Node.js](https://nodejs.org) 24, [pnpm](https://pnpm.io) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm tauri dev
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together, including how to add a new git operation.

## Before you open a pull request

CI runs these, so run them locally first:

```bash
pnpm build
pnpm test
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Then:

- Keep a pull request to one change. Split unrelated fixes into separate PRs.
- Add a test for new logic in `crates/githawk-core` (the tests create throwaway repositories with the real `git` CLI) or in `src/lib/lib.test.ts` for UI helpers.
- For UI changes, include a screenshot or short recording in the PR description, in both dark and light themes if colors changed.
- Check that keyboard users can reach and operate what you added.
- Write commit messages in the imperative mood ("Add remote rename", not "Added remote rename").

## Code style

- Rust is formatted with `rustfmt`. TypeScript follows the existing files: function components, Tailwind classes and the shadcn/ui components in `src/components/ui`.
- Prefer the simplest change that works. Don't add a dependency for what a few lines can do.
- Comments explain why, not what. Leave out comments that restate the code.
- Anything that changes a repository goes through the `git` CLI (see the architecture doc), not libgit2 writes, so hooks, signing and LFS keep working.
- Never log or store tokens, keys or passwords outside the OS keychain.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), the same license as the project.
