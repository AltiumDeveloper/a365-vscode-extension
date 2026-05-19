# Requirements: Altium 365 VS Code Extension

**Defined:** 2026-05-19
**Core Value:** A developer can open VS Code, sign in once, and go from browsing their A365 workspace to running or deploying a script — without leaving the editor or hand-crafting API calls.

## v1 Requirements

### Side Panel

- [x] **PANEL-01**: Activity Bar entry point opens the A365 side panel
- [x] **PANEL-02**: Side panel shows a list of workspaces the user has access to at the top level
- [x] **PANEL-03**: Each workspace expands to show its projects
- [x] **PANEL-04**: Each workspace expands to show its scripts (sibling to projects) *(superseded by PANEL-07 in Phase 02.1 — projects and scripts now grouped under category parent nodes based on UAT feedback)*
- [x] **PANEL-05**: Scripts have context menu actions: Run Script (locally), Edit Script, Execute Remotely, Publish Script
- [x] **PANEL-06**: Auth status (signed-in user, active environment) is visible in the panel header or status bar
- [x] **PANEL-07**: Workspace expansion shows two category parent nodes — `Projects (n)` and `Scripts (n)` — each lazy-loading its real children (reverses PANEL-04 based on Phase 02 UAT)
- [ ] **PANEL-08**: Tree node labels exclude backend GUIDs; a `Copy ID` context menu item exposes the GUID for workspaces, projects, and scripts
- [ ] **PANEL-09**: The active workspace (the one whose token was last exchanged) is visually distinguished from inactive workspaces in the tree
- [x] **PANEL-10**: The A365 view title bar exposes a globe-icon action that runs `altium365.selectEnvironment`
- [ ] **PANEL-11**: Workspace and project context menus include `Open in Browser`, which opens the node's A365 URL in the system browser

### Remote Scripts

- [ ] **SCRIPT-01**: User can list all scripts in the selected workspace via `gloScrScripts` query *(GraphQL listing complete in Plan 02-01; run-local from tree deferred to Phase 3 — Plan 02-06 Task 1 BLOCKED on live-workspace endpoint verification)*
- [ ] **SCRIPT-02**: User can open a remote script's content as a VS Code editor document
- [ ] **SCRIPT-03**: User can publish edited script content back to A365 via `gloScrUpdateScript` mutation
- [ ] **SCRIPT-04**: User can trigger remote script execution via `gloScrExecuteScript` mutation
- [ ] **SCRIPT-05**: Remote execution output is streamed to the VS Code Output Channel

### Packaging

- [x] **PKG-01**: `vsce package` produces an installable `.vsix` file
- [x] **PKG-02**: Single npm script (`npm run package`) compiles and packages in one step
- [x] **PKG-03**: `package.json` contains Marketplace-ready metadata: icon, description, categories, keywords, publisher
- [x] **PKG-04**: `README.md` contains install instructions and feature overview suitable for Marketplace listing
- [x] **PKG-05**: GitHub Actions CI workflow: compile → package → upload VSIX artifact

## v2 Requirements

### Auth UX

- **AUTH-V2-01**: User can sign in to multiple workspaces simultaneously (multi-workspace session)
- **AUTH-V2-02**: Token refresh errors surface as actionable VS Code notification (not silent failure)

### Script Management

- **SCRIPT-V2-01**: User can create a new remote script from within VS Code
- **SCRIPT-V2-02**: User can delete a remote script from the tree
- **SCRIPT-V2-03**: Diff view between local and remote script before publishing

### Distribution

- **PKG-V2-01**: Automated VS Code Marketplace publish via CI on tag push

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time collaborative script editing | High complexity, out of scope for developer tooling |
| Mobile or web UI | VS Code only |
| Bundler (webpack/esbuild) | Plain tsc output sufficient for current codebase size |
| Marketplace publish automation in v1 | Manual publish via PAT token for v1; CI pipeline TBD |
| Script version history / rollback | Not exposed by current A365 API surface |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PKG-01 | Phase 1: Packaging | Complete |
| PKG-02 | Phase 1: Packaging | Complete |
| PKG-03 | Phase 1: Packaging | Complete |
| PKG-04 | Phase 1: Packaging | Complete |
| PKG-05 | Phase 1: Packaging | Complete |
| PANEL-01 | Phase 2: Side Panel | Complete |
| PANEL-02 | Phase 2: Side Panel | Complete |
| PANEL-03 | Phase 2: Side Panel | Complete |
| PANEL-04 | Phase 2: Side Panel | Complete (superseded by PANEL-07) |
| PANEL-05 | Phase 2: Side Panel | Complete |
| PANEL-06 | Phase 2: Side Panel | Complete |
| PANEL-07 | Phase 02.1: Side-Panel UX Closure | Complete (02.1-01, 2026-05-19) |
| PANEL-08 | Phase 02.1: Side-Panel UX Closure | Pending |
| PANEL-09 | Phase 02.1: Side-Panel UX Closure | Pending |
| PANEL-10 | Phase 02.1: Side-Panel UX Closure | Complete |
| PANEL-11 | Phase 02.1: Side-Panel UX Closure | Pending |
| SCRIPT-01 | Phase 2: Side Panel | Deferred to Phase 3 (BLOCKED on live-workspace endpoint verification) |
| SCRIPT-02 | Phase 3: Remote Script Operations | Pending |
| SCRIPT-03 | Phase 3: Remote Script Operations | Pending |
| SCRIPT-04 | Phase 3: Remote Script Operations | Pending |
| SCRIPT-05 | Phase 3: Remote Script Operations | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-19*
*Last updated: 2026-05-19 after initial definition*
