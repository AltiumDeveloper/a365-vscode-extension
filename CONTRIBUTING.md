# Contributing

## Versioning and Release Process

`package.json` always carries the **base version** with patch = 0 (e.g. `0.2.0`, `1.4.0`). The CI workflow derives the actual published version from this base and the release type.

### Pre-release (every push to `main`)

Every push to `main` automatically publishes a **pre-release** to the VS Code Marketplace. The patch segment is replaced with `GITHUB_RUN_NUMBER` to produce a unique, monotonically increasing version (e.g. `0.2.150`). Only users who have opted into pre-release builds in VS Code receive these updates.

Nothing special is required — just push to `main`.

### Stable release

To publish a new stable version:

1. **Bump `package.json`** — increment `major` or `minor`, keep `patch` at `0`:
   ```
   0.2.0  →  0.3.0   (minor bump)
   0.3.0  →  1.0.0   (major bump)
   ```
2. **Write the release description as the commit message.** The full commit message body becomes the GitHub Release notes, so make it human-readable.
3. **Push to `main`.**

The workflow detects that tag `v{version}` does not yet exist and runs the stable path:
- Creates a GitHub Release tagged `v{version}` with the commit message as release notes and the `.vsix` file attached.
- Publishes the stable version to the VS Code Marketplace (all users, not just pre-release opt-ins).

No GitHub UI interaction is needed.

### How detection works

The workflow reads `version` from `package.json` and checks whether `v{version}` already exists as a tag on the remote:

| Tag exists? | What happens |
| --- | --- |
| **Yes** (same major.minor as a previous stable) | Pre-release: stamp `{major}.{minor}.{run_number}`, publish pre-release |
| **No** (new major.minor) | Stable: create GitHub Release, publish stable |

### Required secrets

| Secret | Purpose |
| --- | --- |
| `VSCE_PAT` | VS Code Marketplace Personal Access Token — create at [dev.azure.com](https://dev.azure.com) with **Marketplace (Manage)** scope |

`GITHUB_TOKEN` (auto-provided by Actions) is used for creating GitHub Releases and requires no manual setup.
