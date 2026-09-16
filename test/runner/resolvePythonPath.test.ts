import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolvePythonPath } from '../../src/runner/index';
import { Uri, extensions, window, workspace } from '../__mocks__/vscode';

const platformDefault = process.platform === 'win32' ? 'python' : 'python3';

function configuredPythonPath(value: string | undefined) {
    const get = vi.fn((_key: string) => value);
    workspace.getConfiguration.mockReturnValue({ get });
    return get;
}

function pythonExtension(exports: unknown) {
    extensions.getExtension.mockReturnValue({ isActive: true, activate: vi.fn(), exports });
}

describe('resolvePythonPath', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configuredPythonPath(undefined);
        extensions.getExtension.mockReturnValue(undefined);
        window.activeTextEditor = undefined;
    });

    it('returns the trimmed altium365.pythonPath setting when one is configured', async () => {
        const get = configuredPythonPath('  /opt/venv/bin/python  ');
        await expect(resolvePythonPath()).resolves.toBe('/opt/venv/bin/python');
        expect(workspace.getConfiguration).toHaveBeenCalledWith('altium365');
        expect(get).toHaveBeenCalledWith('pythonPath');
        expect(extensions.getExtension).not.toHaveBeenCalled();
    });

    it('ignores a whitespace-only altium365.pythonPath setting', async () => {
        configuredPythonPath('   ');
        await expect(resolvePythonPath()).resolves.toBe(platformDefault);
    });

    it('falls back to the platform interpreter when the Python extension is absent', async () => {
        await expect(resolvePythonPath()).resolves.toBe(platformDefault);
        expect(extensions.getExtension).toHaveBeenCalledWith('ms-python.python');
    });

    it('returns the active environment path when it is absolute', async () => {
        const uri = Uri.file('/work/script.py');
        window.activeTextEditor = { document: { uri } };
        const getActiveEnvironmentPath = vi.fn(() => ({ path: '/usr/local/bin/python3.12' }));
        pythonExtension({ environments: { getActiveEnvironmentPath } });

        await expect(resolvePythonPath()).resolves.toBe('/usr/local/bin/python3.12');
        expect(getActiveEnvironmentPath).toHaveBeenCalledWith(uri);
    });

    it('ignores a relative active environment path and uses the execution details instead', async () => {
        pythonExtension({
            environments: { getActiveEnvironmentPath: () => ({ path: 'python' }) },
            settings: { getExecutionDetails: () => ({ execCommand: ['/usr/bin/python3', '-X', 'utf8'] }) },
        });

        await expect(resolvePythonPath()).resolves.toBe('/usr/bin/python3');
    });

    it('falls back to the platform interpreter when execution details carry no command', async () => {
        pythonExtension({
            environments: { getActiveEnvironmentPath: () => ({ path: 'python' }) },
            settings: { getExecutionDetails: () => ({ execCommand: [] }) },
        });

        await expect(resolvePythonPath()).resolves.toBe(platformDefault);
    });

    it('ignores a relative active environment path with no execution details to fall back to', async () => {
        pythonExtension({
            environments: { getActiveEnvironmentPath: () => ({ path: './.venv/bin/python' }) },
        });

        await expect(resolvePythonPath()).resolves.toBe(platformDefault);
    });

    it('activates an inactive Python extension', async () => {
        const activate = vi.fn();
        extensions.getExtension.mockReturnValue({ isActive: false, activate, exports: {} });

        await expect(resolvePythonPath()).resolves.toBe(platformDefault);
        expect(activate).toHaveBeenCalledOnce();
    });

    it('falls back to the platform interpreter when the Python extension throws', async () => {
        extensions.getExtension.mockImplementation(() => { throw new Error('boom'); });

        await expect(resolvePythonPath()).resolves.toBe(platformDefault);
    });
});
