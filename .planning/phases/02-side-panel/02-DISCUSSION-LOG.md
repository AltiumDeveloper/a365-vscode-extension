# Phase 2: Side Panel - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 02-side-panel
**Areas discussed:** Tree scope & token strategy, Loading & caching, Refresh UX, Status bar / auth indicator, Signed-out state, Empty-workspaces state, Network-error UX, Context menu split between Phase 2 and Phase 3, Local-run mechanics from tree

---

## Tree Scope & Token Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Single active workspace at root | Show only the currently selected workspace; switch via status bar | |
| All workspaces at root, lazy token exchange + cache | Show every workspace for the account; exchange + cache workspace token on first expand | ✓ |
| All workspaces, eager token exchange | Exchange tokens for every workspace at view open | |

**User's choice:** All workspaces at root, lazy `exchangeWorkspaceToken()` on expand, cache per-workspace token in `context.secrets`.
**Notes:** Keeps cold-start cheap and reuses the existing secrets store rather than introducing a new persistence layer.

---

## Loading & Caching

| Option | Description | Selected |
|--------|-------------|----------|
| Eager everything | Fetch workspaces, projects, scripts at view open | |
| Eager workspaces, lazy children, in-memory cache | Workspaces on open; projects/scripts on expand; session cache only | ✓ |
| Lazy everything with disk-persisted cache | Defer all fetches; persist cache across VS Code sessions | |

**User's choice:** Eager workspaces, lazy children, in-memory cache (no disk persistence).

---

## Refresh UX

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-refresh on focus | Re-fetch whenever the view gains focus | |
| Title-bar refresh icon | Manual button in the tree view title bar that clears cache and re-fetches | ✓ |
| Command palette only | `Altium 365: Refresh` command, no inline UI | |

**User's choice:** Title-bar refresh icon that clears the in-memory cache and re-fetches.

---

## Status Bar / Auth Indicator

| Option | Description | Selected |
|--------|-------------|----------|
| No indicator | Rely on view content + command palette for auth state | |
| Status bar item, label `A365: <user> • <env>`, click opens QuickPick | Always-visible indicator with Sign Out / Switch Environment / Switch Workspace actions | ✓ |
| Tree view header item | Render auth state at top of the side panel instead | |

**User's choice:** Status bar item `A365: <user> • <env>`; click → QuickPick with Sign Out / Switch Environment / Switch Workspace.

---

## Signed-Out State

| Option | Description | Selected |
|--------|-------------|----------|
| Empty tree | Show nothing until signed in | |
| `viewsWelcome` with Sign In button | Native VS Code welcome view that runs `altium365.signIn` | ✓ |
| Modal prompt on view open | Pop a sign-in dialog the first time the view is revealed | |

**User's choice:** `viewsWelcome` with a "Sign In" button bound to `altium365.signIn`.

---

## Empty Workspaces State

| Option | Description | Selected |
|--------|-------------|----------|
| Blank tree | Render nothing when the account has zero workspaces | |
| Informational tree item | Single non-actionable node "No workspaces available for this account" | ✓ |
| Welcome-style call to action | `viewsWelcome` block prompting workspace creation in the portal | |

**User's choice:** Single informational tree item.

---

## Network-Error UX

| Option | Description | Selected |
|--------|-------------|----------|
| Toast only | `showErrorMessage` with a retry action | |
| Inline error node with click-to-retry, detail to outputChannel, no toast | Render the failure in-tree and log full detail to the existing output channel | ✓ |
| Silent log, no UI surface | Only write to outputChannel | |

**User's choice:** Inline error tree item that retries on click; full error to `outputChannel`; no toast.

---

## Context Menu Split (Phase 2 vs Phase 3)

| Option | Description | Selected |
|--------|-------------|----------|
| Register only Run Local now | Add the other three actions in Phase 3 (requires `package.json` edits then) | |
| Register all four now, only Run Local fully wired; others show "Coming in Phase 3" | All commands + menu entries land in Phase 2; Phase 3 swaps three placeholder handlers | ✓ |
| Hide the menu entirely until Phase 3 | Ship the tree without context actions in Phase 2 | |

**User's choice:** Register all four commands + menu items in Phase 2; only `runLocal` is fully implemented; the other three show an info message ("Coming in Phase 3") that Phase 3 replaces.
**Notes:** Keeps `package.json` stable across phase boundaries and lets Phase 3 be a pure code change.

---

## Local-Run Mechanics From Tree

| Option | Description | Selected |
|--------|-------------|----------|
| Download script body, write to tmpdir, reuse existing `_runner.py` flow | Fetch via `gloScrScripts` → `os.tmpdir()` .py file → existing local-run subprocess pipeline → cleanup | ✓ |
| Stream body to a virtual document, run via in-memory bridge | Avoid disk by piping the body directly into the runner | |
| Force user to save script locally first | Tree action opens the body in an editor; user runs the existing local command manually | |

**User's choice:** Fetch body via `gloScrScripts`, write to `os.tmpdir()` as `.py`, invoke the existing `python/_runner.py` subprocess flow, clean up the temp file after.

---

## Agent's Discretion

- Exact `viewsContainer` icon (Codicon or contributed SVG)
- TreeItem `contextValue` strings (e.g. `workspaceNode` / `projectNode` / `scriptNode`)
- Whether to query scripts via a project-scoped path or a dedicated scripts query — confirm against the live GraphQL schema during research

## Deferred Ideas

- Remote script edit / execute / publish handlers — Phase 3
- Cross-session disk-persisted tree cache — explicitly rejected (in-memory only)
- Phase 1 carry-forward fixes (`LICENSE`, `license` field, ci.yml hardening) — tracked in `01-REVIEW.md`
