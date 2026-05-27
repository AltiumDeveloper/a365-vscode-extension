# Phase 09: Editor IntelliSense for injected PYTHONPATH libraries - Research

**Researched:** 2026-05-26
**Domain:** VS Code Python editor analysis parity for extension-managed helper paths [VERIFIED: codebase grep]
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Phase 9 should target a hybrid outcome in one phase: workspace-level IntelliSense support plus a fallback path for temp-file or non-workspace editing flows if `python.analysis.extraPaths` alone is insufficient.
- **D-02:** The editor-side path set should exactly mirror the runtime helper injection order already used by the extension. Editor analysis should follow the same ordered chunks as runtime `PYTHONPATH`, not a reduced or divergent subset.
- **D-03:** The primary fallback mechanism for non-workspace and virtual-editor coverage is intentionally not locked yet. Research should validate what Pylance actually honors for `altium365-script://`, `altium365-event://`, and temp-file editing, then the planner can choose the best implementation.
- **D-04:** If virtual-document IntelliSense parity is not fully feasible in this phase, research may explicitly split the implementation around temp-file parity plus a documented limitation instead of forcing an unvalidated promise.
- **D-05:** The extension must not silently rewrite `python.analysis.extraPaths`. Use a one-time prompt before enabling managed editor-side IntelliSense setup.
- **D-06:** If the user declines the setup prompt, remember that skip and do not keep re-prompting automatically. Re-enablement should require an explicit user action.
- **D-07:** In addition to the one-time prompt, provide an explicit command so users can later enable, disable, or re-run IntelliSense setup intentionally.
- **D-08:** Python editor integration is best-effort, not a hard extension dependency. Runtime execution continues to work even when Python editor tooling is absent.
- **D-09:** Missing Python/Pylance tooling should surface as a proactive startup warning rather than failing silently.
- **D-10:** Planning should target Pylance/Pyright behavior first as the primary IntelliSense integration surface for VS Code Python analysis.
- **D-11:** When `altium365.injectHelper` is turned off, remove only the editor-analysis entries that Altium Developer itself manages. Never clobber user-defined `python.analysis.extraPaths` values.
- **D-12:** The exact mechanism for identifying managed entries is left to research/planning. The requirement is safe ownership tracking and reversible cleanup, not a specific persistence approach.
- **D-13:** After the user has granted consent, the extension should self-heal drift between the current runtime helper path set and the managed editor-side path set.

### the agent's Discretion
- The exact fallback implementation for virtual or temp-file flows after research validates Pylance behavior.
- The safest mechanism for recording which analysis-path entries are extension-managed.
- The exact command name and where the startup warning / recovery affordance should surface in VS Code, as long as the consent and reversibility decisions above are preserved.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

## Summary

The extension already has a clean single source of truth for runtime helper import roots: `getSandboxPythonPath(context)` returns `python/SandboxProcess` then `python/SandboxProcess/.deps`, and `prepareRun` appends `python/` last when `altium365.injectHelper` is enabled. Phase 9 should reuse that exact ordered list for editor analysis parity rather than re-deriving paths in a second place. [VERIFIED: codebase grep]

`python.analysis.extraPaths` is the documented Pylance/Pyright knob for additional import roots, and Pyright searches those paths in the order provided. It affects static analysis only; it does not change runtime `sys.path`. That makes it the right primary mechanism for workspace-backed IntelliSense, but not a substitute for the existing subprocess `PYTHONPATH` injection. [CITED: https://code.visualstudio.com/docs/python/settings-reference] [CITED: https://github.com/microsoft/pyright/blob/main/docs/import-resolution.md] [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md]

The biggest planning risk is over-promising parity for non-file or out-of-workspace documents. The current remote editing path already opens real temp files from `os.tmpdir()/altium365/.../*.py`, while `altium365-event://` is JSON, not Python. Official docs clearly describe how Pylance/Pyright use workspace roots, execution environments, and extra paths, but I did not find official documentation that guarantees full IntelliSense parity for custom `altium365:` virtual Python documents. Plan for: (1) workspace + temp-file parity first, (2) best-effort warning/command UX, and (3) a documented limitation or follow-up if `altium365:` virtual-doc parity cannot be validated quickly. [VERIFIED: codebase grep] [CITED: https://code.visualstudio.com/api/extension-guides/virtual-documents] [CITED: https://github.com/microsoft/pyright/blob/main/docs/configuration.md] [CITED: https://github.com/microsoft/pylance-release/blob/main/TROUBLESHOOTING.md]

**Primary recommendation:** Use a consent-gated reconciler that mirrors `[SandboxProcess, SandboxProcess/.deps, python]` into `python.analysis.extraPaths`, tracks only extension-owned entries in `globalState`, warns when Python/Pylance is missing, and treats true virtual-document parity as best-effort unless early UAT proves it. [VERIFIED: codebase grep] [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] [ASSUMED]

## Project Constraints (from AGENTS.md)

- Read `STATE.md` before work; this phase was gathered after Phase 08.1 and is pending planning. [VERIFIED: codebase grep]
- Read the active phase `PLAN.md` before execution; this research is for planning only. [VERIFIED: codebase grep]
- Commit atomically per plan; do not combine multiple plans into one commit. [VERIFIED: codebase grep]
- Update `STATE.md` after each phase transition. [VERIFIED: codebase grep]
- Keep all tokens in `context.secrets`; never introduce plaintext token storage while adding IntelliSense setup. [VERIFIED: codebase grep]
- Reuse existing VS Code extension patterns: `altium365.*` command prefix, async/await, command-boundary `showErrorMessage`, and no new module-level state except the existing `outputChannel` pattern. [VERIFIED: codebase grep]
- Preserve the existing Python integration seam in `src/extension.ts`; the codebase already treats `ms-python.python` as optional and falls back to PATH resolution. [VERIFIED: codebase grep]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Runtime helper path composition | API / Backend | — | The extension host already owns script launch env assembly and `PYTHONPATH` order in `prepareRun` plus `getSandboxPythonPath`. [VERIFIED: codebase grep] |
| Editor analysis path reconciliation | Frontend Server (SSR) | Browser / Client | VS Code extension host is the only tier that can read config, prompt for consent, and update workspace settings. [VERIFIED: codebase grep] [CITED: https://code.visualstudio.com/api/references/vscode-api#WorkspaceConfiguration] |
| Python IntelliSense / import resolution | Browser / Client | Frontend Server (SSR) | Pylance/Pyright runs as editor tooling and consumes workspace settings/config files rather than subprocess env vars. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] [CITED: https://github.com/microsoft/pyright/blob/main/docs/import-resolution.md] |
| Remote script editable surface | Frontend Server (SSR) | Browser / Client | Current edit/debug/run flows materialize remote scripts as real temp files, which the editor then opens as `file:` documents. [VERIFIED: codebase grep] |
| Legacy virtual remote document surface | Browser / Client | Frontend Server (SSR) | `altium365:` and `altium365-event:` are FileSystemProvider-backed URIs whose editor behavior depends on downstream language tooling support. [VERIFIED: codebase grep] [CITED: https://code.visualstudio.com/api/extension-guides/virtual-documents] |
| Consent / warning / recovery UX | Frontend Server (SSR) | Browser / Client | One-time prompts, startup warnings, and explicit commands are extension-host responsibilities. [VERIFIED: codebase grep] |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| VS Code Extension API | `^1.85.0` host minimum [VERIFIED: codebase grep] | Read/update workspace settings, prompt users, register commands, probe installed extensions. [VERIFIED: codebase grep] | This is the supported API surface for reversible workspace setting management. [CITED: https://code.visualstudio.com/api/references/vscode-api#WorkspaceConfiguration] |
| Pylance (`ms-python.vscode-pylance`) | user-installed, not pinned [VERIFIED: codebase grep] | Primary Python IntelliSense engine for imports, hover, completion, go-to-definition. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] | Pylance is Microsoft’s default rich Python language support in VS Code and is powered by Pyright. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] |
| Python extension (`ms-python.python`) | user-installed, not pinned [VERIFIED: codebase grep] | Supplies interpreter selection and hosts Pylance as an optional dependency. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] | The codebase already integrates with it opportunistically rather than as a hard dependency. [VERIFIED: codebase grep] |
| Pyright configuration model | current docs, not repo-pinned [CITED: https://github.com/microsoft/pyright/blob/main/docs/configuration.md] | Fallback config surface when workspace settings are insufficient. [CITED: https://github.com/microsoft/pyright/blob/main/docs/configuration.md] | It is the documented source of truth for import roots, execution environments, and search order. [CITED: https://github.com/microsoft/pyright/blob/main/docs/configuration.md] [CITED: https://github.com/microsoft/pyright/blob/main/docs/import-resolution.md] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `python.analysis.extraPaths` | setting, no package version [CITED: https://code.visualstudio.com/docs/python/settings-reference] | Add editor-only import roots in a documented way. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md] | Use as the first-line workspace parity mechanism. [CITED: https://github.com/microsoft/pylance-release/blob/main/TROUBLESHOOTING.md] |
| `pyrightconfig.json` / `[tool.pyright]` | config file, no package version [CITED: https://github.com/microsoft/pyright/blob/main/docs/configuration.md] | Define `extraPaths`, execution environments, and verbose troubleshooting outside VS Code settings. [CITED: https://github.com/microsoft/pyright/blob/main/docs/configuration.md] | Use only if workspace settings fail to cover a validated temp-file/orphan scenario. [ASSUMED] |
| `context.globalState` | VS Code host API [VERIFIED: codebase grep] | Persist one-time consent state and the last known extension-owned path set. [VERIFIED: codebase grep] | Use for ownership tracking and skip markers because the project already uses it for non-sensitive extension state. [VERIFIED: codebase grep] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `python.analysis.extraPaths` as primary | Adjacent `pyrightconfig.json` only | Stronger for path-specific config, but less ergonomic and less clearly reversible for ordinary workspace users. [CITED: https://github.com/microsoft/pyright/blob/main/docs/configuration.md] [ASSUMED] |
| Workspace/temp-file parity first | Full `altium365:` virtual-doc parity promise | No official doc found that guarantees custom-scheme Python documents will honor the same import-resolution behavior; higher delivery risk. [CITED: https://code.visualstudio.com/api/extension-guides/virtual-documents] [ASSUMED] |
| Pylance/Pyright config | `python.envFile` / `.env` fallback | Official docs describe `.env` for terminal/debug env vars, not static import resolution. [CITED: https://code.visualstudio.com/docs/python/environments#_env-file-support] |

**Installation:**
```bash
# No new npm package is required for Phase 9.
# The feature relies on the existing extension host plus optional user-installed Python/Pylance tooling.
```

## Architecture Patterns

### System Architecture Diagram
```text
altium365.injectHelper toggle / activation
                |
                v
   extension.ts activation + config listeners
                |
                +--> compute canonical helper paths
                |        getSandboxPythonPath(context) + pythonDir
                |        [SandboxProcess, .deps, python]
                |
                +--> probe Python + Pylance presence
                |        |
                |        +--> missing => startup warning + recovery command
                |
                +--> consent state in globalState
                         |
                         +--> declined => no auto writes, explicit command only
                         |
                         +--> allowed => reconcile python.analysis.extraPaths
                                      |
                                      +--> remove previous extension-owned entries
                                      +--> append current canonical entries in runtime order
                                      +--> preserve user entries untouched
                                      |
                                      +--> Pylance/Pyright re-analyzes file/temp-file documents

run/debug path remains unchanged:
prepareRun -> env.PYTHONPATH uses same canonical path order
```

### Recommended Project Structure
```text
src/
├── extension.ts                 # activation, command wiring, startup probe
├── sandboxDeps.ts               # canonical runtime/editor helper path source
├── pythonAnalysisSync.ts        # new reconciler + consent/status helpers [ASSUMED]
└── scriptCommands.ts            # temp-file edit/run/debug flows already used
```

### Pattern 1: Canonical Path Source Reuse
**What:** Derive editor analysis paths from the exact runtime helper-path builder and append `pythonDir` last to mirror subprocess behavior. [VERIFIED: codebase grep]
**When to use:** Every activation, `injectHelper` toggle, explicit repair command, and extension update reconciliation. [VERIFIED: codebase grep] [ASSUMED]
**Example:**
```typescript
// Source: src/sandboxDeps.ts + src/extension.ts runtime assembly
const sandboxPaths = getSandboxPythonPath(context);
const desired = [...sandboxPaths, context.asAbsolutePath('python')];
```

### Pattern 2: Managed-Entries Reconciler
**What:** Store the last extension-owned normalized path array in `globalState`; when reconciling, subtract only those previous values from current `python.analysis.extraPaths`, then append the new desired list in runtime order. [VERIFIED: codebase grep] [ASSUMED]
**When to use:** Consent approved, `injectHelper` flips, extension path changes after update, or user runs the repair command. [ASSUMED]
**Example:**
```typescript
// Source: VS Code configuration API + project globalState usage
const previousManaged = context.globalState.get<string[]>('altium365.pythonAnalysis.managedPaths', []);
const existing = config.get<string[]>('extraPaths', []);
const preservedUser = existing.filter((entry) => !previousManaged.includes(normalize(entry)));
const next = injectHelper ? [...preservedUser, ...desiredManaged] : preservedUser;
```

### Pattern 3: Best-Effort Tooling Probe
**What:** Treat Python/Pylance as optional editor enhancers, not runtime blockers; warn proactively on activation when missing. [VERIFIED: codebase grep] [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance]
**When to use:** Activation and explicit repair/setup command. [ASSUMED]
**Example:**
```typescript
// Source: existing ms-python.python resolution pattern in src/extension.ts
const pythonExt = vscode.extensions.getExtension('ms-python.python');
const pylanceExt = vscode.extensions.getExtension('ms-python.vscode-pylance');
if (!pythonExt || !pylanceExt) {
  vscode.window.showWarningMessage('Altium Developer: runtime script execution still works, but helper IntelliSense setup needs Python + Pylance.');
}
```

### Anti-Patterns to Avoid
- **Clobbering `python.analysis.extraPaths`:** Never overwrite the entire array because users may already manage unrelated import roots. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md] [VERIFIED: codebase grep]
- **Using `.env` as an IntelliSense fix:** Official docs tie `.env` support to terminals/env injection, not static analysis search paths. [CITED: https://code.visualstudio.com/docs/python/environments#_env-file-support]
- **Promise-first virtual parity:** Do not lock `altium365:` scheme parity until early UAT proves actual Pylance behavior. [CITED: https://code.visualstudio.com/api/extension-guides/virtual-documents] [ASSUMED]
- **Duplicating helper-path logic:** A second hard-coded list will drift from runtime behavior on the next dependency/layout change. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Python import-resolution emulation | Custom resolver that tries to mimic `sys.path` rules in TypeScript | `python.analysis.extraPaths` first, `pyrightconfig.json` only if validated | Pyright already documents search order, execution environments, and interpreter-aware resolution. [CITED: https://github.com/microsoft/pyright/blob/main/docs/import-resolution.md] |
| Virtual-doc IntelliSense shim | Custom completion/hover provider for `altium365:` Python files | Real `file:` temp docs where possible | Pylance already provides rich language features; duplicating them would be a dead-end maintenance burden. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] [VERIFIED: codebase grep] |
| Blind settings rewrite | Manual JSON file edits to `.vscode/settings.json` or `*.code-workspace` | VS Code configuration API updates + preserved user entries | The API gives the supported path for settings updates and avoids brittle file-shape assumptions. [CITED: https://code.visualstudio.com/api/references/vscode-api#WorkspaceConfiguration] |

**Key insight:** This phase should configure the existing analysis engine, not recreate one. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance]

## Common Pitfalls

### Pitfall 1: Wrong import root
**What goes wrong:** Paths point at `.../package` instead of the parent directory that belongs on `sys.path`, so unresolved imports remain. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md]
**Why it happens:** `extraPaths` expects import roots, not arbitrary folders. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md]
**How to avoid:** Mirror runtime roots exactly: `SandboxProcess`, then `SandboxProcess/.deps`, then `python`. [VERIFIED: codebase grep]
**Warning signs:** `import altium` or `import gql` still squiggles even though the configured directory exists. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md]

### Pitfall 2: Treating `.env` / `PYTHONPATH` as an editor fix
**What goes wrong:** Runtime works, but editor squiggles remain. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md]
**Why it happens:** `extraPaths` is the documented static-analysis setting; `.env` docs describe terminal/env injection instead. [CITED: https://code.visualstudio.com/docs/python/settings-reference] [CITED: https://code.visualstudio.com/docs/python/environments#_env-file-support]
**How to avoid:** Use `python.analysis.extraPaths` for analysis and keep subprocess `PYTHONPATH` for runtime. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md] [VERIFIED: codebase grep]
**Warning signs:** Imports resolve only after actually running/debugging the script. [ASSUMED]

### Pitfall 3: Clobbering user-owned paths during cleanup
**What goes wrong:** Disabling `injectHelper` breaks unrelated workspace imports. [VERIFIED: codebase grep] [ASSUMED]
**Why it happens:** Cleanup logic removes by recomputing from current desired paths instead of subtracting the last managed set. [ASSUMED]
**How to avoid:** Persist the previous extension-owned normalized path list and remove only those entries. [ASSUMED]
**Warning signs:** User entries disappear after toggling the feature or after extension upgrade. [ASSUMED]

### Pitfall 4: Over-scoping virtual-document support
**What goes wrong:** The plan promises parity for `altium365:` docs without proof, then burns time fighting tool behavior instead of shipping workspace/temp-file parity. [VERIFIED: codebase grep] [ASSUMED]
**Why it happens:** VS Code supports custom document schemes, but that does not itself guarantee Pylance import-resolution parity for those schemes. [CITED: https://code.visualstudio.com/api/extension-guides/virtual-documents] [ASSUMED]
**How to avoid:** Make plan wave 1 prove `file:` temp parity and capture explicit UAT for `altium365:` only if still relevant. [ASSUMED]
**Warning signs:** Repro steps depend on legacy `altium365:` documents instead of the current temp-file edit path. [VERIFIED: codebase grep]

### Pitfall 5: Missing-tooling silence
**What goes wrong:** Runtime still works, but users think IntelliSense is broken with no explanation. [VERIFIED: codebase grep] [ASSUMED]
**Why it happens:** The project currently treats Python integration as optional and falls back quietly in `resolvePythonPath`. [VERIFIED: codebase grep]
**How to avoid:** Add a startup warning plus an explicit setup/repair command. [VERIFIED: codebase grep] [ASSUMED]
**Warning signs:** `ms-python.python` or Pylance absent, yet no UI explains why imports are unresolved. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] [ASSUMED]

## Code Examples

Verified patterns from official sources:

### Configure `python.analysis.extraPaths`
```json
// Source: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md
{
  "python.analysis.extraPaths": ["./src", "./lib"]
}
```

### Pyright execution-environment fallback
```json
// Source: https://github.com/microsoft/pyright/blob/main/docs/configuration.md
{
  "executionEnvironments": [
    {
      "root": "src",
      "extraPaths": ["src/backend"]
    }
  ]
}
```

### Virtual-document command gating by scheme
```json
// Source: https://code.visualstudio.com/api/extension-guides/virtual-documents
{
  "menus": {
    "editor/title": [
      {
        "command": "cowsay.backwards",
        "group": "navigation",
        "when": "resourceScheme == cowsay"
      }
    ]
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `python.autoComplete.extraPaths` | `python.analysis.extraPaths` | documented in Pylance migration/troubleshooting docs [CITED: https://github.com/microsoft/pylance-release/blob/main/TROUBLESHOOTING.md] | Phase 9 should target the current Pylance setting, not the retired language-server surface. [CITED: https://github.com/microsoft/pylance-release/blob/main/TROUBLESHOOTING.md] |
| Separate Python language servers | Pylance as default rich language support | current VS Code Python settings reference + marketplace docs [CITED: https://code.visualstudio.com/docs/python/settings-reference] [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] | Plan around Pylance/Pyright first. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] |

**Deprecated/outdated:**
- `python.autoComplete.extraPaths`: replaced by `python.analysis.extraPaths`. [CITED: https://github.com/microsoft/pylance-release/blob/main/TROUBLESHOOTING.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Workspace-level `python.analysis.extraPaths` will likely cover the current temp-file edit/run/debug documents opened in the same VS Code window even though they live in `os.tmpdir()`. [ASSUMED] | Summary / Open Questions | Medium — may require a stronger fallback than workspace settings alone. |
| A2 | Tracking managed entries in `context.globalState` is the safest project-aligned ownership mechanism. [ASSUMED] | Standard Stack / Architecture Patterns | Low — another persistence mechanism could still satisfy D-11/D-13. |
| A3 | If `altium365:` custom-scheme Python docs need parity, the implementation cost is materially higher than temp-file parity and may deserve a documented limitation. [ASSUMED] | Summary / Common Pitfalls | Medium — could affect phase scope split. |

## Planning Resolution for Open Questions

1. **Does current workspace `extraPaths` fully cover the existing temp-file editing path?**
   - Resolution: planning no longer assumes yes. Plan 09-02 now starts with a blocking live-proof checkpoint before activation wiring proceeds. The implementation branch is selected from that proof result instead of leaving the dependency unresolved.

2. **Is true `altium365:` Python virtual-document parity needed at all for this phase’s highest-value path?**
   - Resolution: no for primary success. Per D-04 and the codebase evidence, Phase 9 treats workspace-backed files plus current temp-file edit/debug flows as the required path. Legacy `altium365:` Python-document parity remains best-effort and must be documented as a limitation if not validated quickly.

3. **Should the fallback be `pyrightconfig.json`, path relocation, or an explicit limitation?**
   - Resolution: if the 09-02 proof shows orphan temp files do not inherit workspace `python.analysis.extraPaths`, the preselected fallback is an Altium-managed `pyrightconfig.json` scoped to the existing `os.tmpdir()/altium365/...` script root, refreshed and removed alongside the managed helper-path state. Path relocation is not needed for this phase, and explicit limitation remains only for legacy `altium365:` virtual Python documents.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Extension build/test loop | ✓ [VERIFIED: shell probe] | `v22.16.0` [VERIFIED: shell probe] | — |
| npm | Compile/package workflow | ✓ [VERIFIED: shell probe] | `10.9.2` [VERIFIED: shell probe] | — |
| Python 3 | Runtime helper path and manual validation | ✓ [VERIFIED: shell probe] | `3.13.7` [VERIFIED: shell probe] | — |
| `code` CLI | Fast local VS Code/UAT automation | ✗ [VERIFIED: shell probe] | — | Manual VS Code UI validation. [ASSUMED] |
| `ctx7` CLI | Context7 fallback docs lookup | ✗ [VERIFIED: shell probe] | — | `webfetch`/official docs used in this research. [VERIFIED: shell probe] |
| Python extension / Pylance extension | Editor IntelliSense feature itself | Unknown at research time [ASSUMED] | not probed from shell [ASSUMED] | Startup warning + explicit setup command. [ASSUMED] |

**Missing dependencies with no fallback:**
- None identified for planning itself. [VERIFIED: shell probe]

**Missing dependencies with fallback:**
- `code` CLI missing; use manual VS Code validation steps in the plan. [VERIFIED: shell probe]
- Context7 CLI missing; official web docs were sufficient for research. [VERIFIED: shell probe]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no [ASSUMED] | No auth flow change in this phase. [VERIFIED: codebase grep] |
| V3 Session Management | no [ASSUMED] | No token/session logic should be touched. [VERIFIED: codebase grep] |
| V4 Access Control | no [ASSUMED] | Feature is local editor configuration management, not permission enforcement. [ASSUMED] |
| V5 Input Validation | yes [ASSUMED] | Normalize/validate candidate paths before writing or removing settings entries. [ASSUMED] |
| V6 Cryptography | no [ASSUMED] | No crypto changes required. [ASSUMED] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User-setting clobber | Tampering | Remove only the last known extension-owned paths; preserve all other `extraPaths` entries verbatim. [ASSUMED] |
| Path spoofing / bad path injection | Tampering | Normalize paths and only manage the exact extension-derived helper roots. [VERIFIED: codebase grep] [ASSUMED] |
| Silent capability downgrade when tooling is missing | Denial of Service | Show startup warning and expose explicit repair/setup command. [ASSUMED] |
| Drift after extension update changes install path | Tampering | Reconcile on activation using current canonical paths and previous managed set. [VERIFIED: codebase grep] [ASSUMED] |

## Sources

### Primary (HIGH confidence)
- `src/extension.ts`, `src/sandboxDeps.ts`, `src/scriptCommands.ts`, `src/remoteScriptFs.ts`, `src/testEvents/eventFs.ts`, `package.json` — current runtime path order, optional Python integration, temp-file editing flow, legacy virtual schemes, and `injectHelper` setting. [VERIFIED: codebase grep]
- https://code.visualstudio.com/docs/python/settings-reference — official Python/Pylance setting definitions, including `python.analysis.extraPaths`. [CITED: https://code.visualstudio.com/docs/python/settings-reference]
- https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance — official Pylance positioning, dependency relationship, and feature scope. [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance]
- https://github.com/microsoft/pyright/blob/main/docs/configuration.md — official Pyright config, `extraPaths`, and execution-environment behavior. [CITED: https://github.com/microsoft/pyright/blob/main/docs/configuration.md]
- https://github.com/microsoft/pyright/blob/main/docs/import-resolution.md — official Pyright import-resolution order. [CITED: https://github.com/microsoft/pyright/blob/main/docs/import-resolution.md]

### Secondary (MEDIUM confidence)
- https://code.visualstudio.com/docs/python/environments#_env-file-support — official `.env` behavior and current Python-environments limitations. [CITED: https://code.visualstudio.com/docs/python/environments#_env-file-support]
- https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md — Pylance deep-dive for `extraPaths`, including path-root gotchas and the static-analysis-only distinction. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md]
- https://github.com/microsoft/pylance-release/blob/main/TROUBLESHOOTING.md — current unresolved-import guidance and deprecated setting migration. [CITED: https://github.com/microsoft/pylance-release/blob/main/TROUBLESHOOTING.md]

### Tertiary (LOW confidence)
- No web-search-only sources were required. [VERIFIED: research session]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - the primary knobs (`python.analysis.extraPaths`, Pyright config, optional Pylance relationship) are explicitly documented and match the current codebase seams. [CITED: https://code.visualstudio.com/docs/python/settings-reference] [CITED: https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance] [VERIFIED: codebase grep]
- Architecture: MEDIUM - the codebase flow is clear, but custom-scheme parity beyond temp files is not fully documented by upstream tooling. [VERIFIED: codebase grep] [CITED: https://code.visualstudio.com/api/extension-guides/virtual-documents] [ASSUMED]
- Pitfalls: MEDIUM - import-root and settings-clobber risks are well-grounded, but temp-file/orphan-file behavior still needs manual UAT. [CITED: https://github.com/microsoft/pylance-release/blob/main/docs/settings/python_analysis_extraPaths.md] [ASSUMED]

**Research date:** 2026-05-26
**Valid until:** 2026-06-25
