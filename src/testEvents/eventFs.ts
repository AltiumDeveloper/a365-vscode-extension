import * as vscode from 'vscode';
import { readStore, writeStore, TestEventStore } from './store';

/**
 * Test-event FileSystemProvider on the `altium365-event://` scheme
 * (Phase 999.3, D-15). Backs editable JSON tabs whose Cmd+S commits to
 * `context.globalState` via `writeStore`. Used by the test-events
 * commands (Plan 999.3-04) and the JSONSchema binding declared in
 * package.json `contributes.jsonValidation` (Plan 999.3-03 / D-16).
 *
 * URI shape (Pitfall 1 — encodeURIComponent on identity and event-name
 * to survive identities containing ':' and win32-style backslashes).
 *
 * Identity lives in the FIRST PATH SEGMENT (not authority) because
 * `vscode.Uri.parse` lowercases the authority per RFC 3986 §3.2.2,
 * which silently corrupts mixed-case identities (e.g. uppercase hex in
 * GraphQL-returned UUIDs) → store-key miss on Edit → empty payload tab.
 * Path segments are preserved verbatim.
 *
 *     altium365-event:/<encodeURIComponent(identity)>/<encodeURIComponent(eventName)>.json
 *
 * Two-layer JSONSchema strategy (RESEARCH §Q2):
 *   1. package.json `jsonValidation` declarative binding (Plan 999.3-03 Task 2).
 *   2. `readFile` injects a `$schema` field pointing at the bundled
 *      `schemas/test-event.schema.json` file:// URL as a runtime fallback.
 *      `writeFile` strips the injected field before persisting.
 *
 * NOTE (Pitfall 6 / RESEARCH §Q1): the literal onDidSaveTextDocument
 * save-bridge pattern from localScriptCache.ts is intentionally NOT
 * copied here. That listener filters `doc.uri.scheme !== 'file'` and
 * would never fire for altium365-event://. The FileSystemProvider's
 * own writeFile is the commit point; Cmd+S routes through it directly.
 */

const SCHEME = 'altium365-event';
const SCHEMA_BASENAME = 'schemas/test-event.schema.json';

function parseEventUri(
    uri: vscode.Uri,
): { identity: string; eventName: string } | undefined {
    if (uri.scheme !== SCHEME) {
        return undefined;
    }
    const raw = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    const slash = raw.indexOf('/');
    if (slash <= 0) {
        return undefined;
    }
    const identity = decodeURIComponent(raw.slice(0, slash));
    const rest = raw.slice(slash + 1);
    if (!rest.toLowerCase().endsWith('.json')) {
        return undefined;
    }
    const eventName = decodeURIComponent(rest.slice(0, rest.length - '.json'.length));
    if (!identity || !eventName) {
        return undefined;
    }
    return { identity, eventName };
}

export function buildEventUri(identity: string, eventName: string): vscode.Uri {
    // Empty authority + identity in first path segment — see file header
    // for why authority is unsafe (Uri.parse lowercases per RFC 3986).
    // Use Uri.from to avoid the "path cannot begin with //" ambiguity that
    // Uri.parse triggers when authority is empty and path starts with a slash.
    return vscode.Uri.from({
        scheme: SCHEME,
        path: `/${encodeURIComponent(identity)}/${encodeURIComponent(eventName)}.json`,
    });
}

// CONVENTIONS exception: this class holds private mutable state
// (_onDidChangeFile EventEmitter). Same exception as AltiumRemoteScriptFs —
// single-purpose FileSystemProvider lifecycle bound to extension activation.
export class TestEventFs implements vscode.FileSystemProvider {
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    public readonly onDidChangeFile = this._onDidChangeFile.event;

    constructor(
        private readonly ctx: vscode.ExtensionContext,
        private readonly output: vscode.OutputChannel,
    ) {}

    watch(_uri: vscode.Uri): vscode.Disposable {
        return new vscode.Disposable(() => {
            // no-op — globalState changes are surfaced via _onDidChangeFile from writeFile
        });
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const parsed = parseEventUri(uri);
        if (!parsed) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        // Always return File so VS Code's openTextDocument succeeds for not-yet-
        // created events; writeFile is the implicit create-on-save path.
        return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: 0 };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const parsed = parseEventUri(uri);
        if (!parsed) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const store = readStore(this.ctx, parsed.identity);
        const payload = store?.events[parsed.eventName] ?? {};
        const schemaUri = vscode.Uri
            .file(this.ctx.asAbsolutePath(SCHEMA_BASENAME))
            .toString();
        // Layer-2 fallback per RESEARCH §Q2 — `$schema` is stripped on writeFile.
        const withSchema = { $schema: schemaUri, ...payload };
        return Buffer.from(JSON.stringify(withSchema, null, 2), 'utf-8');
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        _opts: { create: boolean; overwrite: boolean },
    ): Promise<void> {
        const parsed = parseEventUri(uri);
        if (!parsed) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        let obj: unknown;
        try {
            obj = JSON.parse(Buffer.from(content).toString('utf-8'));
        } catch (e) {
            throw vscode.FileSystemError.Unavailable(
                `Invalid JSON: ${(e as Error).message}`,
            );
        }
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw vscode.FileSystemError.Unavailable(
                'Test event must be a JSON object',
            );
        }
        // Strip the transport-only Layer-2 fallback before persisting.
        delete (obj as { $schema?: unknown }).$schema;
        const existing = readStore(this.ctx, parsed.identity);
        const next: TestEventStore = existing ?? {
            defaultEventName: '',
            events: {},
        };
        next.events[parsed.eventName] = obj as Record<string, unknown>;
        if (!next.defaultEventName) {
            next.defaultEventName = parsed.eventName;
        }
        await writeStore(this.ctx, parsed.identity, next);
        this.output.appendLine(
            `[Altium 365] testEvents.fs: saved '${parsed.eventName}' for ${parsed.identity}`,
        );
        this._onDidChangeFile.fire([
            { type: vscode.FileChangeType.Changed, uri },
        ]);
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    createDirectory(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    async delete(uri: vscode.Uri): Promise<void> {
        // Per RESEARCH §Q1: delegate to the command so user gets the
        // confirmation flow. Plan 999.3-04 registers altium365.testEvents.delete;
        // until then this is a soft no-op (FSP delete is only reachable via
        // VS Code's explorer or programmatic call; the test-event editor tab
        // close path does NOT invoke delete).
        const parsed = parseEventUri(uri);
        if (!parsed) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        await vscode.commands.executeCommand('altium365.testEvents.delete', uri);
    }

    rename(oldUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(oldUri);
    }
}
