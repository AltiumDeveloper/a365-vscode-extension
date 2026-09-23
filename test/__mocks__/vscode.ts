// Shared vscode mock for the unit tests
import { vi } from 'vitest';
import type { ExtensionContext, Uri as VSCodeUri } from 'vscode';

// ── EventEmitter ──────────────────────────────────────────────────
export class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    fire(event: T): void { this.listeners.forEach(l => l(event)); }
    get event(): (listener: (e: T) => void) => Disposable {
        return (listener) => {
            this.listeners.push(listener);
            return new Disposable(() => {
                this.listeners = this.listeners.filter(l => l !== listener);
            });
        };
    }
    dispose(): void { this.listeners = []; }
}

// ── Disposable ────────────────────────────────────────────────────
export class Disposable {
    constructor(private readonly _dispose: () => void) {}
    dispose(): void { this._dispose(); }
}

// ── Uri ───────────────────────────────────────────────────────────
export const Uri = {
    from: (parts: { scheme: string; path: string; authority?: string; query?: string; fragment?: string }) =>
        ({ ...parts, authority: parts.authority ?? '', query: parts.query ?? '', fragment: parts.fragment ?? '',
           fsPath: parts.path, toString: () => `${parts.scheme}:${parts.path}` }) as unknown as VSCodeUri,
    parse: (value: string) => {
        const idx = value.indexOf(':');
        const scheme = idx >= 0 ? value.slice(0, idx) : value;
        const rest = idx >= 0 ? value.slice(idx + 1) : '';
        return { scheme, path: rest, authority: '', fsPath: rest, toString: () => value } as unknown as VSCodeUri;
    },
    file: (path: string) => ({ scheme: 'file', path, authority: '', fsPath: path, toString: () => `file://${path}` }) as unknown as VSCodeUri,
};

// ── FileSystemError ───────────────────────────────────────────────
export class FileSystemError extends Error {
    public code: string = '';
    static FileNotFound(_uri?: unknown): FileSystemError {
        const e = new FileSystemError('FileNotFound');
        e.code = 'FileNotFound';
        return e;
    }
    static Unavailable(msgOrUri: unknown): FileSystemError {
        const e = new FileSystemError(typeof msgOrUri === 'string' ? msgOrUri : 'Unavailable');
        e.code = 'Unavailable';
        return e;
    }
    static FileNotADirectory(_uri?: unknown): FileSystemError {
        const e = new FileSystemError('FileNotADirectory');
        e.code = 'FileNotADirectory';
        return e;
    }
    static NoPermissions(_uri?: unknown): FileSystemError {
        const e = new FileSystemError('NoPermissions');
        e.code = 'NoPermissions';
        return e;
    }
}

// ── FileType ──────────────────────────────────────────────────────
export enum FileType { Unknown = 0, File = 1, Directory = 2, SymbolicLink = 64 }
export enum FileChangeType { Changed = 1, Created = 2, Deleted = 3 }
export enum QuickPickItemKind { Separator = -1, Default = 0 }

// ── window stubs ──────────────────────────────────────────────────
export const window = {
    activeTextEditor: undefined as { document: { uri: VSCodeUri } } | undefined,
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    createQuickPick: vi.fn(),
    setStatusBarMessage: vi.fn(),
    withProgress: vi.fn(
        <T>(
            _options: unknown,
            task: (
                progress: { report: (value: unknown) => void },
                token: { onCancellationRequested: (cb: () => void) => void }
            ) => Promise<T>
        ) => task({ report: () => {} }, { onCancellationRequested: () => {} })
    ),
};

export enum ProgressLocation { SourceControl = 1, Window = 10, Notification = 15 }

// ── workspace stubs ───────────────────────────────────────────────
export const workspace = {
    getConfiguration: vi.fn((): { get: (key: string) => unknown } => ({
        get: vi.fn(() => undefined),
    })),
    onDidSaveTextDocument: vi.fn(() => new Disposable(() => {})),
    fs: { writeFile: vi.fn() },
};

// ── debug stubs ───────────────────────────────────────────────────
export const debugSessionTerminated = new EventEmitter<{ configuration?: Record<string, unknown> }>();
export const debug = {
    startDebugging: vi.fn(async () => true),
    onDidTerminateDebugSession: debugSessionTerminated.event,
};

// ── extensions stubs ──────────────────────────────────────────────
export const extensions = {
    getExtension: vi.fn<(id: string) => unknown>(),
};

// ── commands stubs ────────────────────────────────────────────────
export const commands = {
    executeCommand: vi.fn(),
};

// ── env stubs ─────────────────────────────────────────────────────
export const env = {
    openExternal: vi.fn(),
};

// ── Factory functions ─────────────────────────────────────────────
export function makeSecretStorage() {
    const store = new Map<string, string>();
    return {
        get: vi.fn(async (key: string) => store.get(key)),
        store: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
        delete: vi.fn(async (key: string) => { store.delete(key); }),
        onDidChange: new EventEmitter<{ key: string }>().event,
    };
}

export function makeGlobalState() {
    const store = new Map<string, unknown>();
    return {
        get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined =>
            (store.has(key) ? store.get(key) : defaultValue) as T | undefined),
        update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
        keys: vi.fn(() => [...store.keys()] as readonly string[]),
        setKeysForSync: vi.fn(),
    };
}

export function makeExtensionContext(overrides?: Record<string, unknown>) {
    return {
        secrets: makeSecretStorage(),
        globalState: makeGlobalState(),
        asAbsolutePath: vi.fn((rel: string) => `/mock/extension/${rel}`),
        subscriptions: [],
        ...overrides,
    } as unknown as ExtensionContext;
}
