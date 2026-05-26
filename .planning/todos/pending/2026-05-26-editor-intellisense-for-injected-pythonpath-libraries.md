---
created: 2026-05-26 13:28:18
title: Editor IntelliSense for injected PYTHONPATH libraries
area: tooling
files:
  - src/extension.ts:894-903 (run/debug-time PYTHONPATH injection)
  - src/sandboxDeps.ts:210-211 (getSandboxPythonPath)
---

## Problem

`src/extension.ts:894-903` (run path) and `src/sandboxDeps.ts` only prepend our sandbox paths (`SandboxProcess/`, `SandboxProcess/.deps/`, `pythonDir/`) to **`env.PYTHONPATH` of the spawned Python subprocess**. The VS Code Python language server (Pylance / ms-python) running against the editor for the same `.py` file has no knowledge of these paths, so:

- `import altium`, `import altium_api`, `import gql`, `import requests` show "unresolved import" squiggles
- Autocomplete, go-to-definition, hover docs, and signature help do **not** work for any helper module shipped inside the extension
- Users see broken IntelliSense for every A365 script they open from the remote FS, the tmp debug file, or any standalone `.py` they intend to run through us

This is a major DX gap — the user explicitly called it out as crucial. The editor's understanding must match the runtime's understanding.

## Solution

Bridge the runtime PYTHONPATH into the editor's analysis path. Two layers needed:

1. **`python.analysis.extraPaths` workspace setting** — Pylance's documented hook for "additional import resolution roots". On activation (and whenever `altium365.injectHelper` toggles or the extension is updated), update the workspace-level `python.analysis.extraPaths` to include exactly the same chunks we prepend to `PYTHONPATH` at run time. Use `vscode.workspace.getConfiguration('python.analysis').update('extraPaths', [...], ConfigurationTarget.Workspace)`. Read existing entries first and merge — don't clobber user values.

2. **Generate a `.env` / `pyrightconfig.json` for opened remote scripts** — for the `altium365-script://` virtual FS and tmp-file edit paths, the workspace `extraPaths` may not apply because the file lives outside the workspace root. Investigate writing a `pyrightconfig.json` adjacent to the tmp file (or use `python.envFile` pointing at a generated `.env` with `PYTHONPATH=...`) so single-file editing also resolves imports.

**Investigation needed before planning:**
- Does Pylance pick up `python.analysis.extraPaths` for files opened from a non-workspace virtual FS (`altium365-script://`, `altium365-event://`)? If not, single-file mode requires the per-file pyrightconfig approach.
- Does ms-python.python need to be a hard `extensionDependency` in `package.json`, or is checking presence at runtime good enough?
- Should we offer a one-time prompt on first activation: "Altium Developer wants to add SandboxProcess paths to python.analysis.extraPaths — Allow / Skip / Don't ask again"? Modifying workspace settings without consent is intrusive.
- Interaction with `altium365.injectHelper` setting: when user disables injection, also remove our paths from `python.analysis.extraPaths`.

**Acceptance criteria:**
- Opening a `.py` script that uses `import altium` shows no unresolved-import squiggle
- Autocomplete after `altium.` lists members from the actual module
- Hover on `altium.foo` shows docstring
- Works for: remote-FS scripts, tmp-file debug scripts, and standalone `.py` files in the workspace
- Toggling `altium365.injectHelper` updates editor and runtime consistently
- No silent clobbering of user-defined `python.analysis.extraPaths` entries

Likely a new phase (estimate: small-to-medium — 2–3 plans: workspace-settings sync, virtual-FS handling, UAT/polish).
