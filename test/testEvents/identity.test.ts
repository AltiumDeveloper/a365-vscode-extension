import { describe, it, expect, beforeEach } from 'vitest';
import { resolveScriptIdentity } from '../../src/testEvents/identity';
import { registerLocalScript } from '../../src/localScriptCache';
import type * as vscode from 'vscode';

// Minimal Uri mock — plain objects matching the vscode.Uri structural shape
function makeUri(scheme: string, path: string, fsPath = ''): vscode.Uri {
    return { scheme, path, fsPath, authority: '', query: '', fragment: '', toString: () => `${scheme}:${path}` } as vscode.Uri;
}

const VALID_SCRIPT_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_PATH = `/grid:workspace:my-team:scripts:script/${VALID_SCRIPT_ID}/MyScript`;

describe('resolveScriptIdentity', () => {
    it('resolves altium365:// URI with valid GRID path to remote identity', () => {
        const uri = makeUri('altium365', VALID_PATH);
        const result = resolveScriptIdentity(uri);
        expect(result).toMatchObject({
            kind: 'remote',
            identity: VALID_SCRIPT_ID,
            workspaceAuthId: 'my-team',
        });
    });

    it('returns undefined for altium365:// URI with malformed path', () => {
        const uri = makeUri('altium365', '/grid:workspace::scripts:script/bad-id');
        expect(resolveScriptIdentity(uri)).toBeUndefined();
    });

    it('resolves file:// URI NOT in localScriptCache to local identity', () => {
        const fsPath = '/not/registered/script.py';
        const uri = makeUri('file', fsPath, fsPath);
        const result = resolveScriptIdentity(uri);
        expect(result).toMatchObject({ kind: 'local' });
        expect(typeof result!.identity).toBe('string');
        expect(result!.identity.length).toBeGreaterThan(0);
    });

    it('resolves file:// URI registered in localScriptCache to remote identity', () => {
        const fsPath = '/registered/script.py';
        registerLocalScript(fsPath, { scriptId: 'aabbccdd-0011-2233-4455-667788990011', workspaceAuthId: 'ws-auth', scriptName: 'TestScript' });
        const uri = makeUri('file', fsPath, fsPath);
        const result = resolveScriptIdentity(uri);
        expect(result).toMatchObject({
            kind: 'remote',
            identity: 'aabbccdd-0011-2233-4455-667788990011',
            workspaceAuthId: 'ws-auth',
        });
    });

    it('returns undefined for altium365-event:// scheme', () => {
        const uri = makeUri('altium365-event', '/some/path');
        expect(resolveScriptIdentity(uri)).toBeUndefined();
    });

    it('returns undefined for https:// scheme', () => {
        const uri = makeUri('https', '//example.com');
        expect(resolveScriptIdentity(uri)).toBeUndefined();
    });
});
