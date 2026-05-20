---
phase: 03-remote-script-ops
mode: mvp
roadmap_ref: ".planning/ROADMAP.md#phase-3-remote-script-operations"
requirements:
  - SCRIPT-02
  - SCRIPT-03
  - SCRIPT-04
  - SCRIPT-05
plans:
  - 03-01-files-foundation
  - 03-02-fsp-and-wiring
  - 03-03-open-publish
  - 03-04-execute-stream
  - 03-05-uat-readme-error-map
---

# Phase 3 — Remote Script Operations — PLAN

## Phase Goal

> Users can open, edit, publish, and trigger execution of remote A365 scripts entirely from within VS Code, with execution output streamed back to the editor.

User-story framing (MVP):

**As an** A365 script developer, **I want to** open / edit / publish / execute remote scripts directly from VS Code, **so that** I don't have to round-trip through the browser-based A365 portal to iterate on a script.

## Plan units (atomic commits, COARSE granularity)

| # | Plan | Wave | Depends on | Files (main) |
|---|------|------|------------|--------------|
| 1 | `03-01-files-foundation` — Files Service REST contract (smoke-probe) + `filesServiceUrl` schema bump + `getWorkspaceFilesUrl` + typed GraphQL errors | 1 | — | `src/workspace.ts`, `src/filesService.ts` (new) |
| 2 | `03-02-fsp-and-wiring` — `altium365:` FileSystemProvider skeleton, `remoteExecution.ts` stub, command/menu wiring (replace 02.x placeholders, add editor/title menu) | 2 | 03-01 | `src/remoteScriptFs.ts` (new), `src/remoteExecution.ts` (new), `src/extension.ts`, `src/scriptCommands.ts`, `package.json` |
| 3 | `03-03-open-publish` — `readFile` (GraphQL `gloScrScript` + Files Service GET) and `writeFile` (Files Service PUT/POST + `gloScrUpdateScript`) real implementations | 3 | 03-02 | `src/remoteScriptFs.ts`, `src/workspace.ts` |
| 4 | `03-04-execute-stream` — `gloScrExecuteScript` + 1.5 s poll loop + log-page tail + OutputChannel streaming + `withProgress` cancellation | 3 | 03-02 (parallel with 03-03 — disjoint files) | `src/remoteExecution.ts`, `src/workspace.ts` |
| 5 | `03-05-uat-readme-error-map` — `03-UAT.md` (≥5 scenarios), README D-02 caveat + Phase 3 feature blurb, D-11 friendly-error pass for update/execute at command boundary | 4 | 03-03, 03-04 | `.planning/phases/03-remote-script-ops/03-UAT.md`, `README.md`, `src/scriptCommands.ts` |

**Total:** 5 plan units across 4 waves.

## Wave / dependency graph

```
Wave 1 ─ 03-01 (foundation: workspace schema + Files REST contract + typed GraphQL errors)
              │
Wave 2 ─ 03-02 (FSP skeleton + wiring; depends on 03-01 type imports)
              │
Wave 3 ─ 03-03 (open+publish: readFile/writeFile real)        ┐
       ─ 03-04 (execute+stream: remoteExecution real)         │  parallel — disjoint files
              │                                               │
Wave 4 ─ 03-05 (UAT + README + error-map polish) ─────────────┘
```

Same-wave plans (03-03, 03-04) have zero `files_modified` overlap (one owns `remoteScriptFs.ts`, the other owns `remoteExecution.ts`; both extend `src/workspace.ts` but in non-overlapping line ranges: 03-03 adds `getScript` / `updateScript`, 03-04 adds `executeScript` / `getExecutionResult` — coordinate at file end, separate exports). If merge conflict materializes, demote 03-04 to Wave 4 (still parallel-safe with 03-05).

## Goal-backward verification — must-haves

### Truths (user-observable)
1. T-1 — Tree → right-click script → **Edit Script** opens an editor with the live remote source.
2. T-2 — Editing + `Ctrl+S` (or right-click → **Publish Script**) pushes the new content back to A365; the script's next read returns it.
3. T-3 — Tree → right-click script → **Execute Remotely** shows a cancellable progress notification.
4. T-4 — Server-side log lines from the remote execution stream to the OutputChannel in real time.
5. T-5 — Cancelling the progress notification stops local polling and writes a clear "(server-side execution continues)" line to OutputChannel.
6. T-6 — Failures (network, auth, GraphQL) surface as actionable VS Code notifications with full detail in OutputChannel (D-11 pattern).

### Artifacts (must exist post-phase)
| Path | Provides |
|------|----------|
| `src/remoteScriptFs.ts` (new) | FileSystemProvider for `altium365:` scheme — registered in `activate` |
| `src/remoteExecution.ts` (new) | `executeRemoteScript(...)` + poll loop |
| `src/filesService.ts` (new) | `downloadByToken` + `uploadAndGetToken` — Files REST client |
| `src/workspace.ts` (extended) | `getScript`, `updateScript`, `executeScript`, `getExecutionResult`, `getExecutionLogs`; `listWorkspaces` query carries `filesServiceUrl`; `getWorkspaceFilesUrl` helper |
| `package.json` (extended) | `editor/title` menu when `resourceScheme == altium365` (Publish + Execute Remotely buttons); existing `view/item/context` script menu entries become live (no schema change — handlers replace placeholders) |
| `.planning/phases/03-remote-script-ops/03-UAT.md` (new) | ≥5 manual UAT scenarios |
| `README.md` (extended) | "Remote scripts" section + D-02 blind-overwrite caveat + "(server-side execution continues)" note |

### Key links (where breakage cascades)
- `WorkspaceInfo.location.filesServiceUrl` populated by `listWorkspaces` → every FSP `readFile`/`writeFile` reads it via `getWorkspaceFilesUrl`. If the query bump regresses, the very first open throws (Pitfall 3).
- `ensureWorkspaceToken` is the **only** token source in `remoteScriptFs.ts` and `remoteExecution.ts` (D-08). No module-level token cache anywhere.
- Every GraphQL call routes through `getWorkspaceApiUrl(ws, envGlobal)` (D-07 / 02.3 D-19). The new FSP resolves `ws` by `workspaceId` parsed from the URI host segment.
- OutputChannel is the shared module-level singleton from `extension.ts` (D-09). No new channels.

## Invariants (every plan re-asserts these)

Phase 02.2:
- `getBaseAccessToken` / `getActiveAccessToken` / `ensureWorkspaceToken` / `workspaceTokenMutex` / `AsyncMutex` UNCHANGED.
- `clearAllTokens` pre-drain in `signIn` UNCHANGED.
- Secret storage keys, format, and access pattern UNCHANGED.
- Per-workspace token index + auth state emitter UNCHANGED.

Phase 02.3:
- **D-17** — ActionWait long-poll continues to use Node `https` (`postJson`); new code in Phase 3 may use `globalThis.fetch` (consistent with existing `graphqlRequest` and Files Service REST).
- **D-18** — `selectEnvironment` event ordering UNCHANGED; no new `fireAuthStateChanged` call sites in Phase 3.
- **D-19** — Every new GraphQL call routes through `getWorkspaceApiUrl(...)`. Every new Files Service call routes through the equivalent `getWorkspaceFilesUrl(...)` helper introduced in 03-01.

Cross-cutting:
- All commands prefixed `altium365.` (existing `altium365.script.edit` / `altium365.script.publish` / `altium365.script.executeRemote` placeholders are replaced — no new command IDs, no new menu schema entries beyond the editor/title bar additions in 03-02).
- No automated tests (D-12 / D-13).
- No new npm dependencies (RESEARCH §Standard Stack confirms zero new packages).

## Open questions surviving planning

| # | Question | Owner | Resolution path |
|---|----------|-------|-----------------|
| 1 | Files Service REST path/verb/content-type for download AND upload (RESEARCH Open Question 1, Assumptions A1/A2) | 03-01 executor | Blocking human checkpoint with browser-devtools smoke-probe against `365.altium.com`. Result is **committed inline** in `src/filesService.ts`. |
| 2 | Terminal values of `GloScrScriptExecution.status` (RESEARCH Open Question 2, Assumption A3) | 03-04 executor → 03-05 UAT | Start with curated set (`Succeeded`/`Failed`/`Cancelled`/`Stopped`/`Completed`/`Error`, case-insensitive) + 10-min wall-clock backstop. Log every observed value to OutputChannel during 03-05 UAT and tighten if needed (fix-forward — no further plan if curated set holds). |
| 3 | `GloScrScriptOutput` field shape (RESEARCH Open Question 3) | — | Deferred. v1 only displays `exitCode` in OutputChannel footer; `returnValues` are not rendered. Revisit in v2 only if a requirement appears. |
| 4 | Whether `getScript → versions(first:1, order: DESC timestamp)` always yields the "current" published version (Assumption A5) | 03-03 UAT (in 03-05) | If A365 has a separate "current" marker, fix forward in 03-03 (one-line query tweak). |

## Verification (phase-level)

- `npm run compile` clean.
- All five manual UAT scenarios in `03-UAT.md` pass against the dev1 endpoint with a real workspace (token already configured from Phase 02.3 UAT).
- Phase 02.2 / 02.3 regression sanity: sign-in, env switch, workspace switch, sign-out, local `runScript` still work after the FSP is registered and after a successful round-trip of open → edit → publish → execute.

## Success criteria (per ROADMAP)

1. ✅ Clicking "Edit Script" opens script content as a VS Code editor document — 03-02 wires, 03-03 implements `readFile`.
2. ✅ "Publish Script" / `Ctrl+S` pushes content via `gloScrUpdateScript` — 03-03 implements `writeFile` (Files Service PUT/POST + GraphQL mutation, two-step per RESEARCH Pattern 1).
3. ✅ "Execute Remotely" triggers server-side execution with cancellable progress indicator — 03-04.
4. ✅ Remote execution output streams to OutputChannel — 03-04 (1.5 s status poll + log-page tail).

## Output

Each plan unit creates `.planning/phases/03-remote-script-ops/03-NN-SUMMARY.md` on completion.
