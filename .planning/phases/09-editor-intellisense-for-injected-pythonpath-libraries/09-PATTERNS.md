# Phase 9: Editor IntelliSense for injected PYTHONPATH libraries - Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 7
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/sandboxDeps.ts` | utility | transform | `src/sandboxDeps.ts` | exact |
| `src/pythonAnalysisSync.ts` | utility | transform | `src/updater.ts` | role-match |
| `test/pythonAnalysisSync.test.ts` | test | transform | `test/compareVersions.test.ts` | role-match |
| `src/extension.ts` | provider | event-driven | `src/extension.ts` | exact |
| `src/scriptCommands.ts` | controller | file-I/O | `src/scriptCommands.ts` | exact |
| `package.json` | config | event-driven | `package.json` | exact |
| `test/pythonAnalysisSyncLifecycle.test.ts` | test | event-driven | `test/compareVersions.test.ts` | role-match |

## Pattern Assignments

### `src/sandboxDeps.ts` (utility, transform)

**Analog:** `src/sandboxDeps.ts`

**Canonical-path helper pattern** — `src/sandboxDeps.ts:36-46,216-218`
```typescript
export function getSandboxDir(context: vscode.ExtensionContext): string {
    return context.asAbsolutePath(path.join('python', 'SandboxProcess'));
}

export function getSandboxDepsDir(context: vscode.ExtensionContext): string {
    return path.join(getSandboxDir(context), '.deps');
}

export function getSandboxPythonPath(context: vscode.ExtensionContext): string[] {
    return [getSandboxDir(context), getSandboxDepsDir(context)];
}
```

**Guarded error-return pattern** — `src/sandboxDeps.ts:82-100`
```typescript
export async function ensureSandboxDeps(...): Promise<boolean> {
    const reqPath = getRequirementsPath(context);
    if (!fs.existsSync(reqPath)) {
        vscode.window.showErrorMessage(
            'Altium 365: requirements.txt missing under python/SandboxProcess/. The extension install may be corrupt.'
        );
        return false;
    }
    const depsDir = getSandboxDepsDir(context);
    const currentHash = hashRequirements(reqPath);
    const marker = readMarker(depsDir);
    if (!force && marker && marker.requirementsSha256 === currentHash) {
        return true;
    }
```

**Apply to Phase 9:** keep `getManagedPythonAnalysisPaths(context)` adjacent to these helpers and derive editor paths from the same primitives.

---

### `src/pythonAnalysisSync.ts` (utility, transform)

**Primary analog:** `src/updater.ts`

**Imports pattern** — `src/updater.ts:1-7`
```typescript
import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import { compareVersions } from './semverCompare';
```

**Registration/factory pattern** — `src/updater.ts:43-61`
```typescript
export function registerUpdater(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): vscode.Disposable[] {
    const enabled = vscode.workspace
        .getConfiguration('altium365')
        .get<boolean>('checkForUpdates', false);
    if (enabled) {
        void runCheck(context, output, { manual: false });
    } else {
        output.appendLine(`${LOG_PREFIX} auto check disabled via altium365.checkForUpdates setting`);
    }

    return [
        vscode.commands.registerCommand('altium365.checkForUpdates', async () => {
            await runCheck(context, output, { manual: true });
        }),
    ];
}
```

**Global-state bookkeeping pattern** — `src/updater.ts:85-127`
```typescript
if (!opts.manual) {
    const last = context.globalState.get<number>(GLOBAL_LAST_CHECK_KEY, 0);
    const elapsed = Date.now() - last;
    if (last > 0 && elapsed < DEBOUNCE_MS) {
        const hours = Math.round(elapsed / (60 * 60 * 1000));
        output.appendLine(`${LOG_PREFIX} debounced — last check ${hours}h ago`);
        return;
    }
}

await context.globalState.update(GLOBAL_LAST_CHECK_KEY, Date.now());
```

**User-prompt pattern** — `src/updater.ts:211-219`
```typescript
const choice = await vscode.window.showInformationMessage(
    `Altium 365: v${latest} available`,
    'Update Now',
    'Later',
);
if (choice !== 'Update Now') {
    output.appendLine(`${LOG_PREFIX} user dismissed update prompt (choice=${choice ?? 'dismissed'})`);
    return;
}
```

**Supplemental decline-marker analog** — `src/testEvents/importSibling.ts:27-53`
```typescript
const markerKey = IMPORT_MARKER_PREFIX + identity;
const existingMarker = ctx.globalState.get<string>(markerKey);
if (existingMarker) {
    return;
}

const choice = await vscode.window.showInformationMessage(
    `Found ${path.basename(sibling)} next to this script. Import as a test event?`,
    { modal: false },
    'Import',
    'Not now',
    'Never for this file',
);

if (choice === 'Never for this file') {
    await ctx.globalState.update(markerKey, DECLINED_MARKER);
    output.appendLine(`[Altium 365] testEvents.importSibling: user declined import of ${sibling}`);
    return;
}
```

**Apply to Phase 9:** implement `registerPythonAnalysisSync(context, output)` as a small named-export module that owns consent keys, command wiring, and drift-heal logging.

---

### `test/pythonAnalysisSync.test.ts` (test, transform)

**Primary analog:** `test/compareVersions.test.ts`

**Vitest structure pattern** — `test/compareVersions.test.ts:1-35`
```typescript
import { describe, it, expect } from 'vitest';
import { compareVersions, parseVersion } from '../src/semverCompare';

describe('compareVersions', () => {
    it('normal > pre-release of same base', () => {
        expect(compareVersions('0.1.0', '0.1.0-ci.42')).toBeGreaterThan(0);
        expect(compareVersions('0.1.0-ci.42', '0.1.0')).toBeLessThan(0);
    });
});
```

**Scenario-per-assertion style** — `test/dedupLogPage.test.ts:4-34`
```typescript
describe('dedupLogPage', () => {
    it('second page repeats prefix + adds 2 new → only the new tail emitted', () => {
        const r = dedupLogPage(['a', 'b', 'c', 'd', 'e'], 3);
        expect(r.fresh).toEqual(['d', 'e']);
        expect(r.newPrintedCount).toBe(5);
    });
});
```

**Apply to Phase 9:** keep the reconciliation tests pure, direct, and table-free; assert canonical order, preserve-user-path behavior, and managed-only cleanup with plain `describe`/`it` blocks.

---

### `src/extension.ts` (provider, event-driven)

**Analog:** `src/extension.ts`

**Imports + module wiring pattern** — `src/extension.ts:20-30`
```typescript
import { registerScriptCommands } from './scriptCommands';
import { registerTreeCommands } from './treeCommands';
import { AltiumRemoteScriptFs } from './remoteScriptFs';
import { ensureSandboxDeps, getSandboxPythonPath } from './sandboxDeps';
import { registerLocalScriptSaveBridge, getLocalScript, rehydrateLocalScriptCacheFromDisk } from './localScriptCache';
import { registerTestEventCommands } from './testEvents/commands';
import { registerTestEventStatusItem } from './testEvents/statusItem';
import { registerUpdater } from './updater';
```

**Activation registration pattern** — `src/extension.ts:114-181`
```typescript
const scriptCommandDisposables = registerScriptCommands(context, outputChannel);
const treeCommandDisposables = registerTreeCommands(context, outputChannel);
const testEventCommandDisposables = registerTestEventCommands(context, outputChannel);
const testEventStatusDisposables = registerTestEventStatusItem(context);
const localScriptSaveBridge = registerLocalScriptSaveBridge(outputChannel, remoteFs);
const updaterDisposables = registerUpdater(context, outputChannel);

context.subscriptions.push(
    ...scriptCommandDisposables,
    ...treeCommandDisposables,
    ...testEventCommandDisposables,
    ...testEventStatusDisposables,
    localScriptSaveBridge,
    ...updaterDisposables
);
```

**Configuration-listener pattern** — `src/extension.ts:164-171`
```typescript
vscode.workspace.onDidChangeConfiguration((e) => {
    if (
        e.affectsConfiguration('altium365.activeEnvironment') ||
        e.affectsConfiguration('altium365.environments')
    ) {
        applyTreeTitle();
    }
}),
```

**Optional Python-extension probe pattern** — `src/extension.ts:561-589`
```typescript
async function resolvePythonPath(): Promise<string> {
    const cfg = vscode.workspace.getConfiguration('altium365');
    const configured = (cfg.get<string>('pythonPath') || '').trim();
    if (configured) {
        return configured;
    }
    try {
        const pyExt = vscode.extensions.getExtension('ms-python.python');
        if (pyExt) {
            if (!pyExt.isActive) {
                await pyExt.activate();
            }
            const api: any = pyExt.exports;
            const resource = vscode.window.activeTextEditor?.document.uri;
            const details = api?.environments?.getActiveEnvironmentPath?.(resource);
            if (details?.path) {
                return details.path;
            }
        }
    } catch {
        // fall through
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}
```

**Runtime source-of-truth path usage** — `src/extension.ts:900-905`
```typescript
if (injectHelper) {
    const sep = process.platform === 'win32' ? ';' : ':';
    const sandboxPaths = getSandboxPythonPath(context);
    const prefix = [...sandboxPaths, pythonDir].join(sep);
    env.PYTHONPATH = env.PYTHONPATH ? `${prefix}${sep}${env.PYTHONPATH}` : prefix;
}
```

**Apply to Phase 9:** wire `registerPythonAnalysisSync(context, outputChannel)` exactly like the other register* helpers and keep config-change reconciliation inside `activate()` subscriptions.

---

### `src/scriptCommands.ts` (controller, file-I/O)

**Primary analog:** `src/scriptCommands.ts`

**Why this analog:** Plan 09-02 extends the existing remote temp-file flow, so the right pattern is the current command-boundary tmpdir pipeline in this same file.

**Imports pattern** — `src/scriptCommands.ts:1-16`
```typescript
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { A365Node } from './sidePanel';
import { getSelectedWorkspace } from './workspace';
import { buildScriptUri, parseScriptUri } from './remoteScriptFs';
import { executeRemoteScript } from './remoteExecution';
import { runScriptAtPath, debugScriptAtPath } from './extension';
import {
    registerLocalScript,
    getLocalScript,
    findLocalScriptByRemoteId,
} from './localScriptCache';
import { withScriptProgress } from './progress';
```

**Command registration pattern** — `src/scriptCommands.ts:42-77`
```typescript
export function registerScriptCommands(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    const getEnvGlobalEndpoint = () =>
        vscode.workspace.getConfiguration('altium365').get<string>('graphqlEndpoint', '');

    return [
        vscode.commands.registerCommand(
            'altium365.script.runLocal',
            (node?: A365Node) => runLocalFromScriptNode(context, output, node)
        ),
        vscode.commands.registerCommand(
            'altium365.script.debugLocal',
            (node?: A365Node) => debugLocalFromScriptNode(context, output, node)
        ),
        vscode.commands.registerCommand(
            'altium365.script.edit',
            (node?: A365Node) => editScript(context, output, node)
        ),
    ];
}
```

**Temp-root file-I/O pattern** — `src/scriptCommands.ts:365-413`
```typescript
return withScriptProgress(
    `${actionLabel}: loading...`,
    async (signal) => {
        let tmpPath: string | undefined;
        try {
            const uri = buildScriptUri(sc.workspaceAuthId, sc.scriptId, sc.scriptName);
            const bytes = await vscode.workspace.fs.readFile(uri);
            const safeBase = sc.scriptName.replace(/[^\w.-]+/g, '_') || 'script';
            const fileName = safeBase.toLowerCase().endsWith('.py')
                ? safeBase
                : `${safeBase}.py`;
            const dir = path.join(
                os.tmpdir(),
                'altium365',
                sc.workspaceAuthId,
                sc.scriptId
            );
            await fs.mkdir(dir, { recursive: true });
            tmpPath = path.join(dir, fileName);
            await fs.writeFile(tmpPath, bytes);
            registerLocalScript(tmpPath, {
                workspaceAuthId: sc.workspaceAuthId,
                scriptId: sc.scriptId,
                scriptName: sc.scriptName,
            });
            output.appendLine(
                `[Altium 365] ${actionLabel}: wrote ${bytes.byteLength} bytes to ${tmpPath}`
            );
            if (signal.aborted) {
                return undefined;
            }
            return tmpPath;
        }
```

**Error + cancellation cleanup pattern** — `src/scriptCommands.ts:414-439`
```typescript
        } catch (e) {
            const err = e as Error & { code?: string };
            const code = (err as { code?: string }).code;
            const userMsg = mapGraphQLErrorToUserMessage(code, err.message);
            output.appendLine(
                `[Altium 365] ${actionLabel} failed: ` +
                    err.message +
                    (code ? ' (code=' + code + ')' : '')
            );
            if (err.stack) {
                output.appendLine(err.stack);
            }
            vscode.window.showErrorMessage('Altium 365: ' + userMsg);
            return undefined;
        }
    } finally {
        if (signal.aborted && tmpPath) {
            try {
                await fs.unlink(tmpPath);
            } catch (e) {
                output.appendLine(
                    `[Altium 365] cancel cleanup: unlink failed: ${(e as Error).message}`
                );
            }
        }
    }
```

**Supplemental temp-root ownership analog:** `src/localScriptCache.ts:95-137`
```typescript
export function rehydrateLocalScriptCacheFromDisk(): number {
    const root = path.join(os.tmpdir(), 'altium365');
    let count = 0;
    let authDirs: fsSync.Dirent[];
    try {
        authDirs = fsSync.readdirSync(root, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const authEntry of authDirs) {
        if (!authEntry.isDirectory()) continue;
        const workspaceAuthId = authEntry.name;
        const authDir = path.join(root, workspaceAuthId);
        ...
    }
    return count;
}
```

**Apply to Phase 9:** if a fallback `pyrightconfig.json` is needed, scope it to the same `os.tmpdir()/altium365/<workspaceAuthId>/<scriptId>/...` ownership model, use `fs/promises` file writes, and keep failure reporting at the command/log boundary instead of throwing raw filesystem errors.

---

### `package.json` (config, event-driven)

**Analog:** `package.json`

**Command contribution pattern** — `package.json:45-163`
```json
{
  "command": "altium365.checkForUpdates",
  "title": "Check for Updates",
  "category": "Altium Developer"
}
```

**Existing Python settings neighborhood** — `package.json:208-222`
```json
"altium365.pythonPath": {
  "type": "string",
  "default": "",
  "description": "Path to the Python interpreter. If empty, the ms-python.python extension or 'python' on PATH will be used."
},
"altium365.extraEnv": {
  "type": "object",
  "default": {},
  "description": "Extra environment variables passed to the Python process."
},
"altium365.injectHelper": {
  "type": "boolean",
  "default": true,
  "description": "Inject the bundled 'a365' helper module on PYTHONPATH so scripts can `import a365`."
}
```

**Menu gating pattern** — `package.json:331-359`
```json
"editor/title": [
  {
    "submenu": "altium365.editorTitle",
    "group": "navigation@1",
    "when": "resourceLangId == python"
  }
],
"altium365.editorTitle": [
  {
    "command": "altium365.script.executeRemote",
    "group": "2_remote@1",
    "when": "resourceLangId == python && altium365.activeIsRemoteScript"
  }
]
```

**Apply to Phase 9:** contribute `altium365.configurePythonIntelliSense` alongside existing commands, and keep `altium365.injectHelper` as the single feature toggle.

---

### `test/pythonAnalysisSyncLifecycle.test.ts` (test, event-driven)

**Primary analog:** `test/compareVersions.test.ts`

**Why this analog:** there is no existing VS Code-host lifecycle test in `test/`; copy the repo’s current concise Vitest style, then adapt it to consent/warning/config-change scenarios.

**Imports + suite structure pattern** — `test/compareVersions.test.ts:1-47`
```typescript
import { describe, it, expect } from 'vitest';
import { compareVersions, parseVersion } from '../src/semverCompare';

describe('compareVersions', () => {
    it('normal > pre-release of same base', () => {
        expect(compareVersions('0.1.0', '0.1.0-ci.42')).toBeGreaterThan(0);
        expect(compareVersions('0.1.0-ci.42', '0.1.0')).toBeLessThan(0);
    });
});
```

**Readable edge-case naming pattern** — `test/dedupLogPage.test.ts:5-33`
```typescript
it('final batch after terminal status: full transcript returned → only un-printed tail emitted', () => {
    const r = dedupLogPage(['a', 'b', 'c', 'd', 'e', 'f'], 4);
    expect(r.fresh).toEqual(['e', 'f']);
    expect(r.newPrintedCount).toBe(6);
});
```

**Behavior source to mirror in assertions:** `src/updater.ts:47-61,85-127,211-219`
```typescript
if (enabled) {
    void runCheck(context, output, { manual: false });
}

const last = context.globalState.get<number>(GLOBAL_LAST_CHECK_KEY, 0);
await context.globalState.update(GLOBAL_LAST_CHECK_KEY, Date.now());

const choice = await vscode.window.showInformationMessage(
    `Altium 365: v${latest} available`,
    'Update Now',
    'Later',
);
```

**Apply to Phase 9:** structure tests as named lifecycle scenarios: consent already granted, first-run decline, explicit re-enable command, missing-tooling warning, config-toggle cleanup, and optional fallback-file refresh/remove.

## Shared Patterns

### Canonical helper-path source
**Source:** `src/sandboxDeps.ts:216-218` + `src/extension.ts:900-905`
**Apply to:** `src/pythonAnalysisSync.ts`, `src/scriptCommands.ts` fallback generation
```typescript
const sandboxPaths = getSandboxPythonPath(context);
const prefix = [...sandboxPaths, pythonDir].join(sep);
```

Mirror runtime order exactly: `SandboxProcess`, then `.deps`, then `python`.

### Best-effort Python tooling integration
**Source:** `src/extension.ts:567-588`
**Apply to:** startup probe, repair command
```typescript
const pyExt = vscode.extensions.getExtension('ms-python.python');
if (pyExt) {
    if (!pyExt.isActive) {
        await pyExt.activate();
    }
    const api: any = pyExt.exports;
    const details = api?.environments?.getActiveEnvironmentPath?.(resource);
    if (details?.path) {
        return details.path;
    }
}
```

Warn when missing; do not block runtime script execution.

### Consent / decline marker in `globalState`
**Source:** `src/testEvents/importSibling.ts:27-53`
**Apply to:** one-time IntelliSense prompt suppression
```typescript
const existingMarker = ctx.globalState.get<string>(markerKey);
if (existingMarker) {
    return;
}
...
await ctx.globalState.update(markerKey, DECLINED_MARKER);
```

### Extension-owned state reconciliation
**Source:** `src/updater.ts:87-127`, `src/testEvents/store.ts:52-59`
**Apply to:** managed `python.analysis.extraPaths` snapshot + drift-heal
```typescript
const last = context.globalState.get<number>(GLOBAL_LAST_CHECK_KEY, 0);
...
await context.globalState.update(GLOBAL_LAST_CHECK_KEY, Date.now());

await ctx.globalState.update(storeKey(identity), store);
```

Persist the last extension-owned path set and reconcile from that snapshot.

### Temp-root ownership and file layout
**Source:** `src/scriptCommands.ts:383-408`, `src/localScriptCache.ts:95-137`
**Apply to:** orphan-temp fallback `pyrightconfig.json` scope
```typescript
const dir = path.join(
    os.tmpdir(),
    'altium365',
    sc.workspaceAuthId,
    sc.scriptId
);
await fs.mkdir(dir, { recursive: true });
tmpPath = path.join(dir, fileName);
await fs.writeFile(tmpPath, bytes);
```

Keep any fallback file Altium-owned and confined to the existing tmp root.

### Activation-site registration
**Source:** `src/extension.ts:114-181`
**Apply to:** `registerPythonAnalysisSync` wiring
```typescript
const updaterDisposables = registerUpdater(context, outputChannel);
...
context.subscriptions.push(
    ...updaterDisposables
);
```

New modules return disposables; `activate()` owns subscription lifetime.

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|---|---|---|---|
| Altium-managed `pyrightconfig.json` writer/remover | config | file-I/O | No existing module manages Python-analysis config files; copy temp-root ownership from `src/scriptCommands.ts` + `src/localScriptCache.ts`, but the config-file content itself is new. |
| True `altium365:` virtual-document IntelliSense parity | provider | event-driven | Existing code opens `altium365:` and `altium365-event:` documents, but no proven Pylance custom-scheme analog exists in-repo. |

## Metadata

**Analog search scope:** `src/*.ts`, `src/testEvents/*.ts`, `test/*.test.ts`, `package.json`, Phase 09 context/research/plan set

**Files scanned:** 15

**Pattern extraction date:** 2026-05-26
