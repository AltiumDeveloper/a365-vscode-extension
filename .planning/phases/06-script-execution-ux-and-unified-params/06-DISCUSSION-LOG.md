# Phase 6: Script Execution UX & Unified Parameters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 06-script-execution-ux-and-unified-params
**Areas discussed:** Workspace-context routing, Parameter model, Tmp file naming + GRID, Title-bar dropdown + .py scope, Save-back after debug, Stretch scope (item 9)

---

## Workspace-context routing

### Behavior on non-active workspace

| Option | Description | Selected |
|--------|-------------|----------|
| Transparent token (no active switch) | Silently use the script's workspace token/endpoint for one execution; active workspace stays untouched. | ✓ |
| Auto-switch active workspace | Switch active workspace silently to the script's owner; tree refresh, status bar update. | |
| Prompt the user when mismatch detected | Show "This script lives in workspace B. Run there? [Once / Switch / Cancel]". | |

### Plumbing approach

| Option | Description | Selected |
|--------|-------------|----------|
| Plumb identity through runScriptAtPath/debugScriptAtPath | Optional `target` arg; node-aware callers pass workspace; palette commands pass undefined. | ✓ |
| Resolve from localScriptCache inside prepareRun | Implicit lookup based on file fsPath; standalone .py falls back to active. | |

### Standalone .py fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to active workspace | Match today's behavior; prompt to select if no active. | ✓ |
| Cache lookup first, then active fallback | Lookup file in cache; if present use its workspace; else active. | |
| Require cache hit — no active fallback | Refuse to run unless workspace identifiable. | |

---

## Parameter model (items 3 + 9)

### Ambition for this phase

| Option | Description | Selected |
|--------|-------------|----------|
| Full test-events as THE unified model | Ship items 3+9 together; named test events stored per script. | |
| Minimal bridge now — align remote with local | Add projectId prompt to remote; share last-pick cache. Test-events deferred. | ✓ |
| Minimal bridge + activate reserved per-script state key | Same but also write a stub UI for `altium365.scriptParams.<scriptId>`. | |

### Remote param discovery (minimal bridge)

| Option | Description | Selected |
|--------|-------------|----------|
| Sibling .params.json lookup by fsPath | Match local literally; won't usually exist for tmp files. | |
| Use reserved workspaceState key for remote | Manually edited blob (no UI) for remote; local keeps sibling. | |
| Just add projectId prompt to remote — no per-script storage | Skip persistent storage; only projectId prompt fallback. | ✓ |

**User notes:** Explicitly chose the smallest possible bridge — the per-script storage will be owned by the test-events phase (999.3).

### Last-pick caching

| Option | Description | Selected |
|--------|-------------|----------|
| Share `altium365.lastProjectId.<wsId>` between local and remote | One workspace key, both modes read/write. | ✓ |
| Separate last-pick key for remote | Avoid any chance of stale local cache breaking remote. | |
| No caching, prompt every time | Always fresh; annoying. | |

---

## Tmp file naming + GRID

### GRID definition

| Option | Description | Selected |
|--------|-------------|----------|
| GRID = scriptId (existing field) | Use scriptId directly. | |
| Spike required — separate GRID field | Researcher probes schema; adds field to ScriptInfo. | |
| Skip GRID — just use script name | Use slugified name; scriptId only on collision. | |

**User-supplied answer:** `grid:workspace:{workspace-id}:scripts:script/{id}` where `{id}` = scriptId from GraphQL, `{workspace-id}` = workspace authId (GUID). → CONTEXT.md D-09 synthesizes this client-side; no schema spike needed.

### Tmp filename format

| Option | Description | Selected |
|--------|-------------|----------|
| Subdirectory hierarchy, name in filename | `tmpdir/altium365/<authId>/<scriptId>/<safeName>.py`; tab title clean. | ✓ |
| Flat filename containing authId+scriptId+name | `altium365-<authId>-<scriptId>-<safeName>.py`; long tab. | |
| Literal GRID-encoded filename | Sanitized full grid string as filename; unreadable tab. | |

### Migration

| Option | Description | Selected |
|--------|-------------|----------|
| No migration — old tmp files remain valid | Old layout keeps working until naturally purged. | ✓ |
| Active cleanup at startup | Scan tmp for `altium365-*.py` and delete; risk of clobber. | |
| Defer the rename entirely | Skip the tmp naming change. | |

---

## Title-bar dropdown + .py scope

### Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| VS Code submenu in editor/title | `contributes.submenus` entry rendered as branded button. | ✓ |
| Drop dropdown — keep flat but contextual | Only show 1-2 most-relevant icons. | |
| Single command that opens a QuickPick | Title-bar button opens QuickPick. | |

### Item visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Context-sensitive items | Remote-tmp: all 4; standalone .py: Run/Debug Local only. | ✓ |
| Always show all four; toast on invalid invocation | Always-visible; runtime check shows toast. | |
| Include 'Link to Remote Script' on standalone .py | 5th item to link a local .py to a remote script. | |

### Detection mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Combined when-clause + handler check | when-clause filters at UI; handler enforces truth via cache lookup. | ✓ |
| Set a contextKey from active editor | `setContext('altium365.activeIsRemoteScript', ...)` driven by editor-change listener. | |
| Keep regex-only gating; update for new tmp layout | Update `resourceFilename` regex for new path pattern. | |

**Note:** Selection was "combined when-clause + handler check"; D-15 implements that by ALSO using a contextKey (the contextKey is the when-clause's data source). Both layers exist: setContext drives the when-clause, handler does a defensive re-check.

---

## Save-back after Debug Local

| Option | Description | Selected |
|--------|-------------|----------|
| Add UAT scenario; no code change | Per scout, code path is already correct. UAT verifies. | ✓ |
| Defensive re-registration on debug session start | Cheap insurance even if bug doesn't repro. | |
| Investigation plan first, then decide | Schedule explicit repro task as first plan. | |

---

## Stretch scope (item 9 test events)

| Option | Description | Selected |
|--------|-------------|----------|
| Drop item 9 from this phase; backlog it | Phase 6 covers 8 polish items; test-events becomes Phase 999.3. | ✓ |
| Keep item 9 — ship test-events in this phase | 4th plan; bigger scope, more UI design. | |
| Defer item 9, but lock its data model now | Forward-compat schema even without UI. | |

---

## the agent's Discretion

- Exact submenu group ordering and visual separation (D-14 ordering proposed; planner can adjust).
- Whether the new submenu trigger uses the existing `media/altium365.png` brand icon or a fresh codicon — proposed brand icon per specifics; planner can validate.
- UAT scenario phrasing and ordering — captured in D-24, planner expands.

## Deferred Ideas

- **Item 9: AWS-Lambda-style named "test events" for script parameters.** → Added to ROADMAP backlog as Phase 999.3.
- **"Link to Remote Script" command** on standalone .py — captured during D-15 discussion; deferred (adds new picker UI + persistent local↔remote mapping).
- **Defensive re-registration on debug session start** — rejected in favor of UAT verification (D-04); could resurface if UAT confirms a gap.
- **Active cleanup of legacy tmp files** — rejected in favor of natural purge (D-11).
- **First-class `grid` GraphQL field on script entities** — synthesized client-side for now (D-09); swap in if Altium adds it later.
- **Telemetry on cross-workspace routing frequency** — would inform whether transparent-token UX or prompt option is correct long-term.
- **Tree multi-select for batch operations** — out of scope; noted for completeness.
