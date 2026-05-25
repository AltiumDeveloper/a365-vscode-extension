import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import { compareVersions } from './semverCompare';

/**
 * In-extension self-updater. Polls GitHub Releases for the
 * `AltiumDeveloper/a365-vscode-extension` repo, compares the latest published version
 * against the running extension (`altium.developer`), and offers a one-click
 * download + install + reload flow.
 *
 * Wired from `src/extension.ts:activate()` via `registerUpdater`. The
 * activation-time auto check is fire-and-forget (never awaited) and debounced
 * to once per 24h via `globalState['altium365.lastUpdateCheckAt']`. A manual
 * `altium365.checkForUpdates` palette command bypasses the debounce and
 * surfaces explicit feedback either way.
 *
 * CRITICAL: This module uses Node's `https.get` directly — the global HTTP
 * client (globalThis dot f-e-t-c-h, name elided so grep-based audits cannot
 * flag this comment as a real call site) is broken in the VS Code Extension
 * Host (see src/auth.ts:9-13). Do not change this.
 */

// `${publisher}.${name}` from package.json. Post-Phase-08 rebrand:
// publisher = "altium", name = "developer" → "altium.developer".
const EXTENSION_ID = 'altium.developer';
const GLOBAL_LAST_CHECK_KEY = 'altium365.lastUpdateCheckAt';
const RELEASES_URL = 'https://api.github.com/repos/AltiumDeveloper/a365-vscode-extension/releases';
const DEBOUNCE_MS = 24 * 60 * 60 * 1000;
// GitHub REST returns 403 without a User-Agent (see 08-RESEARCH.md Pitfall #4).
const USER_AGENT = 'altium365-vscode-extension';
const LOG_PREFIX = '[Altium 365] updater:';

// Module-private in-flight guard. The ONLY module-level mutable state in this
// file — justified per AGENTS.md exception because it must serialize across
// concurrent activation-time + manual-command invocations within a single
// extension host (08-RESEARCH.md Q3).
let isChecking = false;

export function registerUpdater(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): vscode.Disposable[] {
    const enabled = vscode.workspace
        .getConfiguration('altium365')
        .get<boolean>('checkForUpdates', true);
    if (enabled) {
        // Fire-and-forget — activate() never awaits a network call.
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

interface CheckOpts {
    manual: boolean;
}

async function runCheck(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    opts: CheckOpts,
): Promise<void> {
    if (isChecking) {
        if (opts.manual) {
            void vscode.window.showInformationMessage(
                'Altium 365: update check already in progress…',
            );
        } else {
            output.appendLine(`${LOG_PREFIX} skip — check already in flight`);
        }
        return;
    }
    isChecking = true;
    try {
        // Debounce — auto path only. Manual always runs.
        if (!opts.manual) {
            const last = context.globalState.get<number>(GLOBAL_LAST_CHECK_KEY, 0);
            const elapsed = Date.now() - last;
            if (last > 0 && elapsed < DEBOUNCE_MS) {
                const hours = Math.round(elapsed / (60 * 60 * 1000));
                output.appendLine(`${LOG_PREFIX} debounced — last check ${hours}h ago`);
                return;
            }
        }

        // Resolve installed version.
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        const installed = ext?.packageJSON?.version as string | undefined;
        if (!installed) {
            const msg = `cannot resolve installed version (extension id ${EXTENSION_ID} not found)`;
            output.appendLine(`${LOG_PREFIX} ${msg}`);
            if (opts.manual) {
                void vscode.window.showErrorMessage(`Altium 365: ${msg}`);
            }
            return;
        }

        // Fetch releases list. Network failures get the manual/auto split
        // treatment per the locked contract.
        let releases: unknown;
        try {
            releases = await getJson(RELEASES_URL, 8000);
        } catch (e) {
            const m = (e as Error).message;
            output.appendLine(`${LOG_PREFIX} ${opts.manual ? 'manual' : 'auto'} check failed: ${m}`);
            if (opts.manual) {
                void vscode.window.showErrorMessage(
                    'Altium 365: update check failed — see Output panel for details.',
                );
            }
            return;
        }

        // Stamp debounce timestamp ONLY after a successful fetch — network
        // failures do not poison the next attempt.
        await context.globalState.update(GLOBAL_LAST_CHECK_KEY, Date.now());

        if (!Array.isArray(releases)) {
            output.appendLine(`${LOG_PREFIX} unexpected response shape (not an array)`);
            if (opts.manual) {
                void vscode.window.showErrorMessage(
                    'Altium 365: update check returned unexpected data.',
                );
            }
            return;
        }

        // Pick latest non-draft release by published_at desc. Pre-releases are
        // intentionally INCLUDED (08-RESEARCH.md Q1 — CI from Plan 08-01
        // marks every main-branch build as a prerelease).
        const candidates = (releases as Array<Record<string, unknown>>)
            .filter((r) => r && r.draft !== true)
            .sort((a, b) => {
                const ap = String(a.published_at ?? '');
                const bp = String(b.published_at ?? '');
                return ap < bp ? 1 : ap > bp ? -1 : 0;
            });
        if (candidates.length === 0) {
            output.appendLine(`${LOG_PREFIX} no releases found`);
            if (opts.manual) {
                void vscode.window.showInformationMessage(
                    `Altium 365: you're on the latest version (${installed}).`,
                );
            }
            return;
        }

        const release = candidates[0];
        const latest = String(release.tag_name ?? release.name ?? '').trim();
        if (!latest) {
            output.appendLine(`${LOG_PREFIX} latest release missing tag_name/name`);
            if (opts.manual) {
                void vscode.window.showErrorMessage(
                    'Altium 365: latest release has no version tag.',
                );
            }
            return;
        }

        const cmp = compareVersions(latest, installed);
        if (cmp <= 0) {
            output.appendLine(`${LOG_PREFIX} up to date (installed=${installed}, latest=${latest})`);
            if (opts.manual) {
                void vscode.window.showInformationMessage(
                    `Altium 365: you're on the latest version (${installed}).`,
                );
            }
            return;
        }

        // Pick the VSIX asset. If multiple, pick the largest by size
        // (08-RESEARCH.md line 81).
        const assets = (release.assets as Array<Record<string, unknown>> | undefined) ?? [];
        const vsixAssets = assets
            .filter((a) => typeof a.name === 'string' && (a.name as string).endsWith('.vsix'))
            .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0));
        if (vsixAssets.length === 0) {
            output.appendLine(`${LOG_PREFIX} release ${latest} has no .vsix asset`);
            if (opts.manual) {
                void vscode.window.showErrorMessage(
                    `Altium 365: release ${latest} has no installable .vsix asset.`,
                );
            }
            return;
        }
        const asset = vsixAssets[0];
        const assetName = String(asset.name);
        const downloadUrl = String(asset.browser_download_url ?? '');
        if (!downloadUrl) {
            output.appendLine(`${LOG_PREFIX} release ${latest} asset ${assetName} missing browser_download_url`);
            if (opts.manual) {
                void vscode.window.showErrorMessage(
                    `Altium 365: release ${latest} asset has no download URL.`,
                );
            }
            return;
        }

        output.appendLine(`${LOG_PREFIX} update available: installed=${installed}, latest=${latest}, asset=${assetName}`);

        const choice = await vscode.window.showInformationMessage(
            `Altium 365: v${latest} available`,
            'Update Now',
            'Later',
        );
        if (choice !== 'Update Now') {
            output.appendLine(`${LOG_PREFIX} user dismissed update prompt (choice=${choice ?? 'dismissed'})`);
            return;
        }

        // Path-traversal guard on the asset filename before joining with
        // tmpdir (08-RESEARCH.md line 667).
        const tmpName = path.basename(assetName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const vsixPath = path.join(os.tmpdir(), tmpName);

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Altium 365: downloading update…',
                    cancellable: false,
                },
                async () => {
                    output.appendLine(`${LOG_PREFIX} downloading ${downloadUrl} → ${vsixPath}`);
                    await downloadFollowingRedirects(downloadUrl, vsixPath, 5, 60000);
                    output.appendLine(`${LOG_PREFIX} installing ${vsixPath}`);
                    // Pitfall #6: MUST be a Uri, not a bare string.
                    await vscode.commands.executeCommand(
                        'workbench.extensions.installExtension',
                        vscode.Uri.file(vsixPath),
                    );
                },
            );
        } catch (e) {
            const m = (e as Error).message;
            output.appendLine(`${LOG_PREFIX} install failed: ${m}`);
            void vscode.window.showErrorMessage(
                `Altium 365: update install failed — ${m}`,
            );
            return;
        }

        output.appendLine(`${LOG_PREFIX} installed v${latest}; prompting reload`);
        const reloadChoice = await vscode.window.showInformationMessage(
            'Altium 365: update installed. Reload window to apply.',
            'Reload Now',
        );
        if (reloadChoice === 'Reload Now') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } finally {
        isChecking = false;
    }
}

function getJson(endpoint: string, timeoutMs = 8000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let url: URL;
        try {
            url = new URL(endpoint);
        } catch (e) {
            reject(new Error(`Invalid endpoint: ${endpoint}`));
            return;
        }
        if (url.protocol !== 'https:') {
            reject(new Error(`refusing non-https endpoint: ${url.protocol}`));
            return;
        }
        const req = https.get(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                timeout: timeoutMs,
            },
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                    } catch (e) {
                        reject(new Error(`invalid JSON: ${(e as Error).message}`));
                    }
                });
                res.on('error', reject);
            },
        );
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        req.on('error', reject);
    });
}

function downloadFollowingRedirects(
    url: string,
    destPath: string,
    maxHops = 5,
    timeoutMs = 60000,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const visit = (currentUrl: string, hopsLeft: number): void => {
            if (hopsLeft < 0) {
                reject(new Error('too many redirects'));
                return;
            }
            let parsed: URL;
            try {
                parsed = new URL(currentUrl);
            } catch (e) {
                reject(new Error(`invalid download URL: ${currentUrl}`));
                return;
            }
            if (parsed.protocol !== 'https:') {
                reject(new Error(`refusing non-https download URL: ${parsed.protocol}`));
                return;
            }
            const req = https.get(
                {
                    protocol: parsed.protocol,
                    hostname: parsed.hostname,
                    port: parsed.port || 443,
                    path: parsed.pathname + parsed.search,
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: timeoutMs,
                },
                (res) => {
                    const status = res.statusCode ?? 0;
                    if (status >= 300 && status < 400 && res.headers.location) {
                        res.resume();
                        let next: string;
                        try {
                            next = new URL(res.headers.location, currentUrl).toString();
                        } catch (e) {
                            reject(new Error(`invalid redirect URL: ${res.headers.location}`));
                            return;
                        }
                        visit(next, hopsLeft - 1);
                        return;
                    }
                    if (status !== 200) {
                        res.resume();
                        reject(new Error(`download HTTP ${status}`));
                        return;
                    }
                    const out = fs.createWriteStream(destPath);
                    res.pipe(out);
                    out.on('finish', () => out.close((err) => (err ? reject(err) : resolve())));
                    out.on('error', reject);
                    res.on('error', reject);
                },
            );
            req.on('timeout', () => req.destroy(new Error('download timeout')));
            req.on('error', reject);
        };
        visit(url, maxHops);
    });
}

// Re-export the pure comparator from the unit-testable split so future
// callers have a single import surface — the split exists only because
// vitest cannot import modules that pull in `vscode`.
export { compareVersions, parseVersion } from './semverCompare';
