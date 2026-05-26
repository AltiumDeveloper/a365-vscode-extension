/**
 * Python analysis extra-paths reconciliation for Phase 09 editor IntelliSense.
 * 
 * Provides pure reconciliation logic and globalState key constants for
 * consent-aware Python analysis path sync. The extension host (extension.ts)
 * calls `reconcilePythonAnalysisPaths` to compute the next
 * `python.analysis.extraPaths` value while preserving user-owned entries and
 * tracking extension-managed paths separately.
 * 
 * Key constraints (from 09-CONTEXT.md):
 * - D-11: Remove only extension-managed paths; never clobber user paths
 * - D-12: Track ownership via globalState; cleanup is reversible
 * - D-13: Self-heal drift between runtime helper paths and editor paths
 * - D-02: Mirror runtime PYTHONPATH order exactly
 */

/**
 * GlobalState keys for consent and managed-path tracking.
 * 
 * CONSENT_KEY: user's one-time decision (undefined = not asked, 'granted', 'declined')
 * MANAGED_PATHS_KEY: last known extension-owned path set (string[])
 */
export const CONSENT_KEY = 'altium365.pythonAnalysisSync.consent';
export const MANAGED_PATHS_KEY = 'altium365.pythonAnalysisSync.managedPaths';

export interface ReconcileInput {
    /**
     * Current workspace setting value for python.analysis.extraPaths.
     * May contain both user-owned and extension-managed entries.
     */
    existingExtraPaths: string[];
    
    /**
     * Previously stored extension-managed paths from globalState.
     * Empty array if this is the first sync.
     */
    previousManagedPaths: string[];
    
    /**
     * Current desired managed paths from getManagedPythonAnalysisPaths.
     * Empty array when injectHelper is disabled.
     */
    desiredManagedPaths: string[];
    
    /**
     * Current value of altium365.injectHelper setting.
     */
    injectHelperEnabled: boolean;
}

/**
 * Reconcile python.analysis.extraPaths preserving user paths while
 * adding/removing only extension-managed entries.
 * 
 * Algorithm:
 * 1. Remove previousManagedPaths from existingExtraPaths → user paths only
 * 2. If injectHelperEnabled, append desiredManagedPaths
 * 3. Deduplicate final result
 * 
 * @returns New python.analysis.extraPaths array
 */
export function reconcilePythonAnalysisPaths(input: ReconcileInput): string[] {
    const {
        existingExtraPaths,
        previousManagedPaths,
        desiredManagedPaths,
        injectHelperEnabled,
    } = input;

    // Step 1: Remove only extension-managed paths, preserving user entries
    const previousManagedSet = new Set(previousManagedPaths.map(normalizePath));
    const userPaths = existingExtraPaths.filter(
        (p) => !previousManagedSet.has(normalizePath(p))
    );

    // Step 2: Append desired managed paths if enabled
    const combined = injectHelperEnabled
        ? [...userPaths, ...desiredManagedPaths]
        : userPaths;

    // Step 3: Deduplicate (case-insensitive on Windows, case-sensitive elsewhere)
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const p of combined) {
        const normalized = normalizePath(p);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            deduped.push(p);
        }
    }

    return deduped;
}

/**
 * Normalize path for comparison (case-insensitive on Windows).
 * VS Code path normalization uses forward slashes and lowercases on Windows.
 */
function normalizePath(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Snapshot the current managed paths for future reconciliation.
 * Called after successfully updating python.analysis.extraPaths.
 */
export function getManagedPythonAnalysisPathsSnapshot(
    desiredManagedPaths: string[]
): string[] {
    return desiredManagedPaths.slice(); // defensive copy
}

import * as vscode from 'vscode';
import { getManagedPythonAnalysisPaths } from './sandboxDeps';

const LOG_PREFIX = '[Altium 365] pythonAnalysisSync:';

/**
 * Register Python analysis IntelliSense sync lifecycle:
 * - Probe for Python/Pylance extensions (warn if missing)
 * - Check consent state (prompt once if never asked)
 * - Reconcile python.analysis.extraPaths on activation + config changes
 * - Expose explicit setup/disable command
 * - Manage pyrightconfig.json fallback for temp files (if proof requires it)
 * 
 * Per D-05/D-06/D-13: consent-gated, reversible, drift-healing.
 * Per D-08/D-09: best-effort (runtime continues if Python tooling missing).
 */
export function registerPythonAnalysisSync(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    // Probe for Python/Pylance extensions
    const pythonExt = vscode.extensions.getExtension('ms-python.python');
    const pylanceExt = vscode.extensions.getExtension('ms-python.vscode-pylance');

    if (!pythonExt || !pylanceExt) {
        // D-09: proactive warning when tooling is missing
        output.appendLine(
            `${LOG_PREFIX} Python or Pylance extension not found. ` +
                'Helper IntelliSense setup requires both extensions. ' +
                'Runtime script execution is unaffected.'
        );
        vscode.window.showWarningMessage(
            'Altium Developer: Python/Pylance extensions not detected. ' +
                'Helper IntelliSense enhancement unavailable, but script execution still works.',
            { modal: false }
        );
    }

    // Check consent state and maybe prompt
    const consent = context.globalState.get<string>(CONSENT_KEY);
    const injectHelper = vscode.workspace
        .getConfiguration('altium365')
        .get<boolean>('injectHelper', true);

    if (consent === undefined && injectHelper && pythonExt && pylanceExt) {
        // D-05: one-time prompt before first managed write
        void promptForConsent(context, output);
    } else if (consent === 'granted' && injectHelper) {
        // D-13: self-heal drift on activation
        void reconcileNow(context, output);
    }

    // Register command for explicit enable/disable/repair
    const commandDisposable = vscode.commands.registerCommand(
        'altium365.configurePythonIntelliSense',
        async () => {
            await runExplicitSetup(context, output);
        }
    );

    // Listen for injectHelper config changes
    const configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('altium365.injectHelper')) {
            const consent = context.globalState.get<string>(CONSENT_KEY);
            if (consent === 'granted') {
                // D-13: reconcile on config change
                await reconcileNow(context, output);
            }
        }
    });

    return [commandDisposable, configListener];
}

/**
 * Prompt user for one-time consent before managing python.analysis.extraPaths.
 * Per D-05: never auto-write without explicit permission.
 * Per D-06: remember decline to avoid re-prompting automatically.
 */
async function promptForConsent(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
        'Altium Developer can sync helper import paths to VS Code Python IntelliSense ' +
            'so `import altium` and `import gql` resolve in the editor. ' +
            'This updates your workspace python.analysis.extraPaths setting.',
        { modal: false },
        'Enable',
        'Not Now',
        'Never'
    );

    if (choice === 'Enable') {
        await context.globalState.update(CONSENT_KEY, 'granted');
        output.appendLine(`${LOG_PREFIX} user granted consent`);
        await reconcileNow(context, output);
    } else if (choice === 'Never') {
        await context.globalState.update(CONSENT_KEY, 'declined');
        output.appendLine(`${LOG_PREFIX} user declined consent (will not auto-prompt again)`);
    } else {
        output.appendLine(`${LOG_PREFIX} user dismissed consent prompt (not now)`);
    }
}

/**
 * Explicit command handler for setup/disable/repair.
 * Per D-07: allows re-enable after decline, or manual repair.
 */
async function runExplicitSetup(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): Promise<void> {
    const consent = context.globalState.get<string>(CONSENT_KEY);
    const injectHelper = vscode.workspace
        .getConfiguration('altium365')
        .get<boolean>('injectHelper', true);

    if (!injectHelper) {
        vscode.window.showInformationMessage(
            'Altium Developer: altium365.injectHelper is disabled. ' +
                'Enable it first to sync helper paths to Python IntelliSense.'
        );
        return;
    }

    if (consent === 'granted') {
        // Already enabled, offer repair
        const choice = await vscode.window.showInformationMessage(
            'Python IntelliSense sync is already enabled. Run repair?',
            'Repair',
            'Disable',
            'Cancel'
        );

        if (choice === 'Repair') {
            output.appendLine(`${LOG_PREFIX} explicit repair requested`);
            await reconcileNow(context, output);
            vscode.window.showInformationMessage(
                'Altium Developer: Python IntelliSense paths repaired.'
            );
        } else if (choice === 'Disable') {
            await context.globalState.update(CONSENT_KEY, 'declined');
            output.appendLine(`${LOG_PREFIX} user disabled via explicit command`);
            await reconcileNow(context, output); // Cleanup managed paths
            vscode.window.showInformationMessage(
                'Altium Developer: Python IntelliSense sync disabled.'
            );
        }
    } else {
        // Not enabled, offer to enable (allows re-enable after decline)
        const choice = await vscode.window.showInformationMessage(
            'Enable Python IntelliSense sync for helper imports?',
            'Enable',
            'Cancel'
        );

        if (choice === 'Enable') {
            await context.globalState.update(CONSENT_KEY, 'granted');
            output.appendLine(`${LOG_PREFIX} user enabled via explicit command`);
            await reconcileNow(context, output);
            vscode.window.showInformationMessage(
                'Altium Developer: Python IntelliSense sync enabled.'
            );
        }
    }
}

/**
 * Reconcile python.analysis.extraPaths now.
 * Uses the pure reconciliation logic to preserve user paths while
 * managing extension-owned entries based on current consent + injectHelper state.
 */
async function reconcileNow(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): Promise<void> {
    const config = vscode.workspace.getConfiguration('python.analysis');
    const injectHelper = vscode.workspace
        .getConfiguration('altium365')
        .get<boolean>('injectHelper', true);

    const existingExtraPaths = config.get<string[]>('extraPaths', []);
    const previousManagedPaths = context.globalState.get<string[]>(MANAGED_PATHS_KEY, []);
    const desiredManagedPaths = injectHelper ? getManagedPythonAnalysisPaths(context) : [];

    const reconciled = reconcilePythonAnalysisPaths({
        existingExtraPaths,
        previousManagedPaths,
        desiredManagedPaths,
        injectHelperEnabled: injectHelper,
    });

    // Update workspace config
    await config.update('extraPaths', reconciled, vscode.ConfigurationTarget.Workspace);

    // Update managed paths snapshot
    const snapshot = getManagedPythonAnalysisPathsSnapshot(desiredManagedPaths);
    await context.globalState.update(MANAGED_PATHS_KEY, snapshot);

    output.appendLine(
        `${LOG_PREFIX} reconciled extraPaths (${reconciled.length} total, ` +
            `${desiredManagedPaths.length} managed)`
    );

    // D-03/D-04: fallback pyrightconfig.json for temp files (if proof requires it)
    await reconcilePyrightConfigFallback(context, output, injectHelper, desiredManagedPaths);
}

/**
 * Manage pyrightconfig.json fallback in temp root for orphan temp-file editors.
 * Per Task 1 proof: fallback-required (workspace extraPaths insufficient for temp files).
 * Per D-04: scoped to current temp-file flow only, not legacy altium365: virtual docs.
 */
async function reconcilePyrightConfigFallback(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    injectHelperEnabled: boolean,
    desiredManagedPaths: string[]
): Promise<void> {
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    // Temp root for remote scripts (from scriptCommands.ts pattern)
    const tempRoot = path.join(os.tmpdir(), 'altium365');
    const configPath = path.join(tempRoot, 'pyrightconfig.json');

    if (injectHelperEnabled && desiredManagedPaths.length > 0) {
        // Refresh pyrightconfig.json with current managed paths
        const config = {
            extraPaths: desiredManagedPaths,
        };

        try {
            await fs.mkdir(tempRoot, { recursive: true });
            await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
            output.appendLine(`${LOG_PREFIX} wrote pyrightconfig.json fallback to ${configPath}`);
        } catch (e) {
            output.appendLine(
                `${LOG_PREFIX} failed to write pyrightconfig.json: ${(e as Error).message}`
            );
        }
    } else {
        // Remove pyrightconfig.json (injectHelper disabled or no paths)
        try {
            await fs.unlink(configPath);
            output.appendLine(`${LOG_PREFIX} removed pyrightconfig.json fallback from ${configPath}`);
        } catch (e) {
            const err = e as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
                output.appendLine(
                    `${LOG_PREFIX} failed to remove pyrightconfig.json: ${err.message}`
                );
            }
        }
    }
}
