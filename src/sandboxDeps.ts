import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

/**
 * Manages the vendored `python/SandboxProcess/` runtime that user scripts
 * depend on. SandboxProcess ships with the extension VSIX and provides the
 * `altium` + `altium_api` Python packages (the same modules Altium 365
 * scripts get inside the cloud sandbox). Its `requirements.txt` lists
 * third-party packages (currently `requests`, `gql[all]`) that scripts and
 * the helper modules import.
 *
 * Strategy (per UAT-4):
 *   - Both `SandboxProcess/` and `SandboxProcess/.deps/` are prepended to
 *     PYTHONPATH at every script run / debug.
 *   - `.deps/` is populated by `pip install --target` on demand. We track
 *     the SHA-256 of `requirements.txt` in `.deps/.installed-marker.json`
 *     so version drift triggers re-install. `.deps/` is gitignored and
 *     vscodeignored — created per-user inside the installed extension
 *     folder.
 *
 * Failure modes are surfaced as errors at the command boundary (matching
 * the pattern in `extension.ts`). Cancellation returns `false` so the
 * caller can abort the run cleanly.
 */

const MARKER_FILE = '.installed-marker.json';

interface InstallMarker {
    requirementsSha256: string;
    installedAt: string;
}

export function getSandboxDir(context: vscode.ExtensionContext): string {
    return context.asAbsolutePath(path.join('python', 'SandboxProcess'));
}

export function getSandboxDepsDir(context: vscode.ExtensionContext): string {
    return path.join(getSandboxDir(context), '.deps');
}

function getRequirementsPath(context: vscode.ExtensionContext): string {
    return path.join(getSandboxDir(context), 'requirements.txt');
}

function hashRequirements(reqPath: string): string {
    const buf = fs.readFileSync(reqPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function readMarker(depsDir: string): InstallMarker | undefined {
    try {
        const raw = fs.readFileSync(path.join(depsDir, MARKER_FILE), 'utf-8');
        return JSON.parse(raw) as InstallMarker;
    } catch {
        return undefined;
    }
}

function writeMarker(depsDir: string, marker: InstallMarker): void {
    fs.writeFileSync(
        path.join(depsDir, MARKER_FILE),
        JSON.stringify(marker, null, 2),
        'utf-8'
    );
}

/**
 * Ensure `.deps/` is populated and matches the current requirements.txt.
 * Returns:
 *   - true: dependencies are ready (already installed at correct version,
 *     or freshly installed in this call)
 *   - false: user cancelled, install failed, or requirements.txt is
 *     missing. The caller should abort the run; user-facing error has
 *     already been surfaced.
 *
 * `force` skips the marker check and re-installs unconditionally. Used by
 * the `altium365.installScriptDependencies` command.
 */
export async function ensureSandboxDeps(
    context: vscode.ExtensionContext,
    python: string,
    output: vscode.OutputChannel,
    force = false
): Promise<boolean> {
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

    const reason = !marker
        ? 'not yet installed'
        : marker.requirementsSha256 !== currentHash
          ? 'requirements.txt changed since last install'
          : 'forced reinstall';

    if (!force) {
        const choice = await vscode.window.showInformationMessage(
            `Altium 365 script dependencies need to be installed (${reason}). ` +
                'They will be installed locally under the extension folder ' +
                '(python/SandboxProcess/.deps/).',
            { modal: false },
            'Install',
            'Cancel'
        );
        if (choice !== 'Install') {
            return false;
        }
    }

    fs.mkdirSync(depsDir, { recursive: true });

    const ok = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Altium 365: installing Python dependencies',
            cancellable: true,
        },
        (progress, token) =>
            runPipInstall(python, reqPath, depsDir, output, progress, token)
    );

    if (!ok) {
        return false;
    }
    writeMarker(depsDir, {
        requirementsSha256: currentHash,
        installedAt: new Date().toISOString(),
    });
    output.appendLine(
        `[Altium 365] Sandbox dependencies installed to ${depsDir}`
    );
    return true;
}

function runPipInstall(
    python: string,
    requirementsPath: string,
    depsDir: string,
    output: vscode.OutputChannel,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const args = [
            '-m',
            'pip',
            'install',
            '--disable-pip-version-check',
            '--no-input',
            '-r',
            requirementsPath,
            '--target',
            depsDir,
        ];
        output.show(true);
        output.appendLine(
            `[Altium 365] Installing dependencies: ${python} ${args.join(' ')}`
        );
        progress.report({ message: 'Running pip install...' });
        const proc = spawn(python, args, { env: process.env });
        let cancelled = false;
        token.onCancellationRequested(() => {
            cancelled = true;
            proc.kill();
        });
        proc.stdout.on('data', (d) => output.append(d.toString()));
        proc.stderr.on('data', (d) => output.append(d.toString()));
        proc.on('error', (err) => {
            output.appendLine(`[Altium 365] pip launch failed: ${err.message}`);
            vscode.window.showErrorMessage(
                `Altium 365: failed to launch pip — ${err.message}. ` +
                    'Check that the configured Python interpreter exists and has pip.'
            );
            resolve(false);
        });
        proc.on('close', (code) => {
            if (cancelled) {
                output.appendLine('[Altium 365] pip install cancelled.');
                resolve(false);
                return;
            }
            if (code === 0) {
                output.appendLine('[Altium 365] pip install succeeded.');
                resolve(true);
            } else {
                output.appendLine(`[Altium 365] pip install exited ${code}.`);
                vscode.window.showErrorMessage(
                    `Altium 365: pip install failed with exit code ${code}. ` +
                        'See the Altium 365 output channel for details.'
                );
                resolve(false);
            }
        });
    });
}

/**
 * Build the PYTHONPATH prefix chunks (in order) that need to be prepended
 * to env.PYTHONPATH for sandbox scripts: SandboxProcess/ comes first so
 * `import altium` / `import altium_api` resolves to the vendored copies;
 * SandboxProcess/.deps/ follows so third-party deps (`gql`, `requests`)
 * resolve next.
 */
export function getSandboxPythonPath(context: vscode.ExtensionContext): string[] {
    return [getSandboxDir(context), getSandboxDepsDir(context)];
}
