# Releasing

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed. It builds macOS (Apple Silicon and Intel, signed and notarized), Windows and Linux installers, signs the updater artifacts, and creates a **draft** GitHub release.

## Steps

1. Bump the version in all three places, keeping them identical:
   - `Cargo.toml` (`[workspace.package] version`)
   - `package.json`
   - `src-tauri/tauri.conf.json`
2. Run `cargo check` so `Cargo.lock` picks up the new version, then commit: `Release v0.1.2`.
3. Tag and push:

   ```bash
   git tag v0.1.2
   git push origin main v0.1.2
   ```

4. Wait for the Release workflow to finish all four jobs.
5. Open the draft on GitHub, check that every installer and `latest.json` are attached, add release notes, and publish it.

Installed apps check `releases/latest/download/latest.json` on launch, so the auto-updater only sees a release once it is published, not while it is a draft. Publishing also runs the Homebrew workflow, which updates the version and checksums in [masitings/homebrew-tap](https://github.com/masitings/homebrew-tap).

## Repository secrets

The workflow needs these secrets. Only maintainers set them, and they are never committed.

| Secret | Used for |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing updater bundles. The matching public key is `plugins.updater.pubkey` in `tauri.conf.json`. Losing this key means existing installs can no longer auto-update. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Base64 Developer ID Application certificate (.p12) and its password |
| `APPLE_SIGNING_IDENTITY` | The certificate's name, e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Notarization; `APPLE_PASSWORD` is an app-specific password |
| `HOMEBREW_TAP_TOKEN` | Fine-grained token with Contents: write on `masitings/homebrew-tap`. `.github/workflows/homebrew.yml` uses it to bump the cask when a release is published. |

Windows builds are not code-signed yet.
