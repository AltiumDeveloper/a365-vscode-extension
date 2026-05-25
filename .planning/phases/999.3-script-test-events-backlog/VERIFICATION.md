---
phase: 999.3-script-test-events-backlog
verified: 2026-05-25T15:36:04Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "SCRIPT-V2-04.7: Both UI placements (submenu sub-row + standalone title-bar button) visible simultaneously on a .py editor for A/B trial"
    reason: "A/B trial was conducted during Plan 06; outcome (UAT iter 5) was that Placement B (standalone title-bar button) lost to the StatusBarItem + Placement A combination. Requirement was satisfied at trial time and intentionally reduced per the requirement's own stated purpose ('for A/B trial'). Documented in 999.3-PHASE-SUMMARY.md §Removed Surfaces and 999.3-06-SUMMARY.md UAT iter 5."
    accepted_by: "verifier"
    accepted_at: "2026-05-25T15:36:04Z"
human_verification: []
---

# Phase 999.3: Script Test-Events Verification Report

**Phase Goal:** Ship AWS-Lambda-style named "test events" for script parameters — multiple named templates per script, shared across local run / debug / remote execute, edited as JSON with schema validation, surfaced via picker + status bar + editor-title submenu. Replace the legacy single-value `altium365.inputParametersPath` setting.

**Verified:** 2026-05-25T15:36:04Z
**Status:** PASS
**Re-verification:** No — initial verification

## Sub-Requirement Verification (SCRIPT-V2-04)

| #     | Sub-Requirement                                                                            | Status | Evidence |
| ----- | ------------------------------------------------------------------------------------------ | ------ | -------- |
| 04.1  | `resolveScriptIdentity` returns `kind: 'remote'` for tmp files in cache and `altium365://` URIs | ✓ PASS | `src/testEvents/identity.ts:45-65` — branches on `uri.scheme === 'altium365'` (returns remote) and `getLocalScript(uri.fsPath)` cache hit (returns remote with workspaceAuthId) |
| 04.2  | `resolveScriptIdentity` returns `kind: 'local'` for arbitrary `file://` `.py` URIs not in cache | ✓ PASS | `src/testEvents/identity.ts:66` — `return { kind: 'local', identity: normalizeLocalScriptKey(uri.fsPath) }` |
| 04.3  | `resolveScriptParameters` returns silent default when one exists (no UI)                   | ✓ PASS | `src/testEvents/resolver.ts:104-106` — "Happy path — silent default" returns `stringifyEvent(store.events[store.defaultEventName])` with no prompt |
| 04.4  | First-run prompt fires when store empty and `promptOnFirstRun` is true                     | ✓ PASS | `src/testEvents/resolver.ts:66-80` — empty-store branch returns `undefined` when `!promptOnFirstRun`, otherwise dispatches `altium365.testEvents.create` |
| 04.5  | Cmd+S on `altium365-event://` URI commits payload to `globalState`                         | ✓ PASS | `src/testEvents/eventFs.ts:115-155` `TestEventFs.writeFile` parses JSON, strips `$schema`, calls `writeStore`; activated at `src/extension.ts:106` and registered via `package.json:270-275` `jsonValidation` |
| 04.6  | Sibling `.params.json` import prompt fires once, marker prevents re-prompt                 | ✓ PASS | `src/testEvents/importSibling.ts:22-78` — checks `IMPORT_MARKER_PREFIX` then prompts; sets marker to abs path on import or `__declined__` on Never; invoked from `resolver.ts:54-56` |
| 04.7  | Both UI placements visible simultaneously on a `.py` editor for A/B trial                  | ✓ PASS (override) | A/B trial concluded — Placement B was deliberately removed in Plan 06 UAT iter 5 (`999.3-PHASE-SUMMARY.md:49`, `999.3-06-SUMMARY.md:21,106`) after side-by-side comparison with StatusBarItem + Placement A. Final surfaces: status bar (`src/testEvents/statusItem.ts:48`) + submenu Placement A (`package.json:344-348`, group `4_events@1`). |
| 04.8  | `altium365.promptForProjectId` setting becomes a no-op (deprecated; replaced by project-related preset) | ✓ PASS (exceeded) | Setting was removed entirely in Plan 06 UAT iter 6 — no longer in `package.json` (verified zero matches in commands/configuration), no readers in source (only doc-comments at `src/remoteExecution.ts:35,173`). Functionally equivalent to no-op; goes beyond requirement. |
| 04.9  | `prepareRun` (local) and `executeRemoteScript` Block B (remote) both route through `resolveScriptParameters` | ✓ PASS | Local: `src/extension.ts:854-859` calls `resolveScriptParameters(context, idResult, outputChannel, { promptOnFirstRun: true })`. Remote: `src/remoteExecution.ts:176-181` calls the same function with `{ kind: 'remote', identity: args.scriptId }`. Single helper at `src/testEvents/resolver.ts:43-107`. |
| 04.10 | Soft warning toast fires once at 26th event per identity; suppressible per identity        | ✓ PASS | `src/testEvents/commands.ts:19` `BLOAT_WARN_THRESHOLD = 25`; `commands.ts:286-290` fires when `totalEvents > BLOAT_WARN_THRESHOLD && !isBloatWarned(...)` then calls `markBloatWarned`; per-identity flag at `src/testEvents/store.ts:14,126-138` (`altium365.scriptParams.bloatWarned.<identity>`) |

**Score:** 10/10 sub-requirements verified.

## Required Artifacts

| Artifact | Status | Lines | Details |
| -------- | ------ | ----- | ------- |
| `src/testEvents/identity.ts` | ✓ VERIFIED | 69 | `ScriptIdentity` union + `resolveScriptIdentity` |
| `src/testEvents/store.ts` | ✓ VERIFIED | 138 | CRUD + change emitter + bloat-warn flags |
| `src/testEvents/resolver.ts` | ✓ VERIFIED | 122 | Unified resolver with AsyncMutex |
| `src/testEvents/commands.ts` | ✓ VERIFIED | 592 | 5 commands registered (see Wiring) |
| `src/testEvents/picker.ts` | ✓ VERIFIED | 159 | Unified QuickPick with Create/Edit inline |
| `src/testEvents/statusItem.ts` | ✓ VERIFIED | 162 | StatusBarItem with `$(symbol-event)` icon |
| `src/testEvents/eventFs.ts` | ✓ VERIFIED | 181 | `TestEventFs : FileSystemProvider` |
| `src/testEvents/importSibling.ts` | ✓ VERIFIED | 79 | One-shot prompt with declined marker |
| `schemas/test-event.schema.json` | ✓ VERIFIED | 12 | Draft-07, `projectId` typed, `additionalProperties: true` |

## Key Link Verification (Wiring)

| From | To | Via | Status | Evidence |
| ---- | -- | --- | ------ | -------- |
| `extension.ts` activation | `TestEventFs` | `new TestEventFs(context, outputChannel)` | ✓ WIRED | `src/extension.ts:106` |
| `extension.ts` activation | 5 commands | `registerTestEventCommands(context, outputChannel)` | ✓ WIRED | `src/extension.ts:115`, command IDs at `src/testEvents/commands.ts:61-106` |
| `extension.ts` activation | Status bar | `registerTestEventStatusItem(context)` | ✓ WIRED | `src/extension.ts:116`, statusBarItem with click → `altium365.testEvents.pick` |
| `prepareRun` | Unified resolver | `resolveScriptParameters(context, idResult, outputChannel, ...)` + tmpfile write | ✓ WIRED | `src/extension.ts:852-874` (tmpfile-always, no `inputParametersPath` branch) |
| `executeRemoteScript` Block B | Unified resolver | `resolveScriptParameters(args.context, { kind: 'remote', identity: args.scriptId }, args.output, ...)` | ✓ WIRED | `src/remoteExecution.ts:176-181` |
| `package.json` jsonValidation | Bundled schema | `"fileMatch": "altium365-event:/**/*.json"`, `"url": "./schemas/test-event.schema.json"` | ✓ WIRED | `package.json:270-275` |
| `package.json` submenu | `altium365.testEvents.pick` | `"group": "4_events@1"` inside `altium365.editorTitle` submenu | ✓ WIRED | `package.json:344-348` |
| `package.json` editor/title | Branded submenu | `"submenu": "altium365.editorTitle"` when `resourceLangId == python` | ✓ WIRED | `package.json:321-326` |
| README `## Test Events` | Concept + commands + UI | Documents 5 commands, picker, status bar, submenu, globalState semantics | ✓ WIRED | `README.md:76-105` |

## Legacy-Surface Removal Audit

| Legacy Surface | Expected | Actual | Status |
| -------------- | -------- | ------ | ------ |
| `altium365.inputParametersPath` in `package.json` `contributes.configuration.properties` | absent | absent (0 grep matches in package.json) | ✓ REMOVED |
| `altium365.promptForProjectId` in `package.json` | absent | absent (0 grep matches in package.json) | ✓ REMOVED |
| `inputParametersPath` readers in `src/` | none in code | only 1 doc-comment at `src/extension.ts:844` | ✓ CLEAN |
| `promptForProjectId` readers in `src/` | none in code | only 2 doc-comments at `src/remoteExecution.ts:35,173` | ✓ CLEAN |
| Sibling `.params.json` auto-resolve fallback in `prepareRun` | gone (opt-in via prompt only) | `src/extension.ts:850-875` calls unified resolver only; sibling logic lives inside `importSibling.ts` and is opt-in | ✓ CLEAN |
| Standalone editor-title test-events button (Placement B) | removed after A/B trial | `package.json` `editor/title` contains only the branded submenu entry | ✓ REMOVED |

## Behavioural Spot-Checks

| Check | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| Project compiles | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Legacy settings unreferenced in source | `grep -n "inputParametersPath\|promptForProjectId" src/**/*.ts` | 3 matches, all in doc comments | ✓ PASS |
| All 5 test-event commands declared | `grep "altium365.testEvents\." package.json` | 5 unique command IDs (`pick`, `create`, `edit`, `delete`, `setDefault`) | ✓ PASS |
| Resolver consumed by both run paths | `grep "resolveScriptParameters" src/extension.ts src/remoteExecution.ts` | 2 callsites (one each) | ✓ PASS |
| Status bar wired | `grep registerTestEventStatusItem src/extension.ts` | 1 callsite in activation | ✓ PASS |

## Anti-Patterns Found

None blocking. No debt markers (`TBD`/`FIXME`/`XXX`) in the touched source files for this phase.

## Goal Achievement (Goal-Backward Trace)

**Goal:** Ship AWS-Lambda-style named test events shared across local/remote, edited as JSON with schema validation, surfaced via picker + status bar + editor-title submenu; replace legacy `altium365.inputParametersPath`.

Working backward:

1. **Picker surface** → unified `altium365.testEvents.pick` QuickPick (`src/testEvents/picker.ts:108`) listing events + Create/Edit inline, wired to status bar (`statusItem.ts`) and submenu (`package.json:344-348`). ✓
2. **JSON editing with schema validation** → custom FileSystemProvider on `altium365-event://` (`eventFs.ts:75-155`), schema bound declaratively (`package.json:270-275`) AND injected at read (`eventFs.ts:107-112`). ✓
3. **Multiple named templates per script** → `TestEventStore = { defaultEventName, events: Record<name, payload> }` (`store.ts:29-32`); 5 commands manage lifecycle. ✓
4. **Shared across local run / debug / remote execute** → single `resolveScriptParameters` helper called from both `prepareRun` (`extension.ts:854`) and `executeRemoteScript` Block B (`remoteExecution.ts:176`). ✓
5. **Per-script identity** → `resolveScriptIdentity` returns `remote` (scriptId UUID) or `local` (normalized fsPath) (`identity.ts:45-68`). ✓
6. **Legacy setting replaced** → `altium365.inputParametersPath` and `altium365.promptForProjectId` removed end-to-end from `package.json` and all consuming code. ✓

All 6 derived goal-truths verified in code.

## Overall Verdict

**PASS** — all 10 SCRIPT-V2-04 sub-requirements satisfied (one via an intentional, well-documented override on SCRIPT-V2-04.7 where the A/B trial concluded with Placement B retired), both run paths converge on a single resolver, legacy `inputParametersPath`/`promptForProjectId` are removed end-to-end, JSON schema validation wired via dual-layer strategy, TypeScript compile clean.

---

_Verified: 2026-05-25T15:36:04Z_
_Verifier: gsd-verifier_
