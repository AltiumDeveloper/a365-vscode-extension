# Phase 1: Packaging - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 1-Packaging
**Areas discussed:** Publisher & display name, Metadata scope, Extension icon, CI trigger strategy

---

## Publisher & display name

| Option | Description | Selected |
|--------|-------------|----------|
| `altium` | Assumes ownership of the 'altium' publisher org on VS Code Marketplace | ✓ |
| Custom publisher ID | Use a more specific handle (altiumdev, altium365, etc.) | |
| Leave as placeholder | Keep 'local', revisit before Marketplace publish | |

**User's choice:** `altium`

| Option | Description | Selected |
|--------|-------------|----------|
| Altium 365 Scripting | Current value — accurate now, may feel narrow later | |
| Altium 365 Developer Tools | Broader, fits the full roadmap scope | ✓ |
| Keep now, rename in Phase 2 | Defer renaming until side panel ships | |

**User's choice:** `Altium 365 Developer Tools`
**Notes:** Intentional forward-looking rename to reflect the full roadmap (side panel + remote scripts in Phases 2–3), not just local scripting.

---

## Metadata scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full roadmap scope (Recommended) | Describe the complete v1 product — workspace navigation, local scripts, remote scripts | ✓ |
| Current-state only, update per phase | Accurate today; update README/description incrementally | |
| Minimal description, all detail in README | One-liner in package.json, full detail in README only | |

**User's choice:** Write for full roadmap scope

| Option | Description | Selected |
|--------|-------------|----------|
| Other + Programming Languages + Debuggers | Matches local run/debug features | |
| Other only | Minimal required, easy to update | ✓ |
| Other + Programming Languages | Middle ground | |

**User's choice:** `["Other"]` only

| Option | Description | Selected |
|--------|-------------|----------|
| Functional doc, text-only (Recommended) | Prerequisites, install, sign-in, local run/debug, env switching — no screenshots | ✓ |
| With screenshots | Same content plus annotated screenshots | |
| Minimal stub | Just enough to pass Marketplace validation | |

**User's choice:** Functional documentation, text-only, no screenshots

---

## Extension icon

| Option | Description | Selected |
|--------|-------------|----------|
| Simple placeholder PNG (Recommended) | Create 128×128 PNG, commit as resources/icon.png | |
| No icon for now | Skip icon field, add later | |
| Real Altium brand asset | Source from official brand assets | |

**User's choice (free-text):** "I don't have a final icon, but if we can create one in VS Code style (monochrome) based on [Altium 365 brand icon]"

**Reference URL provided:** `https://cdn-1.webcatalog.io/catalog/altium-365/altium-365-icon-filled-256.png`

**Notes:** User wants a VS Code-style monochrome icon (single-color, dark-theme compatible) visually derived from the Altium 365 brand mark. Committed at `resources/icon.png`.

---

## CI trigger strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Push to all branches + PRs (Recommended) | Full pipeline runs everywhere, VSIX always available | |
| main branch only | Only main gets a VSIX artifact | ✓ |
| Compile always, package on tag | Package only on version tags | |

**User's choice:** main branch only

| Option | Description | Selected |
|--------|-------------|----------|
| Node 18 (Recommended) | Matches engines.node requirement | ✓ |
| Node 20 | Newer LTS, compatible | |
| Matrix: 18 + 20 | Test both versions | |

**User's choice:** Node 18

---

## Agent's Discretion

- Exact keywords list in package.json (~6-8 relevant terms)
- VSIX artifact retention period (GitHub Actions default acceptable)
- Whether to bump version from 0.0.2 to 0.1.0 for first packagable build

## Deferred Ideas

None — discussion stayed within phase scope.
