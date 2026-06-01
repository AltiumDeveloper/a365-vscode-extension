# Plan 12-01 Summary — Feature Folder Layout

## What was done

Reorganised `src/` from a flat file layout into feature folders with zero logic changes. Every file was moved to its target path and all relative import paths were updated.

## Final layout

```
src/
  shared/       asyncMutex.ts, logDedup.ts
  auth/         index.ts  (was auth.ts)
  workspace/    index.ts  (was workspace.ts)
  scripts/      commands.ts, remoteFs.ts, execution.ts, localCache.ts, filesService.ts
  ux/           panel.ts, treeCommands.ts, statusBar.ts, projectPicker.ts
  runner/       pythonAnalysis.ts, sandbox.ts, progress.ts
  testEvents/   unchanged
  extension.ts  unchanged
```

## Bonus: gitignore fix

`coverage/` directory added to `.gitignore` (was accidentally committed during Phase 11 coverage work).

## Commits

- `a3e9221` — t1: src/shared/ (asyncMutex, logDedup)
- `a98713a` — chore: add coverage/ to .gitignore
- `c4a78d0` — t2: src/auth/index.ts
- `5a5dc28` — t3: src/workspace/index.ts
- `6b45464` — t4: src/scripts/
- `31d3851` — t5: src/ux/
- `59a39b2` — t6: src/runner/
- `8211ae0` — t7: test/ import path updates

## Verification

- `npm run compile` — exits 0 after every task
- `npm test` — 142/142 tests passing
