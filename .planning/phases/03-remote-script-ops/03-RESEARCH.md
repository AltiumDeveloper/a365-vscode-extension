# Phase 3: Remote Script Operations - Research

**Researched:** 2026-05-20
**Domain:** Altium 365 GraphQL `gloScr*` surface; VS Code FileSystemProvider for remote edit buffers; async execution polling
**Confidence:** HIGH (all claims verified by live introspection of `https://usw2.dev-365.altium.com/napi/gateway/graphql`; raw schema in `schema-introspection.json`)

## Summary

Live schema introspection against the dev1 endpoint resolves every TBD in `03-CONTEXT.md §"Research items remaining"`. All five script-related operations (`gloScrScript`, `gloScrScripts`, `gloScrUpdateScript`, `gloScrExecuteScript`, plus the two execution-result queries) are present and stable, with `Create`/`Delete` mutations also exposed (out of scope per `03-CONTEXT.md §Deferred`).

The most consequential finding: **script content is not embedded in the GraphQL response**. `GloScrScriptPackage` exposes only `fileToken: String!`, meaning the script body is fetched from — and uploaded to — Altium's *files service*, which is a separate HTTPS endpoint exposed per workspace via `DesWorkspaceLocation.filesServiceUrl` (not currently fetched by `listWorkspaces` in `src/workspace.ts`). Read and Publish flows therefore become two-step (GraphQL ↔ Files Service) rather than a single mutation. This affects D-01 / D-03 wiring but not their intent.

Execution is async-by-design (`Mutation.gloScrExecuteScript` description: *"Executes a script asynchronously."*) and returns a `scriptExecutionId`. No subscription exists for script status or logs; logs are exposed via a **paginated, token-based** field `GloScrScriptExecution.logs(limit, nextToken)` that returns `GloScrScriptExecutionLogPage { logs: [String!]!, nextToken: String! }`. This is a classic "incremental long-poll" shape — the client polls, advances `nextToken`, and stops when `status` reaches a terminal value. **No server-side cancellation mutation exists** for scripts (only `desTerminateWorkflows`, unrelated).

**Primary recommendation:** Implement D-04 as **async + client-side polling** (D-04b). Poll execution status every 1.5 s, fetch log deltas with the previous `nextToken` on each tick. Detach polling on user cancel (D-10) since there is no server cancel.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Edit-buffer model (open/save round-trip) | VS Code extension host (FileSystemProvider) | A365 Files Service | Buffer lives in editor; persistence is two-hop (GraphQL metadata + Files Service blob) |
| Script source GET | Extension host (`graphqlRequest` + raw HTTPS) | A365 GraphQL + Files Service | Schema returns `fileToken` only — body comes from Files Service |
| Script source PUT (publish) | Extension host | A365 Files Service (upload) → GraphQL (`gloScrUpdateScript`) | Upload first, mutate with returned token second |
| Trigger execution | Extension host | A365 GraphQL (`gloScrExecuteScript`) | One-shot async mutation |
| Status + log streaming | Extension host (poll loop) | A365 GraphQL (`gloScrScriptExecutionResult` + `.logs`) | No subscription; polled |
| Cancellation | Extension host (abandon poll) | — (no server endpoint) | Server execution continues; client detaches |
| Param assembly | Extension host (`.params.json` / workspace state) | — | Pure client-side aggregation before mutation |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCRIPT-02 | Open a remote script as a VS Code editor document | `Query.gloScrScript(scriptId)` → latest `versions { nodes { package { fileToken } } }` → GET `<filesServiceUrl>/<fileToken>` |
| SCRIPT-03 | Publish edited content via `gloScrUpdateScript` | Upload to Files Service → receive new fileToken → `Mutation.gloScrUpdateScript(input: { scriptId, package: { fileToken }, comment? })` |
| SCRIPT-04 | Trigger remote execution via `gloScrExecuteScript` | `Mutation.gloScrExecuteScript(input: { scriptId, scriptVersionId?, parameters?: [{key,value}] })` returns `scriptExecutionId` |
| SCRIPT-05 | Stream execution output to OutputChannel | `Query.gloScrScriptExecutionResult(scriptExecutionId)` polled every 1.5 s + `.logs(limit, nextToken)` for incremental log fetch |

## User Constraints (from 03-CONTEXT.md)

### Locked Decisions
D-01..D-14 all apply unchanged. Specifically honored below:

- **D-01** (FileSystemProvider on `altium365:` scheme) — feasible exactly as specified; URI shape `altium365://<workspaceId>/<scriptId>/<scriptName>.py` is sufficient because both keys are recoverable from the URI.
- **D-02** (blind overwrite, last-write-wins) — schema supports it: `gloScrUpdateScript` requires no version/etag/precondition. The `comment` field is optional metadata only, not a CAS token.
- **D-03** (save = publish via `writeFile`) — workable; `writeFile` becomes a 2-step upload → mutate. Failures bubble as `FileSystemError`.
- **D-04** (execution model) — **resolved to D-04b (async + poll)** by this research. Justification in §"Execute script" below.
- **D-05** (params via `.params.json` + reserved workspace-state key) — `GloScrScriptParameterInput` is `{ key: String!, value: String! }`, so any `.params.json` whose values are JSON-serialisable can be flattened `{k: JSON.stringify(v) || String(v)}`. **Note:** the server accepts strings only — non-string values (numbers, booleans, nested objects) must be stringified by the client. Document this in UAT.
- **D-07** (per-workspace `apiServiceUrl`) — fully respected; `listWorkspaces` already fetches it. **Extension required:** also fetch `location { filesServiceUrl }` (new field for this phase) — see §"Schema surprises".
- **D-08** (auth via `ensureWorkspaceToken`) — applies to GraphQL calls AND Files Service GET/PUT (same workspace bearer token).
- **D-10** (cancellation) — **no server cancel exists**. Client cancel = abandon polling + write `[Altium 365] Remote execution cancelled (server-side execution continues)` to OutputChannel.
- **D-11** (error mapping) — keyable on `errors[].extensions.code`. Confirmed codes from probes: `AUTH_NOT_AUTHENTICATED` (401 read), `UNAUTHORIZED` (401 write). Other codes will surface during UAT; map them as observed.

### the agent's Discretion
- Choice of polling interval (recommended: 1.5 s status + same-tick log fetch).
- File names & module split (recommended: `src/remoteScriptFs.ts` + `src/remoteExecution.ts`).
- Exact wording of OutputChannel header/footer (header/footer template already in D-09).

### Deferred Ideas (OUT OF SCOPE)
Diff/conflict UI, Create/Delete script mutations, "Set Parameters" command UI, multi-workspace simultaneous editing testing, server-side cancel (no API exists — revisit if Altium ships one).

## Project Constraints (from AGENTS.md)

- Commands prefixed `altium365.` (D-06 already conforms).
- Async/await throughout; errors surface via `vscode.window.showErrorMessage` at command boundary (already the pattern in `src/treeCommands.ts`).
- Reuse `graphqlRequest(endpoint, token, query, variables)` from `src/workspace.ts` for every GraphQL call. **However**, the existing helper discards `errors[].extensions.code` (line 72 stringifies the whole `errors` array). For D-11 the wrapper must be widened to throw a typed error carrying `code` — see §"Common Pitfalls".
- No bundler — TypeScript only, output to `out/`.
- No module-level state except `outputChannel` (already reused per D-09).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vscode` API | ≥1.85.0 (already pinned) | `FileSystemProvider`, `OutputChannel`, `withProgress` | Required for D-01 edit-buffer model and D-10 progress UI |
| `globalThis.fetch` (Node ≥18 built-in) | n/a | All HTTPS calls (GraphQL + Files Service) | Already used by `graphqlRequest`; honours D-14 invariant against alternate HTTP stacks |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vscode.CancellationToken` | n/a | Bridge `withProgress` cancel into polling loop | D-10 cancellation |
| `AbortController` (Node built-in) | n/a | Abort in-flight `fetch` when user cancels | Only for the log-page fetch and execution-result poll — never for `gloScrExecuteScript` itself (D-08 mutex respected) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polling loop | GraphQL subscription | **Rejected** — schema introspection confirms `Subscription` root type contains NO `gloScr*` fields. Not available. |
| Polling loop | Server-Sent Events / WebSocket | **Rejected** — no SSE or WS endpoint exposed in the schema, and adding a non-`fetch` HTTP path violates D-14. |
| Custom version/etag check before publish | — | **Rejected** by D-02. |

**Installation:** No new npm packages required. All capabilities are already in `package.json` / Node built-ins.

## Package Legitimacy Audit

Not applicable — this phase installs no new external packages. All code uses VS Code API, Node built-ins, and already-vendored project modules.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌──────────────────────────────────────┐
                    │  VS Code Tree (sidePanel.ts)         │
                    │  script node: {workspaceId, scriptId}│
                    └───────────────┬──────────────────────┘
                                    │ context-menu / title-bar
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
   ┌─────────────────┐    ┌──────────────────┐  ┌─────────────────────┐
   │ Open (URI build)│    │ Publish          │  │ Execute Remotely    │
   │  altium365://   │    │ document.save()  │  │ withProgress(cancel)│
   │  <ws>/<id>/n.py │    │                  │  │                     │
   └────────┬────────┘    └────────┬─────────┘  └──────────┬──────────┘
            │                      │                       │
            ▼                      ▼                       ▼
   ┌──────────────────────────────────────────┐  ┌─────────────────────┐
   │  remoteScriptFs.ts                       │  │ remoteExecution.ts  │
   │  (FileSystemProvider, scheme=altium365)  │  │                     │
   │  ┌─────────────────────────────────────┐ │  │ ┌─────────────────┐ │
   │  │ readFile:                           │ │  │ │ 1. assembleParams│ │
   │  │  1. ensureWorkspaceToken            │ │  │ │    (D-05)        │ │
   │  │  2. gloScrScript → latest version   │ │  │ │ 2. mutate        │ │
   │  │     .package.fileToken              │ │  │ │ 3. poll loop:    │ │
   │  │  3. GET filesServiceUrl/<token>     │ │  │ │    every 1500ms  │ │
   │  └─────────────────────────────────────┘ │  │ │    - status      │ │
   │  ┌─────────────────────────────────────┐ │  │ │    - logs(nextTok)│ │
   │  │ writeFile (= publish, D-03):        │ │  │ │    - append to   │ │
   │  │  1. ensureWorkspaceToken            │ │  │ │      outputChannel│ │
   │  │  2. PUT filesServiceUrl → fileToken │ │  │ │    - stop on     │ │
   │  │  3. gloScrUpdateScript              │ │  │ │      terminal    │ │
   │  └─────────────────────────────────────┘ │  │ └─────────────────┘ │
   └──────────────────┬───────────────────────┘  └──────────┬──────────┘
                      │                                     │
                      ▼                                     ▼
            ┌─────────────────┐                  ┌────────────────────┐
            │ workspace.ts    │                  │ outputChannel      │
            │ graphqlRequest  │                  │ (singleton, D-09)  │
            │ ensureWorkspace │                  └────────────────────┘
            │ Token (mutex)   │
            └────────┬────────┘
                     │
        ┌────────────┴────────────────────┐
        │                                  │
        ▼                                  ▼
  apiServiceUrl                     filesServiceUrl
  (GraphQL gateway)                 (REST blob store)
  per-workspace, D-07              per-workspace, NEW for this phase
```

**Component responsibilities:**

| Component | File | Responsibility |
|-----------|------|----------------|
| FileSystemProvider | `src/remoteScriptFs.ts` (NEW) | `altium365:` scheme registration, `readFile` (GraphQL→token→Files Service GET), `writeFile` (Files Service PUT→GraphQL update), `stat` (return `File`, mtime=now), `watch` (no-op), event emitter for `onDidChangeFile` (no-op v1) |
| Execution orchestrator | `src/remoteExecution.ts` (NEW) | `executeRemoteScript({workspaceId, authId, scriptId, scriptName})`: assemble params, call `gloScrExecuteScript`, drive the poll loop, write to `outputChannel`, honour `CancellationToken` |
| GraphQL helpers | `src/workspace.ts` (EXTEND) | Add `getScript(endpoint, token, scriptId)`, `getScriptLatestVersion(...)`, `updateScript(endpoint, token, scriptId, fileToken, comment?)`, `executeScript(endpoint, token, input)`, `getExecutionResult(endpoint, token, executionId)`, `getExecutionLogs(endpoint, token, executionId, limit, nextToken)`. Also extend `listWorkspaces` query string to fetch `location { apiServiceUrl filesServiceUrl }`. |
| Files Service client | `src/workspace.ts` or new tiny `src/filesService.ts` (planner's call) | `downloadByToken(filesServiceUrl, token, bearerToken)` + `uploadAndGetToken(filesServiceUrl, bearerToken, bytes)`. **Exact REST path/verb TBD by smoke test in Wave 1** — schema does not expose it (see §"Open Questions"). |
| Error mapping | inline in helpers above | Throw a typed error `{code, message, raw}` keyed on `errors[].extensions.code`, mirroring `doSignIn` pattern at `src/extension.ts:~111` |

### Recommended Project Structure
```
src/
├── extension.ts             # EXTEND: register FileSystemProvider + 3 new commands
├── workspace.ts             # EXTEND: add 6 GraphQL helpers + filesServiceUrl in listWorkspaces query
├── remoteScriptFs.ts        # NEW: FileSystemProvider for altium365:
├── remoteExecution.ts       # NEW: execute + poll + stream-to-OutputChannel
├── treeCommands.ts          # EXTEND: registerScript open/publish/execute commands
└── sidePanel.ts             # EXTEND: surface context-menu entries on script nodes (when clauses)
```

### Pattern 1: Two-step publish (upload then mutate)
**What:** Files Service is the storage tier; GraphQL is the metadata tier. Publish must hit them in order: PUT bytes → receive token → mutation pins token to script.
**When to use:** `writeFile` in `remoteScriptFs.ts`, plus any future create-script flow (out of scope this phase).
**Example:**
```typescript
// Source: derived from schema introspection (schema-introspection.json) + DesWorkspaceLocation.filesServiceUrl
async function publishScript(
    apiServiceUrl: string,
    filesServiceUrl: string,
    token: string,
    scriptId: string,
    contentBytes: Uint8Array,
    comment?: string
): Promise<void> {
    const fileToken = await uploadAndGetToken(filesServiceUrl, token, contentBytes); // REST PUT (path TBD Wave 1)
    await graphqlRequest(apiServiceUrl, token, UPDATE_SCRIPT_MUTATION, {
        input: { scriptId, package: { fileToken }, comment }
    });
}

const UPDATE_SCRIPT_MUTATION = `
mutation UpdateScript($input: GloScrUpdateScriptInput!) {
  gloScrUpdateScript(input: $input) {
    gloScrScriptVersion { scriptVersionId timestamp }
  }
}`;
```

### Pattern 2: Async execute + incremental log poll
**What:** Mutation kicks off execution and returns immediately with `scriptExecutionId`. Client then polls `gloScrScriptExecutionResult(scriptExecutionId)` for `status` + drives `logs(limit, nextToken)` to fetch only new log lines each tick.
**When to use:** `executeRemoteScript` in `remoteExecution.ts`.
**Example:**
```typescript
// Source: derived from schema introspection — see GloScrScriptExecution + GloScrScriptExecutionLogPage
const EXECUTE_SCRIPT_MUTATION = `
mutation ExecuteScript($input: GloScrExecuteScriptInput!) {
  gloScrExecuteScript(input: $input) {
    gloScrScriptExecution { scriptExecutionId status }
  }
}`;

const POLL_EXECUTION_QUERY = `
query PollExecution($id: String!, $limit: Int!, $nextToken: String) {
  gloScrScriptExecutionResult(scriptExecutionId: $id) {
    scriptExecutionId
    status
    failureReason
    executionResult { exitCode returnValues { /* fields TBD by smoke probe */ } }
    logs(limit: $limit, nextToken: $nextToken) { logs nextToken }
  }
}`;

async function runAndStream(
    apiServiceUrl: string, token: string,
    scriptId: string, parameters: Array<{key:string, value:string}>,
    out: vscode.OutputChannel, cancelToken: vscode.CancellationToken
): Promise<number> {
    const start = await graphqlRequest(apiServiceUrl, token, EXECUTE_SCRIPT_MUTATION, {
        input: { scriptId, parameters }
    });
    const execId: string = start.gloScrExecuteScript.gloScrScriptExecution.scriptExecutionId;
    let nextToken: string | undefined = undefined;
    const TERMINAL = new Set(['Succeeded','Failed','Cancelled','Stopped','Completed','Error']); // see §Open Questions
    while (!cancelToken.isCancellationRequested) {
        const r = await graphqlRequest(apiServiceUrl, token, POLL_EXECUTION_QUERY,
            { id: execId, limit: 500, nextToken });
        const exec = r.gloScrScriptExecutionResult;
        for (const line of exec.logs.logs) out.appendLine(line);
        nextToken = exec.logs.nextToken || nextToken;
        if (TERMINAL.has(exec.status)) {
            return exec.executionResult.exitCode;
        }
        await sleep(1500);
    }
    out.appendLine('[Altium 365] Remote execution cancelled (server-side execution continues)');
    return -1;
}
```

### Anti-Patterns to Avoid
- **Embedding script body in URI or `query.workspaceState`:** the body can be megabytes; round-trip through Files Service every read.
- **Re-fetching `apiServiceUrl`/`filesServiceUrl` per call:** cache the `WorkspaceInfo` from sidePanel on extension activation; only re-list when an env or workspace switch occurs.
- **Caching the bearer token inside `remoteScriptFs.ts` or `remoteExecution.ts`:** D-08 explicitly forbids it — always go through `ensureWorkspaceToken`.
- **Hard-coding the status enum:** `status` is `String!` not an enum in the gloScr path (see §"Open Questions"). Accept any string; match a curated terminal set case-insensitively.
- **Calling `gloScrCreateScript`/`gloScrDeleteScript`:** out of scope (Deferred to SCRIPT-V2-01/02).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Edit buffer / dirty tracking / save command | Custom WebviewPanel or memfs scheme | `vscode.FileSystemProvider` | Ships with `Ctrl+S`, hot-exit, dirty indicator, multi-cursor, language services — D-03 hinges on this |
| Cancellable long-running UI | Custom status bar spinner | `vscode.window.withProgress({location: Notification, cancellable: true})` | Standard pattern, already keyed by D-10 |
| GraphQL request + bearer | Re-invent | `graphqlRequest()` in `src/workspace.ts` | D-14 invariant — same fetch path as Phase 02.x |
| Workspace token retrieval | New cache | `ensureWorkspaceToken()` (mutex, secret storage) | D-08 |
| Endpoint selection | `if (ws) … else …` | `getWorkspaceApiUrl()` | D-07 / D-19 from Phase 02.3 |
| OutputChannel | Per-script channel | Existing `outputChannel` singleton | D-09 |

**Key insight:** Every architectural primitive Phase 3 needs is already in the codebase or in the VS Code stdlib. The phase is mostly *plumbing* between known components — the only real new abstraction is the Files Service client.

## Runtime State Inventory

Not applicable — Phase 3 is a feature addition, not a rename / refactor / migration. No prior strings, IDs, or registrations need updating.

## Common Pitfalls

### Pitfall 1: `extensions.code` swallowed by existing `graphqlRequest`
**What goes wrong:** Current `graphqlRequest` (`src/workspace.ts:71-73`) does `throw new Error(\`GraphQL errors: ${JSON.stringify(payload.errors)}\`)`. D-11 needs `code` extractable to do friendly-message mapping.
**Why it happens:** Phase 02.x didn't yet need code-based mapping; the helper was minimal.
**How to avoid:** Widen `graphqlRequest` (or layer a thin `graphqlRequestWithCodes` wrapper) to return / throw a typed `GraphQLError` carrying `code`, `message`, `path`, and original payload. Same pattern as `doSignIn` OAuth error mapping in `src/extension.ts:~111`.
**Warning signs:** Tests pass but UI shows "GraphQL errors: [{…}]" instead of "Not authorized — sign in again".

### Pitfall 2: `parameters` are key/value **strings only**
**What goes wrong:** `.params.json` typically contains numbers/booleans/objects. `GloScrScriptParameterInput` is `{ key: String!, value: String! }`. Passing a number triggers a schema validation error before the script ever runs.
**Why it happens:** Local `_runner.py` does its own JSON-parsing of `.params.json` values; the remote API does not.
**How to avoid:** Client-side flatten before mutation. For each entry, `value: typeof v === 'string' ? v : JSON.stringify(v)`. Document in UAT that the *script author* is responsible for JSON-decoding inside the script if needed.
**Warning signs:** GraphQL `errors[].extensions.code` = `BAD_USER_INPUT` or similar; mutation never reaches execution stage.

### Pitfall 3: `filesServiceUrl` not yet fetched
**What goes wrong:** First call to `readFile` blows up with `undefined`/`null` because `listWorkspaces` (Phase 01) only fetched `location { apiServiceUrl }`.
**Why it happens:** Files service URL is new to this phase.
**How to avoid:** Wave 1 must extend `LIST_WORKSPACES_QUERY` to include `filesServiceUrl`. Existing cached `WorkspaceInfo` objects in `globalState` may need invalidation on first run after upgrade — handle by treating missing `filesServiceUrl` as a re-list trigger.
**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'filesServiceUrl')` on first script open.

### Pitfall 4: Files Service path/verb not in schema
**What goes wrong:** Schema gives us `filesServiceUrl` (the host) but not the path to GET/PUT by token.
**Why it happens:** Files service is a sibling REST API, not part of the GraphQL surface.
**How to avoid:** Wave 1 smoke probe by the executor: open browser dev-tools while opening a script via the Altium 365 web UI, capture the exact path + verb + content-type, then encode in `src/remoteScriptFs.ts` (or a `src/filesService.ts`). Most likely pattern based on Altium conventions: `GET <filesServiceUrl>/<fileToken>` for download; `POST <filesServiceUrl>` (multipart or octet-stream) returning a JSON envelope with the new fileToken for upload. **Treat this as a research hand-off to the executor agent** — the planner should add an explicit smoke-probe task in Wave 1.
**Warning signs:** 404 on `<filesServiceUrl>/<token>`; check actual Altium portal traffic.

### Pitfall 5: Polling never terminates because `status` is `String!`
**What goes wrong:** `GloScrScriptExecution.status` is typed `String!` (not an enum), so terminal values must be discovered empirically.
**Why it happens:** The schema author left status as free-form; only the parallel `GloCusScriptExecution` type uses a proper enum (`PENDING|RUNNING|STOPPED|…`). The two are distinct paths.
**How to avoid:** Start with a generous terminal-set (`Succeeded`, `Failed`, `Cancelled`, `Stopped`, `Completed`, `Error`) plus a hard timeout (e.g. 10 min) as a backstop. Log every observed `status` value to OutputChannel during Wave 1 UAT so the set can be tightened.
**Warning signs:** UAT shows execution never reports "finished" even though logs stop; check observed `status` strings.

### Pitfall 6: Cancellation silently leaks server-side work
**What goes wrong:** User hits Cancel; extension stops polling but the server keeps executing. User believes it's stopped.
**Why it happens:** No `gloScrCancelScript` exists (verified by mutation introspection).
**How to avoid:** Explicit footer to OutputChannel — `[Altium 365] Remote execution cancelled (server-side execution continues)` — AND a one-line note in README and `03-UAT.md`.
**Warning signs:** UAT step "Cancel mid-execution then look at server logs" — execution continues to completion.

## Code Examples

### Read latest script source (Open / readFile)
```graphql
# Source: schema-introspection.json — GloScrScript + GloScrScriptVersion + GloScrScriptPackage
query GetScriptSource($scriptId: String!) {
  gloScrScript(scriptId: $scriptId) {
    scriptId
    name
    description
    versions(first: 1, order: [{ timestamp: DESC }]) {
      nodes {
        scriptVersionId
        timestamp
        comment
        package { fileToken }
      }
    }
  }
}
```
Variables: `{ "scriptId": "<uuid>" }`. Then GET `<filesServiceUrl>/<fileToken>` with `Authorization: Bearer <workspaceToken>`.

### Publish updated script
```graphql
# Source: schema-introspection.json — GloScrUpdateScriptInput / Payload
mutation UpdateScript($input: GloScrUpdateScriptInput!) {
  gloScrUpdateScript(input: $input) {
    gloScrScriptVersion {
      scriptVersionId
      timestamp
      comment
    }
  }
}
```
Variables: `{ "input": { "scriptId": "<uuid>", "package": { "fileToken": "<token-from-upload>" }, "comment": "Updated via VS Code extension" } }`

### Execute script
```graphql
# Source: schema-introspection.json — GloScrExecuteScriptInput / Payload
mutation ExecuteScript($input: GloScrExecuteScriptInput!) {
  gloScrExecuteScript(input: $input) {
    gloScrScriptExecution {
      scriptExecutionId
      status
      createdAt
    }
  }
}
```
Variables (no params): `{ "input": { "scriptId": "<uuid>" } }`
Variables (with params + pinned version): `{ "input": { "scriptId": "<uuid>", "scriptVersionId": "<version-uuid>", "parameters": [{"key":"projectId","value":"42"},{"key":"target","value":"prod"}] } }`

### Poll status + log delta
```graphql
# Source: schema-introspection.json — GloScrScriptExecution + GloScrScriptExecutionLogPage
query PollExecution($id: String!, $limit: Int!, $nextToken: String) {
  gloScrScriptExecutionResult(scriptExecutionId: $id) {
    scriptExecutionId
    status
    failureReason
    updatedAt
    executionResult {
      exitCode
      returnValues { __typename }
    }
    logs(limit: $limit, nextToken: $nextToken) {
      logs
      nextToken
    }
  }
}
```
Variables (first tick): `{ "id": "<exec-id>", "limit": 500, "nextToken": null }`
Variables (subsequent ticks): `{ "id": "<exec-id>", "limit": 500, "nextToken": "<prev-nextToken>" }`

**Note:** `GloScrScriptOutput` (the element type of `returnValues`) was not dumped explicitly here because field-level usage is out of scope for v1 (we only need `exitCode` for the footer). Planner can introspect the type later if needed.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| n/a (greenfield phase) | n/a | n/a | n/a |

**Deprecated/outdated:**
- None — first time the gloScr* read/update/execute surface is touched by this extension.

## Validation Architecture

> Per `.planning/config.json` (D-13) the project explicitly disables automated test infra. Phase 3 inherits manual-UAT-only (D-12). Test framework section therefore omitted. Validation steps captured in `03-UAT.md` (to be authored in Wave 4).

## Security Domain

Per `.planning/config.json`, `security_enforcement` is the project default (not explicitly disabled). Relevant ASVS items for this phase:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (token reuse, no plaintext) | `ensureWorkspaceToken` + `context.secrets` (already in place per Phase 02.x) — **do not regress** |
| V3 Session Management | yes (workspace token TTL) | Existing mutex + refresh path; nothing new |
| V4 Access Control | partial | Server-side ACL via Altium; client only enforces "have token before calling" |
| V5 Input Validation | yes | `scriptId` from URI must be UUID-shaped before being placed into a GraphQL variable; stringify `parameters` values (see Pitfall 2) |
| V6 Cryptography | no | No new crypto — TLS for transport handled by Node `fetch` |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token exfiltration via OutputChannel | Information Disclosure | Never log bearer tokens or `Authorization` headers — only the GraphQL `errors[]` payload sans headers. Mirror `doSignIn` pattern. |
| Path traversal via `altium365://` URI | Tampering | Parse URI strictly: `host = workspaceId` (UUID), first path segment = `scriptId` (UUID), remainder is display-only. Reject anything else with `FileSystemError.FileNotFound`. |
| Cross-workspace token leakage | Spoofing | D-07 + D-08 — every call re-resolves `apiServiceUrl` / `filesServiceUrl` from the URI's `workspaceId`, never from a cached "current workspace". |
| Server-side script abuse (untrusted code execution) | n/a | Out of scope — server enforces. Client just submits user-initiated executions. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Files Service GET path is `<filesServiceUrl>/<fileToken>` (verb GET, bearer auth) | Pattern 1 / Pitfall 4 | Open script fails with 404 on first try — Wave 1 smoke probe will catch and correct |
| A2 | Files Service upload returns a JSON envelope containing the new `fileToken` | Pattern 1 / Pitfall 4 | Publish fails — same smoke probe catches and corrects |
| A3 | Terminal `status` values include the curated set in Pitfall 5 | Pitfall 5 / poll example | Polling never stops without the timeout backstop; Wave 1 UAT will reveal actual values |
| A4 | Server expects `parameters[].value` to be a JSON string for non-string values (executable script then `json.loads` inside) | D-05 / Pitfall 2 | If server expects raw strings only, no breakage — scripts just need to parse. Worst case is double-encoded JSON; document in UAT |
| A5 | `getScript → versions(first:1, order:[{timestamp: DESC}])` always yields the script's current published version | Code example "Read latest" | If A365 has a separate "current" marker, we'd read a stale version. Mitigation: smoke-probe step in Wave 2. |
| A6 | `failureReason` is populated when `status` indicates failure (and only then) | Poll example | If always populated even on success, footer formatting is unaffected (we already key on `status`). Low-risk assumption. |

**Confirmation path:** A1, A2 → executor smoke probe in Wave 1 (open browser dev-tools against `365.altium.com` script editor). A3 → log every observed `status` during Wave 1 UAT. A4, A5, A6 → Wave 2 UAT.

## Open Questions

1. **Files Service path/verb for download and upload**
   - What we know: `filesServiceUrl: String!` exposed on `DesWorkspaceLocation`; same bearer token works (D-08); `fileToken: String!` is the opaque handle.
   - What's unclear: Exact REST path, verb, content-type for download; same for upload (multipart vs raw octet-stream); shape of upload response envelope.
   - Recommendation: Add a *Wave 1 smoke-probe task* to capture this from live portal traffic. Encode result in `src/remoteScriptFs.ts` or `src/filesService.ts`.

2. **Terminal status values for `GloScrScriptExecution.status`**
   - What we know: type is `String!`, not an enum; parallel `GloCusScriptExecutionStatus` enum uses `PENDING|PROVISIONING|ACTIVATING|RUNNING|DEACTIVATING|DEPROVISIONING|STOPPING|STOPPED|UNKNOWN` (likely *different* state machine).
   - What's unclear: Whether `gloScr` reuses any of those names, uses `Succeeded`/`Failed`/`Completed`, or something else.
   - Recommendation: Start with a wide terminal set + 10-min timeout backstop. Tighten in Wave 4 after UAT.

3. **`GloScrScriptOutput` field shape**
   - What we know: `executionResult.returnValues: [GloScrScriptOutput!]` exists.
   - What's unclear: Field-level structure (`{ key, value }`? `{ name, jsonValue }`?) — not introspected.
   - Recommendation: For v1, only display `exitCode` in the OutputChannel footer; introspect `returnValues` later if SCRIPT-V2 needs it.

4. **Param fallback "promptForProjectId" still applies?**
   - What we know: D-05 says reuse the fallback from local `runScript`.
   - What's unclear: Whether the remote script's `parameters` shape will always include `projectId` as a key — depends on individual script.
   - Recommendation: Mirror local behavior exactly — if `.params.json` is absent AND `altium365.promptForProjectId === true`, prompt and inject `{key:"projectId", value:"<input>"}` as a single-entry parameters array.

## Sources

### Primary (HIGH confidence)
- **Live GraphQL introspection** of `https://usw2.dev-365.altium.com/napi/gateway/graphql` (anonymous; saved as `schema-introspection.json` in this phase directory). Verified existence and exact signatures of: `Query.gloScrScript`, `Query.gloScrScripts`, `Query.gloScrScriptExecutionResult`, `Query.gloScrScriptExecutionResults`, `Mutation.gloScrUpdateScript`, `Mutation.gloScrExecuteScript`, plus all referenced types (`GloScrScript`, `GloScrScriptVersion`, `GloScrScriptPackage`, `GloScrUpdateScriptInput`, `GloScrExecuteScriptInput`, `GloScrScriptExecution`, `GloScrScriptExecutionResult`, `GloScrScriptExecutionLogPage`, `GloScrScriptParameterInput`).
- **Live error envelope probes** against the same endpoint (saved as inline `extensions.code` examples in `03-CONTEXT.md §D-11` work above). Verified codes: `AUTH_NOT_AUTHENTICATED`, `UNAUTHORIZED`.
- `src/workspace.ts` (current `graphqlRequest`, `listWorkspaces`, `getWorkspaceApiUrl`).
- `.planning/phases/02.3-actionwait-auth/02.3-CONTEXT.md` D-17/D-18/D-19.

### Secondary (MEDIUM confidence)
- Negative result: search across the full schema for `cancel|stop|abort|terminate|kill` mutations returned only `desTerminateWorkflows` (unrelated). Confirms no server-side script cancel exists.
- Negative result: schema's `Subscription` root type contains no `gloScr*` fields. Confirms no streaming subscription path.

### Tertiary (LOW confidence)
- Files Service REST contract (path/verb/content-type) — inferred from `DesWorkspaceLocation.filesServiceUrl: String!` field plus general Altium conventions, not verified. Flagged as A1/A2 in Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive is already in the codebase or Node/VS Code stdlib.
- Architecture: HIGH — flow shape directly implied by schema (two-step publish, async + poll) with no degrees of freedom worth exploring.
- Pitfalls 1, 2, 3, 5, 6: HIGH — directly observable in schema + existing code.
- Pitfall 4 / Open Question 1 (Files Service contract): MEDIUM — the gap is well-scoped, executor can resolve via 5-minute smoke probe.
- Execution model D-04 decision: HIGH — schema leaves no ambiguity; async + poll is the only path the API supports.

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (30 days — gloScr surface has been stable on the dev1 endpoint; re-introspect if any UAT step finds a mismatch)
