# Phase 9: Editor IntelliSense for injected PYTHONPATH libraries - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 closes the gap between the Python runtime environment that Altium Developer prepares for script execution and the Python analysis environment that VS Code uses for IntelliSense.

Today the extension prepends sandbox helper paths only to the spawned subprocess `PYTHONPATH`, so runtime imports work while the editor still reports unresolved imports and loses autocomplete, hover, and go-to-definition for bundled helper modules and vendored dependencies.

This phase delivers editor-side IntelliSense support that mirrors the runtime helper path model, starting with workspace-level Python analysis configuration and extending into non-workspace editing flows where needed. The phase includes user-consent handling, missing-tooling behavior, and safe cleanup/reconciliation of any editor settings the extension manages.

Out of scope: broader Python environment management, redesigning the script runtime, guaranteeing full parity for every possible virtual-document provider without validation, and unrelated remote-customization/domain-model work.

</domain>

<decisions>
## Implementation Decisions

### Scope and path strategy
- **D-01:** Phase 9 should target a hybrid outcome in one phase: workspace-level IntelliSense support plus a fallback path for temp-file or non-workspace editing flows if `python.analysis.extraPaths` alone is insufficient.
- **D-02:** The editor-side path set should exactly mirror the runtime helper injection order already used by the extension. Editor analysis should follow the same ordered chunks as runtime `PYTHONPATH`, not a reduced or divergent subset.
- **D-03:** The primary fallback mechanism for non-workspace and virtual-editor coverage is intentionally not locked yet. Research should validate what Pylance actually honors for `altium365-script://`, `altium365-event://`, and temp-file editing, then the planner can choose the best implementation.
- **D-04:** If virtual-document IntelliSense parity is not fully feasible in this phase, research may explicitly split the implementation around temp-file parity plus a documented limitation instead of forcing an unvalidated promise.

### Consent and setup UX
- **D-05:** The extension must not silently rewrite `python.analysis.extraPaths`. Use a one-time prompt before enabling managed editor-side IntelliSense setup.
- **D-06:** If the user declines the setup prompt, remember that skip and do not keep re-prompting automatically. Re-enablement should require an explicit user action.
- **D-07:** In addition to the one-time prompt, provide an explicit command so users can later enable, disable, or re-run IntelliSense setup intentionally.

### Python extension coupling
- **D-08:** Python editor integration is best-effort, not a hard extension dependency. Runtime execution continues to work even when Python editor tooling is absent.
- **D-09:** Missing Python/Pylance tooling should surface as a proactive startup warning rather than failing silently.
- **D-10:** Planning should target Pylance/Pyright behavior first as the primary IntelliSense integration surface for VS Code Python analysis.

### Managed cleanup and drift handling
- **D-11:** When `altium365.injectHelper` is turned off, remove only the editor-analysis entries that Altium Developer itself manages. Never clobber user-defined `python.analysis.extraPaths` values.
- **D-12:** The exact mechanism for identifying managed entries is left to research/planning. The requirement is safe ownership tracking and reversible cleanup, not a specific persistence approach.
- **D-13:** After the user has granted consent, the extension should self-heal drift between the current runtime helper path set and the managed editor-side path set.

### the agent's Discretion
- The exact fallback implementation for virtual or temp-file flows after research validates Pylance behavior.
- The safest mechanism for recording which analysis-path entries are extension-managed.
- The exact command name and where the startup warning / recovery affordance should surface in VS Code, as long as the consent and reversibility decisions above are preserved.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Runtime path wiring
- `src/extension.ts:880-910` — current runtime env assembly, including `injectHelper`, `getSandboxPythonPath(context)`, and `env.PYTHONPATH` prepending order
- `src/sandboxDeps.ts:209-218` — canonical helper-path builder for sandbox imports; defines the current runtime path chunks and ordering
- `package.json:218-221` — `altium365.injectHelper` configuration contract that Phase 9 must stay aligned with

### Python tooling integration
- `src/extension.ts:568-583` — existing `ms-python.python` integration pattern for resolving Python interpreter information
- `package.json:208-221` — Python-related extension settings (`pythonPath`, `extraEnv`, `injectHelper`) that constrain how new IntelliSense configuration should fit the current surface area
- `.planning/codebase/CONCERNS.md` — notes existing fragility around the Python extension API and why hard coupling should be treated carefully

### Existing project guidance
- `.planning/todos/pending/2026-05-26-editor-intellisense-for-injected-pythonpath-libraries.md` — original problem statement, acceptance criteria, and open investigation prompts captured before Phase 9 was created
- `.planning/ROADMAP.md` — Phase 9 entry and milestone context
- `.planning/STATE.md` — current project focus, known concerns, and pending todo context
- `.planning/codebase/STACK.md` — current Python/runtime/configuration surface and `injectHelper` setting definition
- `.planning/codebase/ARCHITECTURE.md` — current extension layering and where editor/runtime integration points live
- `.planning/codebase/CONVENTIONS.md` — command/config/error-handling conventions to preserve when adding setup UX and warnings
- `.planning/phases/06-script-execution-ux-and-unified-params/06-CONTEXT.md` — recent prior-phase context for temp-file editing flows and script UX decisions that this phase builds on

### External specs
- No external specs or ADRs were referenced during discussion. Requirements are captured in the decisions above and the source todo.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getSandboxPythonPath(context)` in `src/sandboxDeps.ts` already centralizes the helper-path list that runtime prepends; it is the natural source of truth for editor-side mirroring.
- `src/extension.ts` already contains Python-extension integration code (`ms-python.python`) and runtime environment assembly, so Phase 9 can likely extend an existing integration seam rather than inventing a separate subsystem.
- Existing configuration surface in `package.json` already holds the Python/runtime knobs that this feature must stay consistent with.

### Established Patterns
- The extension prefers additive settings and explicit user-facing commands rather than hidden global behavior changes.
- Runtime helper injection is currently guarded by `altium365.injectHelper`; editor-side IntelliSense management should follow the same controlling switch.
- Best-effort fallbacks already exist in the Python integration path (`ms-python.python` if present, otherwise PATH-based Python), which supports the decision to keep editor IntelliSense integration non-blocking.

### Integration Points
- `src/extension.ts` is the main integration point for activation-time checks, one-time prompt flow, startup warnings, and any command that re-runs or disables IntelliSense setup.
- `src/sandboxDeps.ts` owns the helper-path composition logic and should remain the authoritative source for any mirrored editor path list.
- `package.json` will need any new command/config metadata tied to IntelliSense setup, consent recovery, or warning behavior.
- Temp-file and remote-edit flows from earlier phases are relevant because research/planning may need to attach editor-analysis hints where files are actually opened.

</code_context>

<specifics>
## Specific Ideas

- Treat Pylance/Pyright as the primary analysis target for planning and validation.
- Keep the feature reversible: once the extension manages editor analysis paths, it must also be able to cleanly remove only its own entries later.
- The startup warning for missing Python tooling should be explicit enough that users understand IntelliSense enhancement is unavailable, while runtime script execution remains unaffected.
- Research is expected to answer the unresolved feasibility question around `altium365-script://` and other non-workspace editors before the planner locks implementation details.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-editor-intellisense-for-injected-pythonpath-libraries*
*Context gathered: 2026-05-26*
