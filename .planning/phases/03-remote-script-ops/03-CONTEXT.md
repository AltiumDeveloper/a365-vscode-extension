---
phase: 03-remote-script-ops
mode: mvp
roadmap_ref: ".planning/ROADMAP.md#phase-3-remote-script-operations"
requirements:
  - SCRIPT-02
  - SCRIPT-03
  - SCRIPT-04
  - SCRIPT-05
---

# Phase 3 — Remote Script Operations — CONTEXT

## Goal (verbatim from ROADMAP)

> Users can open, edit, publish, and trigger execution of remote A365 scripts entirely from within VS Code, with execution output streamed back to the editor.

## Success criteria (verbatim from ROADMAP)

1. Clicking "Edit Script" on a tree node opens the script content as a VS Code editor document.
2. After editing, "Publish Script" pushes the updated content back to A365 via the GraphQL mutation.
3. "Execute Remotely" triggers server-side execution of the script and shows a progress indicator.
4. Remote execution output appears in the VS Code Output Channel, streaming in real time.

## Canonical references (locked sources of truth)

- `AGENTS.md` — project context, GSD workflow, conventions summary.
- `.planning/REQUIREMENTS.md` — SCRIPT-02..05 (lines 25–28).
- `.planning/codebase/CONVENTIONS.md` — VS Code command prefix (`altium365.`), async/await, `graphqlRequest` reuse, OutputChannel singleton.
- `.planning/codebase/INTEGRATIONS.md` — A365 GraphQL surface; Python runtime contract.
- `.planning/phases/02.3-actionwait-auth/02.3-CONTEXT.md` — **D-19 (per-workspace `apiServiceUrl`)** is THE non-negotiable for every GraphQL call in this phase.
- `.planning/phases/02.2-auth-hardening/02.2-CONTEXT.md` — auth surface invariants (`ensureWorkspaceToken`, mutex, secret storage). Phase 3 must not regress these.
- `src/workspace.ts` — existing `graphqlRequest`, `listScripts`, `getWorkspaceApiUrl`. Reuse, don't re-implement.
- `src/sidePanel.ts` — tree script nodes already carry `workspaceId`, `workspaceAuthId`, `script.scriptId`. Reuse for action plumbing.
- `src/treeCommands.ts` — existing script context-menu commands (Copy ID etc.). Extend, don't replace.

## Code context (current state, post-02.3)

- Script nodes exist in the tree with `scriptId`, `name`, `description` and parent workspace info (`workspaceId`, `workspaceAuthId`).
- Workspace token + per-workspace `apiServiceUrl` already resolvable via `ensureWorkspaceToken` + `getWorkspaceApiUrl(getSelectedWorkspace(ctx), envGlobalEndpoint)`.
- No FileSystemProvider exists. No `altium365:` URI scheme registered.
- No script-content read mutation/query has been called yet (`gloScrScript` shape TBD by researcher).
- No `gloScrUpdateScript` / `gloScrExecuteScript` call sites yet.
- OutputChannel singleton `outputChannel` exists in `src/extension.ts` — reuse for streaming.

## Decisions (LOCKED)

- **D-01 (Edit-buffer model):** Implement a `vscode.FileSystemProvider` registered for the `altium365:` URI scheme. URI shape: `altium365://<workspaceId>/<scriptId>/<scriptName>.py` (scriptName is for display only; workspaceId + scriptId are the lookup key). `readFile` fetches script content via GraphQL using the workspace's `apiServiceUrl` + workspace token. `writeFile` pushes via `gloScrUpdateScript`. Save (`Ctrl+S`) implicitly publishes — see D-03.
- **D-02 (Publish conflict handling):** **Blind overwrite, last-write-wins.** No version/etag check, no remote-modified detection. README must document: "If two clients edit the same script, the most recent save wins. Coordinate edits out-of-band for now." This is acceptable for v1 (solo-dev workflows); a diff/conflict UI is already deferred to `SCRIPT-V2-03`.
- **D-03 (Save = Publish):** Saving an `altium365:` document publishes immediately. No separate "Publish" command in the editor — the FileSystemProvider's `writeFile` IS the publish. Failed publishes (network, auth) throw via `FileSystemError` so VS Code shows the standard save-failure indicator and the file stays dirty for retry. Tree context menu still includes "Publish" as an explicit action — it equates to `document.save()` for that script's URI (or no-op if not currently open / not dirty).
- **D-04 (Remote execution model):** **Deferred to research.** Planner spawns `gsd-phase-researcher` to investigate `gloScrExecuteScript`'s actual input + return + output-streaming shape against the live Altium GraphQL schema (introspection + dev1 endpoint smoke probe). Output of research dictates whether D-04a (sync mutation), D-04b (async + poll), or D-04c (subscription/SSE) applies. Plan stalls execution-related plans until research lands.
- **D-05 (Execute params):** Reuse the existing `.params.json` convention. For a remote script with URI `altium365://<wsId>/<scriptId>/<name>.py`, parameters are sourced (in priority order):
  1. A workspace-state-tracked `altium365.scriptParams.<scriptId>` JSON blob (populated by a future "Set Parameters" command — out of scope this phase; key reserved).
  2. The same prompt-for-projectId fallback used by `runScript` today (`altium365.promptForProjectId` config; default true).
  Local-script `.params.json` behavior is unchanged.
- **D-06 (UI surface):** New commands live in:
  - **Tree context menu** on script nodes: `Open` (default action also on double-click), `Publish` (no-op unless open + dirty), `Execute Remotely`.
  - **Editor title bar** when an `altium365:` document is active: `Publish` button + `Execute Remotely` button (using `editor/title` menu when `resourceScheme == altium365`).
  - **NO command palette entries** for these. Discoverability via the tree is sufficient; palette stays clean.
- **D-07 (Endpoint routing):** Every GraphQL call in this phase MUST resolve its endpoint via `getWorkspaceApiUrl(workspaceInfo, envGlobalEndpoint)` (D-19 from Phase 02.3). The FileSystemProvider must resolve the workspace's `apiServiceUrl` from `workspaceId` in the URI — either by looking up the cached `WorkspaceInfo` (sidePanel cache or selectedWorkspace) or by re-listing workspaces if not cached.
- **D-08 (Auth):** Use `ensureWorkspaceToken(ctx, cfg, {workspaceId, authId})` for every workspace-scoped GraphQL call. The FileSystemProvider must NOT cache tokens itself — always go through the existing mutex-protected helper.
- **D-09 (OutputChannel for execution):** Reuse the existing module-level `outputChannel` (named "Altium 365") rather than creating a per-execution or per-script channel. Header line per execution: `\n[Altium 365] Executing <scriptName> (scriptId=<...>, workspace=<wsName>)\n`. Footer line on completion: `[Altium 365] Remote execution finished (exit=<code or 'ok'>)`. The channel reveals itself (`outputChannel.show(true)`) at execution start, same UX as the local `runScript`.
- **D-10 (Cancellation):** Execute Remotely shows `vscode.window.withProgress({cancellable: true, location: Notification})`. Cancel:
  - Stops local polling/streaming.
  - Calls a server-side cancel mutation IF research (D-04) reveals one. Otherwise the server execution continues but the client detaches (document this).
- **D-11 (Error mapping):** Reuse the OAuth-error-mapping pattern just landed in `doSignIn` (commit `a00dcc0`) for `gloScrUpdateScript` / `gloScrExecuteScript` failures. User-facing messages keyed on well-known A365 GraphQL error codes (TBD by research); full body to OutputChannel for debugging.
- **D-12 (Manual UAT, no test infra):** Continue Phase 02.x's manual-UAT-only pattern (D-14 in 02.3). Add a `03-UAT.md` with ≥5 scenarios: open, edit+save (publish), publish failure (network), execute happy path, execute output streaming.
- **D-13 (No automated tests):** No unit tests, no integration tests. Aligns with `.planning/codebase/TESTING.md` (no test infra exists yet).
- **D-14 (Invariants preserved):** All Phase 02.2 auth-surface invariants AND Phase 02.3 D-17/D-18/D-19 invariants MUST hold. Specifically: no direct `globalThis.fetch` for any long-poll/streaming path; env-switch must not cause workspace-API leakage.

## Deferred ideas / Not in scope

- **Diff / conflict resolution UI** between local and remote (already deferred to `SCRIPT-V2-03`).
- **Create new remote script** (SCRIPT-V2-01).
- **Delete remote script** (SCRIPT-V2-02).
- **"Set Parameters" command + per-script params editor** — workspace-state key `altium365.scriptParams.<scriptId>` is reserved (D-05) but no UI ships this phase.
- **Multi-workspace simultaneous editing** of scripts from different workspaces in the same window — works incidentally if URI scheme keys on workspaceId, but no explicit testing this phase.
- **Pretty-printing / linting / language services for remote scripts** beyond what Python extension provides automatically for `.py` files opened from any URI.
- **Marketplace README screenshots** for the new flows — handled in a future packaging phase.
- **Server-side execution cancellation** if research shows the API doesn't expose it — document the limitation; revisit in v2.

## Research items remaining for planner / executor

The following MUST be confirmed by `gsd-phase-researcher` against the live dev1 GraphQL schema (introspection + smoke probes) BEFORE planning the execute-related plans. Open + publish plans CAN start in parallel with research since the FileSystemProvider shape is well-known:

1. **`gloScrScript(scriptId: ID)` (or whatever the read endpoint is called)** — exact query name, arguments, response shape. Field for raw source. Pagination if applicable.
2. **`gloScrUpdateScript` mutation** — input shape (does it take just `scriptId + content`, or also `name`/`description`?), return shape, error codes returned via GraphQL `errors`.
3. **`gloScrExecuteScript` mutation** — input shape (params? projectId? scriptId only?), return shape (sync output blob, job id, subscription handle?). Does it stream? Polling endpoint?
4. **Execution status / output query or subscription** — if async, what's the query for status + output deltas? Subscription protocol if any.
5. **Server-side cancellation** — does the API expose a `gloScrCancelScript` or similar?
6. **Known error codes from these mutations** — for D-11 friendly mapping.

## Open questions resolved during discuss

| Question | Decision | Where |
|---|---|---|
| Edit buffer storage approach | FileSystemProvider on `altium365:` scheme | D-01 |
| Save semantics | Save = publish (writeFile) | D-03 |
| Publish conflict handling | Blind overwrite, document in README | D-02 |
| Execute model (sync/async/streaming) | Defer to research | D-04 |
| Params source for remote execute | `.params.json` convention + future per-script state | D-05 |
| UI surfaces | Tree context menu + editor title bar; no palette | D-06 |
| Endpoint routing | Per-workspace `apiServiceUrl` (D-19 from 02.3) | D-07 |
| Token handling | Existing `ensureWorkspaceToken` only | D-08 |

## Planner notes

- Wave structure suggestion (planner has final say):
  - **Wave 1 (parallel):** Research (GraphQL surface probe) ‖ FileSystemProvider skeleton + URI scheme registration ‖ Tree context menu + editor title bar wiring (commands stub).
  - **Wave 2 (depends on Wave 1):** Open script (read GraphQL → FileSystemProvider.readFile) ‖ Publish script (writeFile → gloScrUpdateScript).
  - **Wave 3 (depends on research):** Execute Remotely + output streaming (model from research output).
  - **Wave 4:** Manual UAT script, README update for blind-overwrite caveat, error-mapping pass.
- The researcher MUST attempt introspection against `https://usw2.dev-365.altium.com/napi/gateway/graphql` (env-global is fine for schema discovery). Operator credentials are the dev1 sign-in already verified in 02.3 UAT.
