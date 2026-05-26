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
