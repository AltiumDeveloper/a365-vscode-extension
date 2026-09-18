# Changelog

All notable changes to the Altium Developer extension are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Versioning works as described in [CONTRIBUTING.md](CONTRIBUTING.md): `package.json`
carries the base `major.minor.0`, every push to `main` publishes a pre-release
`major.minor.<build>`, and a minor or major bump publishes a stable release. Entries
here are grouped by the base version, not by individual pre-release build.

Entries cover what the extension does and the documentation shipped with it.
Repository, CI and test-suite changes are not listed; see the git history for those.

This changelog starts at 0.4. Earlier versions were published without one; see the
git history for what changed in them.

## Unreleased

### Added

- `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, and this
  changelog.
- Contributor documentation covering build, run, test and pull request expectations.

### Changed

- Signing out now revokes the refresh token at the authorization server before deleting
  the local copies, so it can no longer be used to mint new access tokens. Switching
  accounts or environments revokes the previous session's token the same way. Revocation
  is best-effort — sign-out still completes locally when the server cannot be reached.
  Access tokens already issued remain valid until they expire.
- `README.md` now points at the VS Code Marketplace for installation, documents the
  `clientId` and `activeEnvironment` settings, and lists the correct per-environment
  override keys and the side-panel-only commands.

## 0.4

### Added

- **Create Script** on an extension point: creates a Python script, assigns it to
  that extension point, and opens it for editing.

### Changed

- Authentication now uses the shared `@altium-developer/altium-auth` library instead
  of a bundled OAuth implementation.
- Updated the bundled `altium_api` Python package used by sandboxed scripts (design
  data access and ERC utilities).

### Fixed

- `npm run package` and `vsce package` now work on Windows; the build's clean step no
  longer depends on `rm -rf`.
- The assignment name shown for an extension point is now resolved correctly.
- Corrected the repository URL in the extension manifest.
