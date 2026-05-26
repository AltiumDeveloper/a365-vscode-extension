import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        alias: {
            vscode: new URL('./test/__mocks__/vscode.ts', import.meta.url).pathname,
        },
    },
});
