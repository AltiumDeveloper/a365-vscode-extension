import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const pythonDir = path.resolve(__dirname, '../../python');
const python = process.platform === 'win32' ? 'python' : 'python3';
const SCRIPT = `from altium import SecretNotFoundError

def onExecute(context, input_parameters):
    try:
        other = context.get_secret("api_key")
    except SecretNotFoundError:
        other = "not found"
    return {"value": context.get_secret("API_KEY"), "other": other}
`;

let dir: string;

function runRunner(secrets?: Record<string, string>) {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        PYTHONPATH: [path.join(pythonDir, 'SandboxProcess'), dir].join(path.delimiter),
        PYTHONIOENCODING: 'utf-8',
    };
    delete env.SECRETS_FILE_PATH;
    if (secrets) {
        env.SECRETS_FILE_PATH = path.join(dir, 'secrets.json');
        fs.writeFileSync(env.SECRETS_FILE_PATH, JSON.stringify(secrets));
    }
    return spawnSync(python, [path.join(pythonDir, '_runner.py'), path.join(dir, 'script.py')], {
        env,
        encoding: 'utf-8',
    });
}

describe('context.get_secret in the local runner', () => {
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altium365-get-secret-'));
        fs.mkdirSync(path.join(dir, 'gql'));
        fs.writeFileSync(path.join(dir, 'gql', '__init__.py'), 'class Client: pass\n');
        fs.writeFileSync(path.join(dir, 'script.py'), SCRIPT);
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reads values from SECRETS_FILE_PATH with an exact-case lookup', () => {
        const result = runRunner({ API_KEY: 'local-value' });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('"value": "local-value"');
        expect(result.stdout).toContain('"other": "not found"');
    });

    it("raises altium's SecretNotFoundError when the run has no secrets file", () => {
        const result = runRunner();

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('altium.SecretNotFoundError');
    });
});
