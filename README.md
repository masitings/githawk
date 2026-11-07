<p align="center">
  <img src="logo.png" alt="" width="96">
</p>

<h1 align="center">GitHawk</h1>

<p align="center">
  A fast, local-first Git client for macOS, Windows and Linux.<br>
  Free, open source, no account, no telemetry.
</p>

<p align="center">
  <a href="https://github.com/masitings/githawk/releases/latest"><b>Download</b></a> ·
  <a href="#build-from-source">Build from source</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

![Commit graph with branches, pull request checks and commit details](docs/screenshots/graph.png)

## Why GitHawk

- **Light.** Rust and Tauri instead of a bundled browser. The graph is laid out in Rust and drawn on a virtualized canvas, so large histories stay smooth.
- **Real git.** Every change runs your `git` CLI, so hooks, LFS, signing and credential helpers work as they do in your terminal. The command log shows exactly what ran.
- **Undo anything.** Commits, merges, rebases, resets and branch changes can be undone with ⌘Z.
- **Yours.** No sign-in and no server. Tokens live in your OS keychain.

## Features

- **Graph:** drag a branch onto another to merge, rebase or open a pull request; hide, solo and search branches; CI status on branches.
- **Staging:** stage files, hunks or single lines in a unified or split diff with word-level highlights; amend and sign commits.
- **Branching:** interactive rebase, cherry-pick, revert, compare any two commits or branches, Gitflow, and a three-panel conflict editor.
- **Remotes:** GitHub, GitLab, Bitbucket and Azure DevOps (cloud and self-hosted). Clone, push, pull, and review and merge pull requests in the app.
- **Power tools:** command palette (⌘K), reflog, stash, tags, worktrees, submodules, LFS, a built-in terminal and side-by-side coding agent sessions.
- **AI, optional:** commit messages, commit explanations and changelogs with your own Anthropic key or any OpenAI-compatible server, including local ones.

<table>
  <tr>
    <td><img src="docs/screenshots/staging.png" alt="Staging a hunk"></td>
    <td><img src="docs/screenshots/conflict.png" alt="Resolving a merge conflict"></td>
  </tr>
</table>

## Install

Download the installer for your system from [Releases](https://github.com/masitings/githawk/releases/latest). GitHawk uses the `git` on your machine, so install [Git](https://git-scm.com) first. The app updates itself.

The macOS build is signed and notarized. The Windows build is not signed yet; if SmartScreen warns, choose **More info → Run anyway**.

On macOS you can also use [Homebrew](https://brew.sh):

```bash
brew tap masitings/tap
brew trust masitings/tap
brew install --cask githawk
```

## Build from source

You need [Rust](https://rustup.rs), [Node.js](https://nodejs.org), [pnpm](https://pnpm.io) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri build` produces an installer. See [CONTRIBUTING.md](CONTRIBUTING.md) for tests and checks, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized.

## Found a problem?

GitHawk has no telemetry and no crash reporting. It never sends usage data, errors or crashes anywhere, so we only learn about a problem when you tell us.

If something breaks, looks wrong or is missing, please [open an issue](https://github.com/masitings/githawk/issues/new). Include your OS, the GitHawk version, what you did and what happened. If a git operation failed, copy the failing command from the command log (⌘⇧R). Remove tokens, private URLs and anything else you don't want public before posting.

## How GitHawk is made

GitHawk is written from scratch. It was not built by reverse engineering GitKraken or any other Git client, and no reverse engineering tools (such as Reverse Engineering Anything) were used. No code, assets or binaries from other clients were decompiled, inspected or copied.

Its features follow the Indonesian idea of **ATM: Amati, Tiru, Modifikasi** (observe, imitate, modify). We use other Git clients as ordinary users, look at what they do well, and then write our own implementation in our own way, on top of the real `git` CLI and libgit2.

GitHawk is an independent project and is not affiliated with or endorsed by GitKraken or Axosoft. Product names mentioned here belong to their owners.

## License

[Apache License 2.0](LICENSE)
