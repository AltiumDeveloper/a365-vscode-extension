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

- `README.md` now points at the VS Code Marketplace for installation, documents the
  `clientId` and `activeEnvironment` settings, and lists the correct per-environment
  override keys and the side-panel-only commands.

### Security

- Running a Python script locally now shows a cancellable progress notification, and
  cancelling it stops the script and its subprocesses. Previously a script that hung or
  looped had no stop control at all and kept running until VS Code exited.
- Closing VS Code stops any local script still running, and its subprocesses, instead
  of leaving them orphaned.
- The temporary parameters file written for each run is now readable only by the
  current user, and is deleted once the run ends, for Debug as well as Run. Previously
  every run left a world-readable `altium365-params-*.json` file in the system temp
  directory containing that run's test event values.
- The Python sandbox dependencies are pinned to tested ranges, so a local script run no
  longer resolves whatever `gql` and `requests` happen to be current. `gql` is held to
  the 4.x line, whose aiohttp transport verifies TLS certificates by default, and
  `requests` to 2.32.4 or later.
- Installing the Python sandbox dependencies now replaces `python/SandboxProcess/.deps/`
  instead of unpacking over it. `pip install --target` leaves an already-present package
  untouched, so every change to `requirements.txt` since the directory was introduced has
  been recorded as applied while the old versions stayed on disk.

- Signing out now revokes the refresh token at the authorization server before deleting
  the local copies, so it can no longer be used to mint new access tokens. Switching
  accounts or environments revokes the previous session's token the same way. Revocation
  is best-effort — sign-out still completes locally when the server cannot be reached.
  Access tokens already issued remain valid until they expire.
- Stored tokens now record the sign-in server that issued them, and are only ever sent
  back to that server. Previously, keeping the session when switching environments, or
  editing `altium365.activeEnvironment` by hand, sent the old environment's tokens to the
  new environment's sign-in and GraphQL endpoints, and signing in or out then revoked
  them at the wrong server. The extension now shows you as signed out in an environment
  that uses a different sign-in server, and revokes each token where it was issued.

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
