# Phase 9: Temp-File Coverage Proof

**Proven:** 2026-05-26
**Tested surface:** Remote temp-file Edit Script flow under `os.tmpdir()/altium365/<workspaceAuthId>/<scriptId>/*.py`
**Result:** `proof_result: fallback-required`

## Summary

Workspace-level `python.analysis.extraPaths` does **not** provide IntelliSense coverage for temp files opened outside the workspace folder. This is expected VS Code/Pylance behavior — workspace settings are scoped to workspace folders, and temp files materialized under `os.tmpdir()` are not part of the workspace.

Therefore, the fallback mechanism (Altium-managed `pyrightconfig.json` in the temp root) is **required** to provide IntelliSense parity for remote temp-file editing.

## Verification Details

**Test procedure:**
1. Python + Pylance extensions installed in VS Code
2. Opened a remote script through Edit Script (materialized under `os.tmpdir()/altium365/...`)
3. Temporarily added Phase 9 helper roots to workspace `python.analysis.extraPaths`:
   - `<extension-path>/python/SandboxProcess`
   - `<extension-path>/python/SandboxProcess/.deps`
   - `<extension-path>/python`
4. Added test imports in temp-file editor:
   ```python
   import altium
   import gql
   ```

**Observation:**
The imports did **not** resolve. Red squiggles remained, IntelliSense did not work, indicating workspace settings are insufficient for temp files.

## Implementation Branch Selection

**Selected branch:** Fallback required

Task 2 must implement:
1. Workspace-level `python.analysis.extraPaths` reconciliation for workspace-backed Python files
2. Altium-managed `pyrightconfig.json` fallback scoped to `os.tmpdir()/altium365/...` for orphan temp-file editors
3. Both mechanisms using the same canonical helper-path order from `getSandboxPythonPath(context)`

The fallback `pyrightconfig.json` will be refreshed/removed in lockstep with the managed helper-path state, ensuring consistent behavior across workspace and temp-file editing surfaces.

---

**Machine-readable marker:**
```
proof_result: fallback-required
```
