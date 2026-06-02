import { describe, it, expect } from 'vitest';
import { getManagedPythonAnalysisPaths } from '../../src/runner/sandbox';
import * as path from 'path';

// Mock VS Code extension context for testing
const createMockContext = (basePath: string) => ({
    asAbsolutePath: (p: string) => path.join(basePath, p),
}) as any;

describe('getManagedPythonAnalysisPaths', () => {
    it('returns paths in canonical order: SandboxProcess, SandboxProcess/.deps, python', () => {
        const mockContext = createMockContext('/test/extension');
        const paths = getManagedPythonAnalysisPaths(mockContext);
        
        expect(paths).toHaveLength(3);
        expect(paths[0]).toBe(path.join('/test/extension', 'python', 'SandboxProcess'));
        expect(paths[1]).toBe(path.join('/test/extension', 'python', 'SandboxProcess', '.deps'));
        expect(paths[2]).toBe(path.join('/test/extension', 'python'));
    });

    it('matches runtime PYTHONPATH prefix order from prepareRun', () => {
        const mockContext = createMockContext('/test/extension');
        const paths = getManagedPythonAnalysisPaths(mockContext);
        
        // Runtime order: [...getSandboxPythonPath(context), pythonDir]
        // which is [SandboxProcess, SandboxProcess/.deps, python]
        const sandboxDir = path.join('/test/extension', 'python', 'SandboxProcess');
        const depsDir = path.join(sandboxDir, '.deps');
        const pythonDir = path.join('/test/extension', 'python');
        
        expect(paths).toEqual([sandboxDir, depsDir, pythonDir]);
    });
});
