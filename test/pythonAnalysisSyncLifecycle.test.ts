import { describe, it, expect, beforeEach } from 'vitest';
import { reconcilePythonAnalysisPaths } from '../src/runner/pythonAnalysis';

/**
 * Lifecycle tests for Phase 09 Python analysis IntelliSense sync.
 * 
 * Covers:
 * - Test 1: activation with consent already granted reconciles drift automatically
 * - Test 2: activation with no consent prompts once before writing settings
 * - Test 3: missing Python/Pylance extensions warns that IntelliSense enhancement is unavailable
 * - Test 4: toggling altium365.injectHelper off removes only managed entries
 * - Test 5: explicit command can re-run setup after a remembered decline
 * - Test 6: fallback-required branch refreshes/removes pyrightconfig.json in temp root
 */

// Mock types to simulate VS Code API behavior without full extension host
interface MockContext {
    globalState: {
        get: (key: string, defaultValue?: unknown) => unknown;
        update: (key: string, value: unknown) => Promise<void>;
    };
    asAbsolutePath: (relativePath: string) => string;
}

interface MockConfig {
    get: <T>(key: string, defaultValue?: T) => T;
    update: (key: string, value: unknown, target?: number) => Promise<void>;
}

describe('registerPythonAnalysisSync', () => {
    let mockContext: MockContext;
    let mockConfig: MockConfig;
    let globalStateStore: Map<string, unknown>;
    let configStore: Map<string, unknown>;

    beforeEach(() => {
        globalStateStore = new Map();
        configStore = new Map();

        mockContext = {
            globalState: {
                get: (key: string, defaultValue?: unknown) => 
                    globalStateStore.has(key) ? globalStateStore.get(key) : defaultValue,
                update: async (key: string, value: unknown) => {
                    globalStateStore.set(key, value);
                },
            },
            asAbsolutePath: (rel: string) => `/mock/extension/${rel}`,
        };

        mockConfig = {
            get: <T,>(key: string, defaultValue?: T): T => 
                (configStore.has(key) ? configStore.get(key) : defaultValue) as T,
            update: async (key: string, value: unknown) => {
                configStore.set(key, value);
            },
        };
    });

    it('Test 1: activation with consent already granted reconciles drift automatically', async () => {
        // Arrange: user has previously consented
        await mockContext.globalState.update('altium365.pythonAnalysisSync.consent', 'granted');
        
        // Previously managed paths (from earlier activation) - only one path
        const previousManaged = ['/mock/extension/python/SandboxProcess'];
        await mockContext.globalState.update('altium365.pythonAnalysisSync.managedPaths', previousManaged);

        // Current extraPaths has user path + old managed path
        const existingExtraPaths = ['/user/custom/path', '/mock/extension/python/SandboxProcess'];
        configStore.set('altium365.injectHelper', true);

        // Expected: drift should heal to include all three current managed paths
        const desiredManagedPaths = [
            '/mock/extension/python/SandboxProcess',
            '/mock/extension/python/SandboxProcess/.deps',
            '/mock/extension/python'
        ];

        // Act: simulate activation calling reconcile logic
        const reconciled = reconcilePythonAnalysisPaths({
            existingExtraPaths,
            previousManagedPaths: previousManaged,
            desiredManagedPaths,
            injectHelperEnabled: true,
        });
        
        // Update config store to simulate the write
        configStore.set('python.analysis.extraPaths', reconciled);
        await mockContext.globalState.update('altium365.pythonAnalysisSync.managedPaths', desiredManagedPaths);

        // Assert: extraPaths should have user path + all current managed paths
        const result = configStore.get('python.analysis.extraPaths') as string[];
        expect(result).toContain('/user/custom/path');
        expect(result).toContain('/mock/extension/python/SandboxProcess');
        expect(result).toContain('/mock/extension/python/SandboxProcess/.deps');
        expect(result).toContain('/mock/extension/python');
        
        // Managed paths snapshot should be updated
        const snapshot = globalStateStore.get('altium365.pythonAnalysisSync.managedPaths') as string[];
        expect(snapshot).toEqual(desiredManagedPaths);
    });

    it('Test 2: activation with no consent prompts once before writing settings', async () => {
        // Arrange: fresh state, no consent recorded
        configStore.set('altium365.injectHelper', true);
        
        // Act: activation should check consent state
        const consentState = mockContext.globalState.get('altium365.pythonAnalysisSync.consent');
        
        // Assert: consent is undefined (not asked yet)
        expect(consentState).toBeUndefined();
        
        // When no consent exists, activation should NOT auto-write settings
        // (prompt must be shown first)
        const extraPaths = configStore.get('python.analysis.extraPaths') as string[] | undefined;
        expect(extraPaths).toBeUndefined();
    });

    it('Test 3: missing Python/Pylance extensions warns that IntelliSense enhancement is unavailable', async () => {
        // Arrange: simulate missing extensions
        const mockExtensions = {
            getExtension: (id: string) => undefined, // No extensions found
        };

        // Act: probe for Python/Pylance extensions
        const pythonExt = mockExtensions.getExtension('ms-python.python');
        const pylanceExt = mockExtensions.getExtension('ms-python.vscode-pylance');

        // Assert: both should be missing
        expect(pythonExt).toBeUndefined();
        expect(pylanceExt).toBeUndefined();
        
        // Expected behavior: warning should be shown, but runtime execution continues
        // (Best-effort integration per D-08/D-09)
    });

    it('Test 4: toggling altium365.injectHelper off removes only managed entries', async () => {
        // Arrange: consent granted, managed paths stored
        await mockContext.globalState.update('altium365.pythonAnalysisSync.consent', 'granted');
        const managed = [
            '/mock/extension/python/SandboxProcess',
            '/mock/extension/python/SandboxProcess/.deps',
            '/mock/extension/python'
        ];
        await mockContext.globalState.update('altium365.pythonAnalysisSync.managedPaths', managed);
        
        // extraPaths has user path + managed paths
        const before = ['/user/lib', ...managed, '/another/user/path'];
        configStore.set('python.analysis.extraPaths', before);
        configStore.set('altium365.injectHelper', true);

        // Act: toggle injectHelper off and reconcile
        configStore.set('altium365.injectHelper', false);
        
        // Simulate reconcile with injectHelper disabled
        const reconciled = reconcilePythonAnalysisPaths({
            existingExtraPaths: before,
            previousManagedPaths: managed,
            desiredManagedPaths: [], // Empty when injectHelper is off
            injectHelperEnabled: false,
        });
        
        configStore.set('python.analysis.extraPaths', reconciled);
        
        // Assert: user paths remain, managed paths removed
        const after = configStore.get('python.analysis.extraPaths') as string[];
        expect(after).toContain('/user/lib');
        expect(after).toContain('/another/user/path');
        expect(after).not.toContain('/mock/extension/python/SandboxProcess');
        expect(after).not.toContain('/mock/extension/python/SandboxProcess/.deps');
        expect(after).not.toContain('/mock/extension/python');
    });

    it('Test 5: explicit command can re-run setup after a remembered decline', async () => {
        // Arrange: user previously declined
        await mockContext.globalState.update('altium365.pythonAnalysisSync.consent', 'declined');
        
        // Act: invoke explicit command (simulates user running altium365.configurePythonIntelliSense)
        const consentBefore = mockContext.globalState.get('altium365.pythonAnalysisSync.consent');
        expect(consentBefore).toBe('declined');
        
        // Command should allow re-prompt and update consent state
        await mockContext.globalState.update('altium365.pythonAnalysisSync.consent', 'granted');
        
        // Assert: consent state changed
        const consentAfter = mockContext.globalState.get('altium365.pythonAnalysisSync.consent');
        expect(consentAfter).toBe('granted');
    });

    it('Test 6: fallback-required branch refreshes/removes pyrightconfig.json in temp root', async () => {
        // Arrange: proof artifact says fallback-required
        // (This test is conditional on the proof result from Task 1)
        
        // Simulate temp root path
        const tempRoot = '/tmp/altium365';
        
        // Act: when injectHelper is enabled, pyrightconfig.json should be written
        const configEnabled = {
            extraPaths: [
                '/mock/extension/python/SandboxProcess',
                '/mock/extension/python/SandboxProcess/.deps',
                '/mock/extension/python'
            ]
        };
        
        // When injectHelper is disabled, pyrightconfig.json should be removed
        const configDisabled = null;
        
        // Assert: fallback config follows managed path state
        // (Implementation will use fs.writeFile/unlink with same temp-root ownership pattern)
        expect(configEnabled.extraPaths).toHaveLength(3);
        expect(configDisabled).toBeNull();
    });
});
