# Requirements: Altium 365 VS Code Extension

**Defined:** 2026-05-19
**Core Value:** A developer can open VS Code, sign in once, and go from browsing their A365 workspace to running or deploying a script — without leaving the editor or hand-crafting API calls.

## v1 Requirements

### Side Panel

- [ ] **PANEL-01**: Activity Bar entry point opens the A365 side panel
- [ ] **PANEL-02**: Side panel shows a list of workspaces the user has access to at the top level
- [ ] **PANEL-03**: Each workspace expands to show its projects
- [ ] **PANEL-04**: Each workspace expands to show its scripts (sibling to projects)
- [ ] **PANEL-05**: Scripts have context menu actions: Run Script (locally), Edit Script, Execute Remotely, Publish Script
- [x] **PANEL-06**: Auth status (signed-in user, active environment) is visible in the panel header or status bar

### Remote Scripts

- [x] **SCRIPT-01**: User can list all scripts in the selected workspace via `gloScrScripts` query
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
| PANEL-01 | Phase 2: Side Panel | Pending |
| PANEL-02 | Phase 2: Side Panel | Pending |
| PANEL-03 | Phase 2: Side Panel | Pending |
| PANEL-04 | Phase 2: Side Panel | Pending |
| PANEL-05 | Phase 2: Side Panel | Pending |
| PANEL-06 | Phase 2: Side Panel | Complete |
| SCRIPT-01 | Phase 2: Side Panel | Complete |
| SCRIPT-02 | Phase 3: Remote Script Operations | Pending |
| SCRIPT-03 | Phase 3: Remote Script Operations | Pending |
| SCRIPT-04 | Phase 3: Remote Script Operations | Pending |
| SCRIPT-05 | Phase 3: Remote Script Operations | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-19*
*Last updated: 2026-05-19 after initial definition*
