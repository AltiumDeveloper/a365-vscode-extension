# Phase 9: Editor IntelliSense for injected PYTHONPATH libraries - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 09-editor-intellisense-for-injected-pythonpath-libraries
**Areas discussed:** Editor path strategy, User consent model, Python extension coupling, Managed cleanup rules

---

## Editor path strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid in one phase | Ship workspace `python.analysis.extraPaths` plus a fallback path for tmp/virtual editors in the same phase. | ✓ |
| Workspace first only | Limit Phase 9 to workspace and straightforward local files first. | |
| Tmp files first | Prioritize tmp/debug/edit paths even if virtual FS remains imperfect. | |

**User's choice:** Hybrid in one phase
**Notes:** Exact editor-side paths should mirror runtime injection. For the fallback mechanism beyond `extraPaths`, do not lock it yet — research should validate what Pylance honors and the planner can choose the implementation. If virtual docs remain difficult, research may split the phase around temp-file parity plus an explicit limitation.

---

## User consent model

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt once | Ask permission before managing `python.analysis.extraPaths`. | ✓ |
| Auto-manage silently | Update workspace settings automatically whenever needed. | |
| Manual opt-in only | Require a user-triggered setup flow with no prompt-driven automation. | |

**User's choice:** Prompt once
**Notes:** If the user says no, remember the skip and stop prompting automatically. Also provide a command so the user can later enable, disable, or re-run IntelliSense setup intentionally.

---

## Python extension coupling

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort integration | Improve IntelliSense when Python/Pylance tooling is installed, without making them hard dependencies. | ✓ |
| Hard dependency | Declare Python tooling as required for the feature. | |
| Soft require with warning | Do not hard-depend, but warn only when setup/use needs missing tooling. | |

**User's choice:** Best-effort integration
**Notes:** Missing tooling should still produce a proactive startup warning. Planning should target Pylance/Pyright behavior first as the primary analysis stack.

---

## Managed cleanup rules

| Option | Description | Selected |
|--------|-------------|----------|
| Remove only managed paths | Clean up only entries Altium Developer added when helper injection is disabled. | ✓ |
| Leave them in place | Do not automatically touch editor analysis settings on disable. | |
| Ask before removing | Prompt before cleanup when helper injection is disabled. | |

**User's choice:** Remove only managed paths
**Notes:** The exact ownership-tracking mechanism is left to planning/research. After consent is granted, managed entries should self-heal if they drift from the current runtime helper path set.

---

## the agent's Discretion

- Choose the exact fallback implementation for virtual/non-workspace editors after research validates Pylance behavior.
- Choose the safest mechanism for tracking managed editor-analysis entries.
- Choose the exact command surface and warning placement, while preserving the consent and reversibility decisions above.

## Deferred Ideas

None.
