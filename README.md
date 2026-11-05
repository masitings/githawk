# GitHawk

Fast, local-first Git desktop client built with Rust + Tauri. No account, no telemetry.

See [docs/PRD.md](docs/PRD.md) for scope and roadmap.

## Layout

- `src-tauri/` — Tauri app shell and IPC commands
- `crates/githawk-core/` — Git read layer (libgit2); writes go through the git CLI
- `src/` — React + TypeScript + Tailwind + shadcn/ui
- `docs/` — product and design docs

## Develop

Requires Rust, Node, pnpm, and git.

```bash
pnpm install
pnpm tauri dev
cargo test
```
