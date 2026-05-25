# Phase 8: distinct-vsix-version-per-build — Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Source:** /gsd:discuss-phase 8

<domain>
## Phase Boundary

Every CI build of the extension currently produces a VSIX stamped with the static `package.json` version (`0.1.0`). Without a distinct version per build, installed copies cannot tell that a newer artifact exists, VS Code will not treat the new install as an upgrade (same version = same install), and there is no audit trail back to the commit that produced a given build.

This phase delivers two coordinated pieces:

1. **CI build versioning + release publishing** — the GitHub Actions workflow stamps every push to `main` with a unique semver-suffixed version, packages the VSIX, and attaches it to an auto-created GitHub Release.
2. **In-extension update checker + installer** — the extension queries the GitHub Releases API on a debounced schedule, compares the latest release version to the installed version, and offers a one-click "Update Now" flow that downloads the VSIX and runs the built-in `workbench.extensions.installExtension` command.

Out of scope (explicitly): Marketplace publishing, signed VSIX builds, automatic install without user confirmation, channel-based updates (stable/insiders), update rollback.

</domain>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### CI pipeline
- `.github/workflows/ci.yml` — current workflow (push to main → npm ci → compile → vsce package → upload artifact); will be extended in Part 1
- `package.json:5` — current static version `0.1.0`; the base version the CI suffix attaches to
- `package.json:441-447` — npm scripts (`compile`, `package`); `vsce` already wired via `@vscode/vsce` devDep

### Extension runtime
- `src/extension.ts` — extension entry point; update-check bootstrap registers from `activate()`
- `package.json:20-269` — `contributes` block; a new `altium365.checkForUpdates` boolean setting belongs alongside the existing `altium365.*` settings (e.g. under `contributes.configuration.properties`)
- `package.json:45-158` — existing command registrations; a new `altium365.checkForUpdates` command (palette-visible) is added here

### Distribution
- GitHub repo `altium/a365-vscode-extension` (from `package.json:14-17`) — releases will be created against this repo; the update checker hits `https://api.github.com/repos/altium/a365-vscode-extension/releases`

### Historical
- `.planning/phases/01-packaging/` — Phase 1 set up the original CI + `vsce package` flow this phase extends
- `.planning/todos/pending/2026-05-25-distinct-vsix-version-per-build.md` — original todo this phase was promoted from (folded below)

</canonical_refs>

<decisions>
## Implementation Decisions

### Part 1 — CI Build Versioning (REQUIRED)

- **Scope split:** Phase 8 ships BOTH Part 1 (CI versioning) AND Part 2 Option B (in-extension self-updater, ~100 LOC). Single coherent phase — the updater needs the versioning to be useful, and the versioning is unobservable without the updater.
- **Version scheme:** `${BASE}-ci.${GITHUB_RUN_NUMBER}+${SHA7}` — e.g. `0.1.0-ci.42+a1b2c3d`.
  - `BASE` reads from current `package.json` version (so `0.1.0` today, bumps when the team manually edits base)
  - `-ci.N` pre-release suffix is monotonic per GitHub Actions run number — VS Code's semver comparator treats higher N as newer
  - `+SHA7` is semver build metadata — audit trail back to the producing commit; ignored by comparators
  - Preserves the "real" semver for eventual Marketplace publish (Marketplace can ship `0.1.0` proper without resetting a build counter that ate the patch field)
- **Version write mechanism:** `npm version "$VERSION" --no-git-tag-version --allow-same-version` in CI only. Never committed back to the repo.
- **vsce pre-release flag:** `npx vsce package --pre-release` is required because the version carries a `-ci.N` suffix. Accepted side-effect; not a concern pre-Marketplace.
- **Release trigger:** every push to `main` auto-creates a GitHub Release. The release name = the computed version; the `.vsix` is attached as a release asset. Use `softprops/action-gh-release@v2` (or `gh release create`) — planner picks based on simplest integration. Existing workflow-artifact upload stays (parallel channel for short-lived debugging).
- **Branch coverage:** only `main` builds get the unique version + release. Non-main branches keep producing a `0.1.0` VSIX in the workflow artifact upload step (local install testing for reviewers). No PR-numbered versions in v1.
- **Release notes:** auto-generated from the commit subject of the head commit (or `${{ github.event.head_commit.message }}`). No hand-curated changelog in v1 — that's a future phase if needed.

### Part 2 — In-Extension Self-Updater (Option B, ~100 LOC)

- **Setting:** new boolean `altium365.checkForUpdates` (default `true`). Lives in `contributes.configuration.properties` alongside existing `altium365.*` settings.
- **Check timing:** on extension activation, debounced to once per 24 hours via `globalState` key (e.g. `altium365.lastUpdateCheckAt` storing ISO timestamp). If `Date.now() - last < 24h`, skip the network call.
- **Auto-check default:** ON. Setting flip to `false` disables the activation-time check; the manual command still works.
- **GitHub API endpoint:** `GET https://api.github.com/repos/altium/a365-vscode-extension/releases` (LIST, not `/releases/latest`).
  - `/releases/latest` excludes pre-releases by GitHub's definition, and every CI build IS a pre-release (`-ci.N` suffix) — `/latest` would return nothing or stale data
  - Fetch the first page (default 30 releases is more than enough), filter out `draft == true`, sort by `published_at` desc, take the first
  - No auth header (public repo, 60 req/hour anonymous quota — fine for 24h debounce per user)
- **Version comparison:** tiny inline semver comparator in `src/updater.ts` (no new runtime deps). Must handle the `-ci.N+SHA7` shape:
  - Parse `MAJOR.MINOR.PATCH-ci.N` ignoring `+SHA7` build metadata
  - Compare by `(MAJOR, MINOR, PATCH)` first, then by `N` if both are pre-releases of the same base
  - Released > current → offer update
- **UX:** toast notification via `vscode.window.showInformationMessage("Altium 365: v{X} available", "Update Now", "Later")`.
  - `Update Now` → download the `.vsix` asset to `os.tmpdir()` via `https.get` (no new deps), then `vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath))`, then prompt reload via `vscode.window.showInformationMessage(..., "Reload Now")` → `workbench.action.reloadWindow`
  - `Later` → dismiss; next debounce window re-prompts if still newer
  - No status-bar indicator in v1 (kept the toast-only flow simple)
- **Manual command:** new `altium365.checkForUpdates` command registered in `package.json` (palette-visible). Bypasses the debounce; useful for "I just heard there's a fix, check now."
- **Error handling:** network failure / GitHub 5xx / JSON parse failure → log to existing `outputChannel`, no user-facing toast. Update check is best-effort, never blocks activation.
- **Asset selection:** filter release `assets[]` for the entry whose `name` ends with `.vsix`. If multiple match (shouldn't happen), pick the largest. If zero match, log and skip.
- **No checksum verification in v1.** GitHub-hosted release assets are trusted; if we sign VSIX builds later, verification gets added then.

### Claude's Discretion (implementation details)

- File layout: extracting the updater into `src/updater.ts` (parallel to `src/auth.ts`, `src/workspace.ts`) vs inlining in `src/extension.ts`. Planner picks based on size threshold — single file if < ~80 LOC, separate module if larger.
- Exact GitHub release-creation action (`softprops/action-gh-release@v2` vs `gh release create` shell) — planner picks based on workflow YAML simplicity.
- Whether the manual `altium365.checkForUpdates` command shows a toast on "no update available" (probably yes — manual invocation deserves explicit feedback).
- Output channel category prefix for updater logs.

</decisions>

<deferred>
## Deferred Ideas

- **Signed VSIX builds** — VS Code does not enforce signing for sideloaded VSIX, but Marketplace will require it eventually. Separate phase when we move to Marketplace publishing.
- **Marketplace publish from CI** — orthogonal to this phase; needs publisher token secrets, version bump policy, and changelog discipline.
- **Channel-based updates (stable / insiders)** — single channel is fine for current scale. Reconsider if external user count grows or if we need to ship breaking experiments.
- **Update rollback / install previous version** — could expose a "Install specific version…" QuickPick listing recent releases. Not needed in v1.
- **Hand-curated release notes / changelog** — auto-generated from commit subjects is good enough until external users start asking "what changed in this build?"
- **Pre-release-test before install** (download → verify checksum → install) — punted; revisit when signed builds land.
- **Status-bar update indicator** — toast-only is enough for v1; add if users report missing the notification.

</deferred>

<folded_todos>
## Folded Todos

- `2026-05-25-distinct-vsix-version-per-build.md` — original todo capturing the problem statement, the two-part solution (CI versioning + Option B self-updater), the version-scheme analysis, the API gotchas. This phase implements it end-to-end.

</folded_todos>

---

*Phase: 08-distinct-vsix-version-per-build*
*Context gathered: 2026-05-25 via /gsd:discuss-phase*
