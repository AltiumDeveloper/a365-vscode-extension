---
phase: 06-script-execution-ux-and-unified-params
plan: 03
subsystem: extension + script-commands + remote-execution + project-picker
tags: [routing, workspace-token, parameters, cross-workspace, projectid-prompt]
requires: [06-01]
provides:
  - cross-workspace-local-run-debug-routing
  - cross-workspace-output-header-name
  - unified-projectid-prompt-for-remote-execute
  - shared-last-pick-cache-local-vs-remote
  - reusable-pickprojectid-module
affects:
  - src/projectPicker.ts
  - src/extension.ts
  - src/scriptCommands.ts
  - src/remoteExecution.ts
tech-stack:
  added: []
  patterns:
    - "Cross-workspace token resolution mirror: getSelectedWorkspace ?? listWorkspaces(...).find → ensureWorkspaceToken → getWorkspaceApiUrl (ported from remoteExecution.ts:99-155 Block A into extension.ts prepareRun's `target` branch)."
    - "Optional `target?: { workspaceId, workspaceAuthId }` plumbed through prepareRun → runScriptAtPath → debugScriptAtPath; tree callers pass it, palette callers omit it (D-03 fallback preserved)."
    - "Workspace-scoped last-pick cache key `altium365.lastProjectId.<workspaceId>` shared between local (extension.ts) and remote (remoteExecution.ts) Block B fallback."
    - "Module extraction to break circular import risk: pickProjectId lives in src/projectPicker.ts and is imported by both extension.ts and remoteExecution.ts."
key-files:
  created:
    - src/projectPicker.ts
  modified:
    - src/extension.ts
    - src/scriptCommands.ts
    - src/remoteExecution.ts
key-decisions:
  - "D-01..D-03 implemented as planned — `target?` flows from scriptCommands tree handlers through prepareRun's new target branch which uses ensureWorkspaceToken + getWorkspaceApiUrl against the script's owning workspace; palette/standalone .py path unchanged."
  - "D-04 (debug-save-back) UAT-only — confirmed working (user approval). No code change."
  - "D-05/D-06/D-07 implemented — remoteExecution.ts Block B now falls back to pickProjectId(target=ws) when resolveScriptParameters returns undefined AND altium365.promptForProjectId is true; reads/writes `altium365.lastProjectId.<workspaceId>` using the script's workspaceId (NOT the active one), symmetric with local prepareRun."
  - "D-08 implemented — pickProjectId extracted to src/projectPicker.ts with new optional `target?: WorkspaceInfo` and `output?: vscode.OutputChannel` parameters; placeholder/loading copy uses (target ?? getSelectedWorkspace).name; outputChannel singleton dependency removed (caller passes channel or accepts silent catch-fallthrough to manual input)."
  - "D-22 honored — projectId-prompt fallback sits INSIDE the existing withScriptProgress wrapper in executeRemoteScript (real call-site count unchanged at 1)."
  - "D-23 honored — `altium365.scriptParams.<scriptId>` reserved key untouched; only resolveScriptParameters reads it, no writes from this plan."
  - "RESEARCH §5.4 fix — Block A now overwrites `args.workspaceName = ws.name` after workspace resolution, so cross-workspace remote execute headers no longer print `<workspace-name unknown>`. The new local-target header path emits `[Altium 365] Workspace: <name>` ahead of the Endpoint line (regression-safe: palette runs without target keep today's header)."
  - "Bonus consistency fix in prepareRun — when `target` is set, ALTIUM365_WORKSPACE_{ID,AUTH_ID,NAME} env vars now reflect the target workspace (NOT the active one), so user scripts that read these envs see the script's owning workspace."
requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-21, D-22, D-23, D-24]
duration: ~25 min
completed: 2026-05-22
---

# Phase 06 Plan 03: Cross-Workspace Routing + Unified ProjectId Prompt Summary

Closed the largest user-correctness gap of Phase 6: right-clicking a script in a workspace you haven't activated now runs/debugs against that workspace's token + apiServiceUrl (no implicit active-workspace switch — D-01/D-02/SC-1), the OutputChannel header names the correct workspace on both local and remote paths (RESEARCH §5.4), and remote Execute Remotely now prompts for projectId via the same QuickPick local already uses, with a shared `altium365.lastProjectId.<workspaceId>` cache so the two flows feel coherent (D-05..D-08/SC-3). Save-back-after-debug (D-04/SC-2) confirmed working via UAT — no code change required.

## What Shipped

**Task 1 — `src/projectPicker.ts` extraction (D-08).** Moved the inline `pickProjectId` out of `extension.ts` into its own module with two new optional params: `target?: WorkspaceInfo` (the workspace whose name labels the QuickPick + whose project list is loaded — defaults to the active workspace when omitted) and `output?: vscode.OutputChannel` (decouples the module from `extension.ts`'s singleton). Extraction breaks a would-be circular import (`remoteExecution → extension → remoteExecution`) and gives both callers a single source of truth.

**Task 2 — `prepareRun` / `runScriptAtPath` / `debugScriptAtPath` carry `target?`.** All three accept an optional `{ workspaceId, workspaceAuthId }`. When supplied, prepareRun replaces its endpoint/token resolution with the Block-A pattern from `remoteExecution.ts:99-155`: resolve `ws` via `getSelectedWorkspace ?? listWorkspaces(...).find`, mint a workspace-scoped token via `ensureWorkspaceToken`, and source the endpoint from `getWorkspaceApiUrl(ws, envGlobalEndpoint)`. When omitted, today's active-workspace path is preserved bit-for-bit (D-03). `scriptCommands.ts` tree handlers now build a target from `resolveScriptContext(node)` and pass it through; palette commands continue to call with two args.

**Task 3 — remoteExecution.ts Block A header fix + Block B prompt fallback.** Block A now overwrites `args.workspaceName = ws.name` after resolution (guarded by equality + truthy check), eliminating the `<workspace-name unknown>` header on cross-workspace execute. Block B's `const parameters` became `let parameters` with a new fallback: when `resolveScriptParameters` returns undefined AND `altium365.promptForProjectId` is true, call `pickProjectId(args.context, apiUrl, wsToken, last, ws, args.output)` keyed on `altium365.lastProjectId.<args.workspaceId>` — the same key prefix `extension.ts` uses for local, so picking a project in local pre-fills remote and vice versa (D-07). The reserved `altium365.scriptParams.<scriptId>` key remains untouched (D-23); no nested `withScriptProgress` wrap added (D-22).

## UAT Observations (user-reported, 2026-05-22)

**APPROVED with notes** — all 10 scenarios behave as specified (cross-workspace local run/debug routing, palette fallback, debug save-back, projectId prompt with config on/off, shared cache symmetry, cross-workspace remote, cancel path, reserved-key non-touch).

**Out-of-scope bug surfaced (NOT introduced by this plan — pre-existing in Block E poll loop):** Remote execute OutputChannel shows each log batch duplicated 3× (one duplicate per poll tick during the script's ~4s lifetime). Root cause is `src/remoteExecution.ts:343-345`:

```ts
if (logPage.nextToken) {
    nextToken = logPage.nextToken;
}
```

The local `nextToken` cursor only advances when the server returns a truthy token. When the server returns null/empty (likely its "no more logs since X" signal), the cursor stays put and the next tick re-fetches the same page. This was always broken but became user-visible only now that the projectId prompt makes Execute Remotely a routine action.

**Recommended fix (deferred to a new plan):** assign `nextToken = logPage.nextToken ?? nextToken` only if logs were actually emitted, OR track already-printed line count, OR (preferred) inspect `getExecutionLogs` pagination semantics in `src/workspace.ts` to confirm whether `nextToken` is a "since X" cursor (advance unconditionally on success) or an opaque continuation token (advance only when non-empty AND non-equal to the input). Backlog candidate — see 999.x notes.

## Files

| Path | Change |
|------|--------|
| `src/projectPicker.ts` (new, 105 lines) | Exports `pickProjectId(context, endpoint, accessToken, last, target?, output?)`. JSDoc references D-08 + the circular-import rationale. |
| `src/extension.ts` | Removed inline `pickProjectId`; added `import { pickProjectId }`; added `getBaseAccessToken` + `listWorkspaces` to existing imports; `RunPrep` gained optional `workspaceName?`; `prepareRun` / `runScriptAtPath` / `debugScriptAtPath` all accept optional `target?`; new target branch mirrors `remoteExecution.ts:99-155`; ENV vars + last-pick key + pickProjectId placeholder now use target workspace when provided. |
| `src/scriptCommands.ts` | `runLocalFromScriptNode` / `debugLocalFromScriptNode` now resolve `sc` once and pass `{ workspaceId, workspaceAuthId }` as the third arg to their respective `*AtPath` call (only when `sc.workspaceId` is non-empty — defensive fall-through to active-workspace path if cache lookup yields no workspaceId). |
| `src/remoteExecution.ts` | Added `import { pickProjectId }`; Block A inserts `args.workspaceName = ws.name` overwrite after the not-found guard; Block B switched to `let parameters` and added the gated prompt fallback (D-06/D-07). |

## Commits

- `1e4839c` — `refactor(06-03): extract pickProjectId to projectPicker.ts with target param (D-08)`
- `f893b36` — `feat(06-03): route local run/debug through script's owning workspace (D-01..D-03) + fix cross-workspace header name (RESEARCH §5.4)`
- `4d213d7` — `feat(06-03): projectId prompt fallback for remote execute + shared last-pick cache (D-05..D-07); fix Block A workspaceName header (§5.4)`

## Deviation Notes

- **Inadvertent file inclusion:** commit `1e4839c` also contains `python/test/custom_script.py` — a user-local scratch script that was untracked at commit time and got swept in by `git add -A`. Harmless test artifact; flagged for the user to decide whether to keep, move, or strip via rewrite.
- **No deviations from the plan's `<acceptance_criteria>` — all 18 automated verifiers (across the 3 tasks) plus all 10 UAT scenarios passed.**
