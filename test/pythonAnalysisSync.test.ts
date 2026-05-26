import { describe, it, expect } from 'vitest';
import { reconcilePythonAnalysisPaths } from '../src/pythonAnalysisSync';

describe('reconcilePythonAnalysisPaths', () => {
    it('previous managed paths are removed while unrelated user paths stay intact per D-11', () => {
        const existingExtraPaths = [
            '/user/custom/path',
            '/managed/SandboxProcess',
            '/managed/SandboxProcess/.deps',
            '/user/another/path',
        ];
        const previousManagedPaths = [
            '/managed/SandboxProcess',
            '/managed/SandboxProcess/.deps',
        ];
        const desiredManagedPaths: string[] = [];
        const injectHelperEnabled = false;

        const result = reconcilePythonAnalysisPaths({
            existingExtraPaths,
            previousManagedPaths,
            desiredManagedPaths,
            injectHelperEnabled,
        });

        // Only user paths should remain
        expect(result).toEqual([
            '/user/custom/path',
            '/user/another/path',
        ]);
    });

    it('enabling injectHelper re-appends the current managed paths in canonical order per D-02 and D-13', () => {
        const existingExtraPaths = [
            '/user/custom/path',
        ];
        const previousManagedPaths: string[] = [];
        const desiredManagedPaths = [
            '/managed/SandboxProcess',
            '/managed/SandboxProcess/.deps',
            '/managed/python',
        ];
        const injectHelperEnabled = true;

        const result = reconcilePythonAnalysisPaths({
            existingExtraPaths,
            previousManagedPaths,
            desiredManagedPaths,
            injectHelperEnabled,
        });

        // User path preserved, managed paths appended in order
        expect(result).toEqual([
            '/user/custom/path',
            '/managed/SandboxProcess',
            '/managed/SandboxProcess/.deps',
            '/managed/python',
        ]);
    });

    it('disabling injectHelper returns only preserved user paths while keeping the managed-path snapshot reversible per D-11/D-12', () => {
        const existingExtraPaths = [
            '/user/custom/path',
            '/old/SandboxProcess',
            '/old/SandboxProcess/.deps',
        ];
        const previousManagedPaths = [
            '/old/SandboxProcess',
            '/old/SandboxProcess/.deps',
        ];
        const desiredManagedPaths: string[] = [];
        const injectHelperEnabled = false;

        const result = reconcilePythonAnalysisPaths({
            existingExtraPaths,
            previousManagedPaths,
            desiredManagedPaths,
            injectHelperEnabled,
        });

        // Only user path remains, managed paths removed
        expect(result).toEqual(['/user/custom/path']);
    });

    it('normalized duplicate paths do not produce duplicate python.analysis.extraPaths entries', () => {
        const existingExtraPaths = [
            '/user/custom/path',
            '/managed/SandboxProcess',
        ];
        const previousManagedPaths = [
            '/managed/SandboxProcess',
        ];
        const desiredManagedPaths = [
            '/managed/SandboxProcess',  // duplicate
            '/managed/SandboxProcess/.deps',
            '/managed/python',
        ];
        const injectHelperEnabled = true;

        const result = reconcilePythonAnalysisPaths({
            existingExtraPaths,
            previousManagedPaths,
            desiredManagedPaths,
            injectHelperEnabled,
        });

        // No duplicates: each path appears exactly once
        expect(result).toEqual([
            '/user/custom/path',
            '/managed/SandboxProcess',
            '/managed/SandboxProcess/.deps',
            '/managed/python',
        ]);
    });
});
