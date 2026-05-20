---
phase: 03-remote-script-ops
plan: 01
slug: files-foundation
status: complete
---

# Plan 03-01 — Files Foundation — SUMMARY

## What landed

- `WorkspaceLocation.filesServiceUrl?: string` added; `listWorkspaces` selects it.
- `getWorkspaceFilesUrl(ws, fallback?)` helper — D-19 carry-over to the Files Service tier; throws actionable "refresh the workspace list" on missing field.
- `GraphQLError` class exported from `src/workspace.ts` (carries `code`, `path`, `rawErrors`); `graphqlRequest` now throws it on `payload.errors`.
- `src/filesService.ts` (new) — `downloadByToken` (GET) + `uploadAndGetToken` (multipart POST). Encodes the operator-pinned smoke-probe contract from 2026-05-20.

## Pinned Files Service REST contract (operator-captured 2026-05-20, dev1)

| Op | URL | Verb | Body | Response |
|----|-----|------|------|----------|
| Download | `${filesServiceUrl}/File/Download?id=${fileToken}` | GET | — | `application/octet-stream` raw bytes |
| Upload | `${filesServiceUrl}/File/Upload` | POST | `multipart/form-data` field `file` | `text/plain` bare UUID |

Token charset: `^[A-Za-z0-9-]+$` (UUID-v4 hex+dashes only). Auth: workspace-scoped bearer, never base.

## Verification

- `npm run compile` clean.
- Greps: `filesServiceUrl` x6 in `workspace.ts`; `getWorkspaceFilesUrl` x2; both filesService exports present; token-hygiene gate clean (no bearer in throw/log).

## Invariants preserved

- 02.2 auth surface untouched.
- D-17 (Node `https` for ActionWait) untouched — new code uses `globalThis.fetch` consistent with `graphqlRequest`.
- D-18 (env-switch ordering) untouched.
- D-19 — `getWorkspaceFilesUrl` mirrors `getWorkspaceApiUrl` shape.
- No new npm packages.
