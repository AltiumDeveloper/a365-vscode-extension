# Roadmap: Altium 365 VS Code Extension

## Overview

Three phases take the existing brownfield extension (OAuth, local run/debug, workspace switching all working) from a developer-only internal build to a distributable, publicly presentable tool with a rich side panel and full remote script workflow. Phase 1 makes it shippable, Phase 2 makes it navigable, Phase 3 makes remote scripting first-class.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Packaging** - Produce a distributable VSIX with CI pipeline and Marketplace-ready metadata
- [ ] **Phase 2: Side Panel** - Activity Bar tree showing workspaces, projects, and scripts with context actions
- [ ] **Phase 3: Remote Script Operations** - Open, edit, publish, and execute server-side scripts from the tree

## Phase Details

### Phase 1: Packaging
**Goal**: The extension is distributable as a signed VSIX with a one-command build and a CI pipeline that produces artifacts on every push
**Mode:** mvp
**Depends on**: Nothing (brownfield foundation already working)
**Requirements**: PKG-01, PKG-02, PKG-03, PKG-04, PKG-05
**Success Criteria** (what must be TRUE):
  1. Running `npm run package` produces a `.vsix` file installable in VS Code
  2. `package.json` contains icon, description, categories, keywords, and publisher fields so the extension renders correctly in Marketplace
  3. `README.md` explains installation steps and lists all features clearly enough for an external developer to get started
  4. GitHub Actions workflow runs compile → package → upload VSIX artifact on every push without manual steps
**Plans**: 2 plans
Plans:
- [ ] 01-01-PLAN.md — Package tooling, metadata, and icon (PKG-01, PKG-02, PKG-03)
- [ ] 01-02-PLAN.md — README rewrite and GitHub Actions CI pipeline (PKG-04, PKG-05)

### Phase 2: Side Panel
**Goal**: Users can navigate their A365 workspaces, projects, and scripts via a dedicated Activity Bar side panel without running any commands manually
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PANEL-01, PANEL-02, PANEL-03, PANEL-04, PANEL-05, PANEL-06, SCRIPT-01
**Success Criteria** (what must be TRUE):
  1. An A365 icon appears in the Activity Bar and opens the side panel
  2. The panel top level shows all workspaces the signed-in user has access to
  3. Expanding a workspace reveals its projects and its scripts as separate child nodes
  4. Right-clicking a script node shows context menu actions: Run Script, Edit Script, Execute Remotely, Publish Script
  5. The panel header or VS Code status bar shows the currently signed-in user and active environment
**Plans**: TBD
**UI hint**: yes

### Phase 3: Remote Script Operations
**Goal**: Users can open, edit, publish, and trigger execution of remote A365 scripts entirely from within VS Code, with execution output streamed back to the editor
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SCRIPT-02, SCRIPT-03, SCRIPT-04, SCRIPT-05
**Success Criteria** (what must be TRUE):
  1. Clicking "Edit Script" on a tree node opens the script content as a VS Code editor document
  2. After editing, "Publish Script" pushes the updated content back to A365 via the GraphQL mutation
  3. "Execute Remotely" triggers server-side execution of the script and shows a progress indicator
  4. Remote execution output appears in the VS Code Output Channel, streaming in real time
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Packaging | 0/? | Not started | - |
| 2. Side Panel | 0/? | Not started | - |
| 3. Remote Script Operations | 0/? | Not started | - |
