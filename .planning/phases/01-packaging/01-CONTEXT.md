# Phase 1: Packaging - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Produce a distributable VSIX with a one-command build (`npm run package`) and a GitHub Actions CI pipeline that compiles, packages, and uploads the VSIX artifact on every push to main. All work is infrastructure — no user-facing extension behavior changes in this phase.

</domain>

<decisions>
## Implementation Decisions

### Publisher & Identity
- **D-01:** `publisher` field → `altium`
- **D-02:** `displayName` → `Altium 365 Developer Tools` (broader name that fits the full roadmap scope, not just scripting)

### Extension Metadata
- **D-03:** Description (package.json + README) should be scoped to the **full roadmap** — describe the complete v1 product (workspace navigation, local script run/debug, remote script management), not just the current Phase 1 subset.
- **D-04:** `categories` → `["Other"]` only. No additional Marketplace categories for v1.
- **D-05:** Keywords — add discoverable terms: `altium`, `altium365`, `a365`, `scripting`, `pcb`, `eda` (planner discretion on exact list).
- **D-06:** `README.md` — functional documentation, text-only (no screenshots). Must cover: prerequisites, install steps, sign-in flow, local script run/debug, environment switching (Dev/UAT/Prod). No placeholder — a real document usable by an external developer.

### Extension Icon
- **D-07:** Create a VS Code-style monochrome icon (128×128 PNG) inspired by the Altium 365 brand icon (reference: `https://cdn-1.webcatalog.io/catalog/altium-365/altium-365-icon-filled-256.png`). Commit at `resources/icon.png`. Set `"icon": "resources/icon.png"` in `package.json`.
- Style: monochrome/single-color, VS Code dark theme compatible. Agent has discretion on exact rendering approach (SVG → PNG, canvas, etc.).

### CI Pipeline
- **D-08:** Trigger: push to `main` branch only. PRs and feature branches do NOT trigger the full package pipeline.
- **D-09:** Pipeline steps: `npm ci` → `npm run compile` (tsc) → `npm run package` (vsce) → upload VSIX as workflow artifact.
- **D-10:** Node.js version: 18 (matches `engines.node` in `package.json`).
- **D-11:** `npm run package` script must be added to `package.json` → `vsce package`.
- **D-12:** `@vscode/vsce` (or `vsce`) added as a devDependency.

### Agent's Discretion
- Exact `keywords` list in `package.json` — keep to ~6-8 relevant terms.
- VSIX artifact retention period (GitHub Actions default, typically 90 days, is fine).
- Exact `version` field for Phase 1 packaging (current is `0.0.2`; bump to `0.1.0` if desired for first packagable build, or leave as-is).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Requirements
- `.planning/REQUIREMENTS.md` §Packaging — PKG-01 through PKG-05 are the acceptance criteria for this phase
- `.planning/ROADMAP.md` §Phase 1 — Success criteria (4 items) define what "done" looks like

### Codebase
- `package.json` — current state: `publisher: "local"`, narrow description, missing icon/keywords/package script; all must be updated
- `.planning/codebase/STACK.md` — confirms no bundler, plain tsc, `vsce` not yet installed
- `.planning/codebase/CONVENTIONS.md` — code style for any TypeScript changes (none expected in Phase 1)

### Icon Reference
- `https://cdn-1.webcatalog.io/catalog/altium-365/altium-365-icon-filled-256.png` — brand icon to base the monochrome VS Code icon on (external URL, not in repo)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json` `scripts.compile` / `scripts.vscode:prepublish` — already present; `package` script slots in alongside these
- `tsconfig.json` — no changes needed; tsc compile step is already working

### Established Patterns
- No bundler — plain `tsc` output to `out/`. `vsce` packages `out/` as-is. `.vscodeignore` may need to be created to exclude dev-only files (tests, planning dir, etc.).
- `devDependencies` only — the extension has zero runtime npm dependencies; `@vscode/vsce` joins this pattern as a devDependency.

### Integration Points
- `vsce package` reads `package.json` `main`, `contributes`, `engines`, `icon` — all fields must be valid before packaging succeeds.
- CI artifact upload requires a known VSIX filename; `vsce package` names it `{name}-{version}.vsix` by default.

</code_context>

<specifics>
## Specific Ideas

- Icon: user wants the icon to visually derive from the Altium 365 brand mark (the orange/red gear/circuit motif at the reference URL), redrawn in VS Code monochrome style.
- Display name change from "Altium 365 Scripting" → "Altium 365 Developer Tools" is intentional to reflect the broader roadmap (side panel + remote scripts coming in Phases 2–3).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Packaging*
*Context gathered: 2026-05-19*
