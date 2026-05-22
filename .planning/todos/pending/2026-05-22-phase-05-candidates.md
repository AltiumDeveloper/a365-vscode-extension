---
id: 2026-05-22-phase-05-candidates
created: 2026-05-22
status: pending
area: ui
source: post-phase-04 UAT session
---

# Phase 05 candidates — script-execution UX polish & unified params

Collected during Phase 04 UAT loop. Group of related improvements that together form a coherent "script execution UX" phase. Some are tiny fixes, some are larger ideas (test events). Worth a single discuss-phase pass to scope.

## Items

1. **Workspace-context awareness for script execution.** Both local and remote runs of a script must execute in the context of the workspace that script belongs to. Today the active workspace token is used regardless of which workspace owns the script. Behavior: when user invokes run/debug/execute on a script node, auto-switch the active workspace (or transparently use the matching workspace token) so the script sees the right environment.

2. **Save-back regression after remote debug.** Reported flow: debug a remote script locally → edit the file → save → changes are not pushed back to remote. Verify against UAT-6/UAT-7 cache+save-bridge work; may be a missed code path (e.g., `debugScriptAtPath` doesn't register the tmp file in `localScriptCache` the same way `editScript` does).

3. **Unified parameter prompting across local and remote.** Local run/debug prompts for project; remote execute doesn't. Parameter passing must be identical across the three execution modes. Pairs with item 9 (test events).

4. **Double-click remote script in sidebar → open for Edit.** Currently requires context-menu → Edit. Default activation should open the file (same code path as `editScript`).

5. **Remove "Publish Script" context-menu item.** Cmd+S already publishes via the save bridge; the explicit menu entry is redundant and confusing.

6. **Rename tmp file to script GRID.** Today: `altium365-<scriptId>-<basename>.py`. Want: file named after the script's GRID (Altium's global resource id) so the tab title is meaningful and matches what users see in A365.

7. **Editor title-bar consolidation: "Altium 365" dropdown.** Replace the separate "Publish" and "Execute Remotely" title-bar buttons with one branded "Altium 365" dropdown containing: Publish, Execute (Local), Debug (Local), Execute (Remote). Reduces title-bar clutter and groups related actions.

8. **Show the "Altium 365" dropdown for any local `.py` file.** Not only for remote-tmp files. A user editing a standalone local Python script in the workspace should still be able to run/debug it through the extension via the same dropdown.

9. **AWS-Lambda-style "test events" for script parameters.** Multiple named parameter templates per script, editable and switchable, used identically for local and remote execution. Built-in preset: "project-related" (current `projectId` pattern). Users can create custom named templates. UI similar to AWS Lambda's test event dropdown. This generalizes item 3 and likely subsumes the current ad-hoc `*.params.json` files.

## Suggested scoping

- **Quick wins (1 plan):** 4, 5, 6
- **Title-bar UX (1 plan):** 7, 8
- **Execution correctness (1 plan):** 1, 2, 3
- **Test events feature (1 plan, larger):** 9 (depends on 3)

Discuss-phase should validate this breakdown before planning.
