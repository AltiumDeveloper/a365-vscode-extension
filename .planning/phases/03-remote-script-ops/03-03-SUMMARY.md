---
phase: 03-remote-script-ops
plan: 03
slug: open-publish
status: complete
completed: 2026-05-20
requirements: [SCRIPT-02, SCRIPT-03]
provides:
  - script-open-round-trip
  - script-publish-round-trip
key-files:
  modified:
    - src/workspace.ts
    - src/remoteScriptFs.ts
---

# Phase 3 Plan 03: Open + Publish Summary

Replaced the 03-02 stubs with real `readFile` + `writeFile` implementations and added `getScript` / `updateScript` GraphQL helpers. SCRIPT-02 (open) and SCRIPT-03 (publish via save) are functionally complete pending UAT in 03-05.

## What landed

### `src/workspace.ts` — two new exports (upper export band — disjoint from 03-04)

- `ScriptDetail` interface — `{ scriptId, name, description?, latestFileToken, latestVersionId }`.
- `getScript(endpoint, workspaceToken, scriptId)` — sends `GET_SCRIPT_QUERY` (`gloScrScript` with the latest version inlined via `versions(first: 1, order: [{ timestamp: DESC }])`), returns `ScriptDetail`. Throws plain `Error` on missing script / missing versions / missing fileToken — server-side GraphQL errors come through as the typed `GraphQLError` from `graphqlRequest` (D-11 surface).
- `updateScript(endpoint, workspaceToken, scriptId, fileToken, comment?)` — sends `UPDATE_SCRIPT_MUTATION` (`gloScrUpdateScript` with `GloScrUpdateScriptInput { scriptId, package: { fileToken }, comment }`), returns `{ scriptVersionId, timestamp }`. The `comment` argument is omitted from the input when undefined so the server picks its default — currently the `writeFile` caller pins it to `'Updated via VS Code extension'`.
- Both queries cite `.planning/phases/03-remote-script-ops/schema-introspection.json` via the section banner.

### `src/remoteScriptFs.ts` — real readFile + writeFile

- `readFile(uri)` flow:
  1. `parseScriptUri(uri)` — already throws `FileNotFound` on malformed URI (V5 / T-03-02-01).
  2. `resolveWorkspace` — prefers `getSelectedWorkspace(ctx)` if its `workspaceId` matches the URI authority; else `listWorkspaces(envGlobal, baseToken)` and `.find(w => w.workspaceId === workspaceId)`. Missing → `FileNotFound`. Missing base token → `NoPermissions`.
  3. `ensureWorkspaceToken(ctx, cfg, ws)` — D-08, mutex per workspaceId, no local cache.
  4. `getWorkspaceApiUrl(ws, envGlobal)` (D-19) → `getScript(apiUrl, wsToken, scriptId)`.
  5. `getWorkspaceFilesUrl(ws)` (D-19 carry-over) → `downloadByToken(filesUrl, detail.latestFileToken, wsToken)`.
  6. Returns the raw bytes; one diagnostic line in OutputChannel with byte count + 8-char fileToken prefix (token-hygiene gate).

- `writeFile(uri, content, options)` flow:
  1. Same parse + resolve + token + URL resolution as readFile.
  2. `uploadAndGetToken(filesUrl, wsToken, content)` — bytes-first per RESEARCH Pattern 1.
  3. `updateScript(apiUrl, wsToken, scriptId, fileToken, 'Updated via VS Code extension')`.
  4. `_onDidChangeFile.fire([{ type: Changed, uri }])` for any sibling editors.
  5. One success log line.
  6. `options.create` / `options.overwrite` are intentionally ignored — A365 has no "create new" semantic in this URI form (SCRIPT-V2-01 deferred); documented inline.

- Error mapping (D-11 / threat T-03-03-02):
  - `GraphQLError` with `code === 'AUTH_NOT_AUTHENTICATED' | 'UNAUTHORIZED'` → `FileSystemError.NoPermissions(uri)` (VS Code's standard "Failed to save: Permission denied" + dirty state preserved per D-03).
  - `GraphQLError` with `code === 'BAD_USER_INPUT'` (RESEARCH Pitfall 2) → `FileSystemError.Unavailable('Publish failed: server rejected input (...)')`.
  - All other GraphQL errors / Files Service errors / network errors → `FileSystemError.Unavailable('Open Script failed: ...' | 'Publish failed: ...')`.
  - In every error branch, `logFsError` writes the `err.message`, `err.rawErrors` (truncated to 1000 chars), and stack to OutputChannel — never the bearer.

### Token hygiene

- Grep gate `! appendLine ... ${wsToken}` — clean.
- Bearer token is never echoed in any thrown message; full GraphQL error bodies go to OutputChannel via `rawErrors` (never the request headers).
- fileToken logged as 8-char prefix only.

## Decisions / Deviations

- None vs plan. Helper signatures match `<interfaces>` exactly; query strings match the RESEARCH templates.
- The plan suggested `'AUTH_NOT_AUTHENTICATED'` only; we accept `'UNAUTHORIZED'` as well (the schema uses both at different middleware layers — defensive). Either still maps to `NoPermissions`, so user-visible behavior is identical.
- `resolveWorkspace` is encapsulated as a private method rather than inline so 03-04 (`executeRemoteScript`) can reuse the same pattern via copy-paste (the two modules are intentionally not sharing utility code yet — Phase 4 may extract).

## Threat Mitigations Verified

| Threat | Status |
|--------|--------|
| T-03-03-01 cross-workspace token misroute | mitigated — every call re-resolves WorkspaceInfo from the URI authority and obtains its workspace-scoped token via `ensureWorkspaceToken` |
| T-03-03-02 token / fileToken in logs | mitigated — bearer never logged; fileToken truncated to 8 chars |
| T-03-03-03 blind overwrite race | accepted — D-02 documented limitation; README caveat lands in 03-05 |
| T-03-03-04 stale "latest version" pointer | UAT in 03-05 will verify against multi-version scripts; fix-forward as needed |

## Self-Check: PASSED

- `[x]` `src/workspace.ts` exports `getScript` (line 317) and `updateScript` (line 357).
- `[x]` `GloScrUpdateScriptInput` referenced (mutation input type).
- `[x]` Stub strings removed from `src/remoteScriptFs.ts` ("not yet implemented" → 0 hits).
- `[x]` Real impl markers present: `downloadByToken`, `uploadAndGetToken`, `getScript`, `updateScript`, `ensureWorkspaceToken`, `_onDidChangeFile.fire`, `FileSystemError.NoPermissions` — all reachable.
- `[x]` Token hygiene grep clean.
- `[x]` `npm run compile` clean.

## Next

Plan 03-04 (Wave 3 sibling): execute-stream — adds `executeScript` / `getExecutionResult` / `getExecutionLogs` to `src/workspace.ts` (lower export band, disjoint from this plan's additions) and replaces the `executeRemoteScript` stub in `src/remoteExecution.ts` with the real mutation + 1.5 s poll loop.
