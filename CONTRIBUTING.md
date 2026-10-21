# Contributing

Thanks for your interest in the Altium Developer extension. Bug reports, feature
requests and pull requests are all welcome.

## Prerequisites

- Node.js 20 or later
- VS Code 1.85 or later
- Python 3.8 or later, to exercise local script run/debug

## Getting set up

```
npm ci
npm run compile
```

`compile` runs `tsc --noEmit` and then bundles `src/extension.ts` to
`out/extension.js` with esbuild.

## Running the extension

Press `F5` (the **Run Extension** launch configuration) to open a VS Code
Extension Development Host with the extension loaded. It compiles first via the
`npm: compile` task. Use `npm run watch` for an incremental rebuild while you
work, and **Developer: Reload Window** in the dev host to pick up changes.

## Checks

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint over `src` and `test`, `--max-warnings 0` |
| `npm run typecheck` | `tsc --noEmit` over `src` |
| `npm test` | Vitest unit tests |
| `npm run package` | Builds a `.vsix` with `vsce` |

CI runs lint, compile, test and package on Ubuntu, Windows and macOS on every
pull request. All three legs must pass before a pull request can merge: `main`
has a ruleset requiring a pull request, one approving review, and the `gate`
check that aggregates the matrix. Run at least `npm run lint` and `npm test`
locally first.

## Pull requests

- Branch off `main` and keep the change focused on one thing.
- Include tests for new logic. Unit tests live under `test/`, mirroring the
  `src/` layout, and mock the VS Code API via `test/__mocks__/vscode.ts`.
- Update `README.md` when you change anything a user can see — commands,
  settings, scopes or behaviour. See the Documentation Maintenance section of
  `AGENTS.md`.
- Add a `CHANGELOG.md` entry under **Unreleased** for anything a user would
  notice. Repository, CI and test-only changes do not need one.
- Run the change by hand in the Extension Development Host before opening the
  pull request. AI-assisted development is welcome, but whoever opens the pull
  request is the one who has to have tested it.
- Describe what changed and why in the PR body. The pull request template asks
  for this.
- Do not bump the version in `package.json` as part of a feature PR; releases
  are handled separately, as described below.

## Using another Altium 365 environment

The extension ships with the production environment only. To point a development
build at another Altium 365 environment, add it to `altium365.environments` in your
**user** settings, then pick it with **Altium Developer: Select Environment**. The
setting is ignored in workspace settings.

```json
"altium365.environments": {
  "Custom": {
    "graphqlEndpoint": "https://<api-host>/napi/gateway/graphql",
    "authEndpoint": "https://<auth-host>/connect/authorize",
    "tokenEndpoint": "https://<auth-host>/connect/token",
    "actionWaitEndpoint": "https://<actionwait-host>/await",
    "redirectUri": "https://<auth-host>/api/AuthComplete",
    "scopes": "openid profile offline_access workspace:scripts.manage workspace:scripts.execute"
  }
}
```

## Versioning and Release Process

Releases are published from version tags by the **Release** workflow
(`.github/workflows/release.yml`). Merging to `main` publishes nothing.

The Marketplace has no semver pre-release suffix, so the minor version picks the
channel:

| Tag | Channel |
| --- | --- |
| Odd minor, e.g. `v0.5.2` | Pre-release, for users who chose **Switch to Pre-Release Version** |
| Even minor, e.g. `v0.6.0` | Stable, all users |

The workflow sets the version from the tag before packaging. `package.json` carries
the last stable version and is only changed for a stable release.

### Publishing a release

1. **Stable only:** open a pull request that renames `## Unreleased` in
   `CHANGELOG.md` to the new version (e.g. `## 0.6`), leaves a fresh empty
   `## Unreleased` heading above it, and sets `version` in `package.json` to match.
2. Tag the commit on `main` and push the tag:
   ```
   git tag v0.5.2 origin/main
   git push origin v0.5.2
   ```
3. Approve the run's deployment to the `vscode-marketplace` environment. The workflow
   runs the tests, packages the VSIX, publishes it to the Marketplace and creates a
   GitHub Release with the VSIX attached and generated notes.

A ruleset restricts creating, moving and deleting `v*` tags to repository admins. The
Marketplace refuses a version it has already published, so each tag must be a new
version.

### Required secrets

| Secret | Where | Purpose |
| --- | --- | --- |
| `VSCE_PAT` | `vscode-marketplace` environment | VS Code Marketplace Personal Access Token — create at [dev.azure.com](https://dev.azure.com) with **Marketplace (Manage)** scope |

The environment requires a reviewer's approval before a job can read the secret.
`GITHUB_TOKEN` (auto-provided by Actions) is used for creating GitHub Releases and
requires no manual setup.
