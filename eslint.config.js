// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
    // ── Base ignore patterns ─────────────────────────────────────────────────
    {
        ignores: ['out/**', 'node_modules/**', 'coverage/**'],
    },

    // ── TypeScript source + tests ────────────────────────────────────────────
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        extends: [
            ...tseslint.configs.recommended,
        ],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.lint.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Prefer `import type` for type-only imports (zero runtime cost)
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],

            // Warn on any — unavoidable for GraphQL payloads but flag new uses
            '@typescript-eslint/no-explicit-any': 'warn',

            // Unused vars are errors; allow underscore-prefixed intentional ignores
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            'no-unused-vars': 'off', // defer to @typescript-eslint/no-unused-vars

            // No console — all output goes through OutputChannel
            'no-console': 'error',

            // ── globalState access discipline ────────────────────────────────
            // Direct globalState.get / .update with a string literal is banned.
            // Use the typed accessor functions in src/workspace/state.ts,
            // src/testEvents/store.ts, or the owning module instead.
            'no-restricted-syntax': [
                'warn',
                {
                    selector:
                        "CallExpression[callee.type='MemberExpression'][callee.property.name='get'][callee.object.property.name='globalState'] > Literal",
                    message:
                        'Avoid raw globalState.get(<string>). Use a typed accessor from the owning state module (e.g. workspace/state.ts, testEvents/store.ts).',
                },
                {
                    selector:
                        "CallExpression[callee.type='MemberExpression'][callee.property.name='update'][callee.object.property.name='globalState'] > Literal",
                    message:
                        'Avoid raw globalState.update(<string>, ...). Use a typed accessor from the owning state module (e.g. workspace/state.ts, testEvents/store.ts).',
                },
            ],
        },
    },

    // ── Relax globalState rule inside the owning state modules ───────────────
    // These files ARE the typed wrappers, so raw globalState access is expected.
    {
        files: [
            'src/workspace/state.ts',
            'src/testEvents/store.ts',
            'src/testEvents/importSibling.ts',
            'src/runner/pythonAnalysis.ts',
            'src/auth/index.ts',
        ],
        rules: {
            'no-restricted-syntax': 'off',
        },
    },
);
