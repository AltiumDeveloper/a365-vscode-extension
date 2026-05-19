# Phase 1: Packaging - Research

**Researched:** 2026-05-19
**Domain:** VS Code Extension packaging, GitHub Actions CI, npm scripting
**Confidence:** HIGH

## Summary

Phase 1 is a pure infrastructure phase: update `package.json` metadata, add `@vscode/vsce` as a devDependency, wire up `npm run package`, patch `.vscodeignore`, create a monochrome 128×128 icon, rewrite `README.md`, and ship a GitHub Actions workflow. No TypeScript changes are required. The working extension codebase is already compile-clean; every task is additive.

`@vscode/vsce` 3.9.1 (released 2026-04-17) is current and confirmed on the npm registry. It calls `vscode:prepublish` automatically before packaging, so the `package` script stays lean (`vsce package`). `.vscodeignore` already exists in the repo but is missing a `.planning/**` exclusion that will bloat the VSIX if not added.

The one non-trivial sub-task is icon generation. There is no existing `resources/` directory. A monochrome 128×128 PNG must be produced programmatically (no image editing tools available in CI). The lightest approach is a small inline Node.js script using only the built-in `Buffer` + raw PNG construction, or a devDependency on `sharp` / `canvas`. `sharp` has pre-built binaries and is a clean choice for this; alternatively the planner may choose to render a minimal PNG manually.

**Primary recommendation:** Five discrete tasks in one wave — metadata update, `.vscodeignore` patch, icon generation, README rewrite, GitHub Actions workflow. All independent; can be planned as a single wave.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `publisher` field → `altium`
- **D-02:** `displayName` → `Altium 365 Developer Tools`
- **D-03:** Description covers the full v1 roadmap (workspace nav, local run/debug, remote script management)
- **D-04:** `categories` → `["Other"]` only
- **D-05:** Keywords include: `altium`, `altium365`, `a365`, `scripting`, `pcb`, `eda` (planner discretion on full list, ~6–8 terms)
- **D-06:** `README.md` — text-only, no screenshots; covers prerequisites, install, sign-in, local run/debug, environment switching; usable by an external developer now
- **D-07:** Icon at `resources/icon.png`, 128×128 PNG, monochrome, VS Code dark-theme compatible, inspired by Altium 365 brand mark; set `"icon": "resources/icon.png"` in `package.json`
- **D-08:** CI triggers on push to `main` only (no PR trigger for packaging pipeline)
- **D-09:** Pipeline steps: `npm ci` → `npm run compile` → `npm run package` → upload VSIX artifact
- **D-10:** Node.js 18
- **D-11:** `npm run package` script → `vsce package`
- **D-12:** `@vscode/vsce` added as devDependency

### Agent's Discretion
- Exact keywords list (keep ~6–8)
- VSIX artifact retention period (GitHub Actions default ~90 days is fine)
- Version field: stay at `0.0.2` or bump to `0.1.0`

### Deferred Ideas
None.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PKG-01 | `vsce package` produces an installable `.vsix` file | `@vscode/vsce` 3.9.1 confirmed; all required `package.json` fields documented below |
| PKG-02 | Single npm script (`npm run package`) compiles and packages in one step | `vscode:prepublish` hook already present; `vsce package` invokes it automatically |
| PKG-03 | `package.json` has Marketplace-ready metadata: icon, description, categories, keywords, publisher | All fields documented in Standard Stack section; exact current values mapped to required changes |
| PKG-04 | `README.md` has install instructions and feature overview | Current README is developer-internal; needs full rewrite to external-developer audience |
| PKG-05 | GitHub Actions CI: compile → package → upload VSIX artifact | `actions/upload-artifact@v4` is current; workflow skeleton provided in Code Examples |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| VSIX packaging | Build tooling | — | `vsce` reads `package.json` + `out/` and zips per `.vscodeignore` rules |
| Icon asset | Static resource | — | 128×128 PNG; committed to `resources/`; referenced in `package.json` |
| CI pipeline | GitHub Actions | — | Triggers on push to main; delegates to npm scripts |
| README | Documentation | — | Markdown file at repo root; consumed by Marketplace and VS Code extension panel |
| npm script | package.json scripts | vsce | `npm run package` → `vsce package` → invokes `vscode:prepublish` → tsc → VSIX |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@vscode/vsce` | 3.9.1 | Package and publish VS Code extensions | Official Microsoft tool; the only supported packaging path for VSIX |

**Version verification:**
```bash
npm view @vscode/vsce version   # → 3.9.1 (published 2026-04-17) ✓
```

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `actions/checkout` | v4 | GitHub Actions: checkout repo | Standard in every GH Actions workflow |
| `actions/setup-node` | v4 | GitHub Actions: install Node.js | Use to pin Node 18 |
| `actions/upload-artifact` | v4 | GitHub Actions: upload VSIX | Current major version (v3 is deprecated) |

**Installation:**
```bash
npm install --save-dev @vscode/vsce
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Disposition |
|---------|----------|-----|-----------|-------------|-------------|
| `@vscode/vsce` | npm | 10+ yrs (as `vsce`) | ~1M+/wk | github.com/microsoft/vscode-vsce | Approved — official Microsoft package |

**Packages removed:** none  
**Packages flagged:** none

---

## Architecture Patterns

### How `vsce package` works

1. Reads `package.json` — validates required fields: `name`, `version`, `publisher`, `engines.vscode`, `main`, `description`
2. Calls `vscode:prepublish` script if present (already: `npm run compile`)
3. Walks the directory tree, excluding paths matching `.vscodeignore` rules
4. Produces `{name}-{version}.vsix` in the project root

**Key behavior:** `vsce package` calls `vscode:prepublish` internally. The `npm run package` script therefore only needs `vsce package` — no need to chain `npm run compile &&`.

### npm script wiring

```json
"scripts": {
  "vscode:prepublish": "npm run compile",
  "compile": "tsc -p ./",
  "watch": "tsc -watch -p ./",
  "package": "vsce package"
}
```

### `.vscodeignore` — what to exclude

Current file excludes: `.vscode/**`, `.vscode-test/**`, `src/**`, `.gitignore`, `tsconfig.json`, `**/*.map`, `**/*.ts`, `node_modules/**`

**Missing exclusions that must be added:**
```
.planning/**
AGENTS.md
.git/**
```

**Do NOT exclude:**
- `out/**` — compiled JS output, required at runtime
- `python/**` — `_runner.py` and `a365.py` are bundled and needed at runtime
- `resources/**` — will contain icon.png

### Icon generation

`resources/icon.png` must be 128×128 PNG. No image editor is available in this environment. Options (in order of preference for this phase):

1. **Inline raw PNG construction** — Write a Node.js script (`scripts/generate-icon.js`) that builds a valid PNG using only `Buffer` and the PNG binary format. No new dependencies. Produces a simple monochrome geometric shape inspired by the A365 brand mark.

2. **`sharp` devDependency** — Add `sharp` (pre-built native binaries, no compilation needed on macOS/Linux/Windows x64). Allows SVG→PNG rasterization. Adds ~5 MB to devDependencies but zero to the VSIX (devDep, excluded by vsce). `[ASSUMED]` — slopcheck not run; verify before installing.

3. **Manual creation** — Commit a pre-generated icon PNG directly. Simplest if the agent can produce binary output via base64 decode.

**Recommended:** Inline Node.js PNG writer (option 1) — zero new dependencies, deterministic, keeps the plan self-contained. The planner should specify this approach explicitly so the executor doesn't need to make this decision.

### GitHub Actions workflow structure

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run compile
      - run: npm run package
      - uses: actions/upload-artifact@v4
        with:
          name: altium365-vsix
          path: '*.vsix'
```

**Note:** `npm run compile` is listed explicitly in D-09 even though `vsce package` calls `vscode:prepublish`. Including it separately ensures the CI step fails fast (before vsce runs) if tsc has errors.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VSIX creation | Custom zip + manifest | `@vscode/vsce` | Extension manifest validation, signing, Marketplace compatibility |
| `.vscodeignore` glob handling | Custom file filter | vsce's built-in .vscodeignore parser | Handles negation patterns, symlinks, edge cases |
| Artifact upload in CI | Custom S3/GCS upload | `actions/upload-artifact@v4` | Retention, download UI, PR comments — all built in |

---

## Common Pitfalls

### Pitfall 1: `vsce` requires `repository` or `--allow-missing-repository`
**What goes wrong:** `vsce package` exits with error if `package.json` has no `repository` field.  
**Why it happens:** vsce validates Marketplace publishing fields even for local packaging.  
**How to avoid:** Add `"repository": {"type": "git", "url": "..."}` to `package.json`, or pass `--allow-missing-repository` flag in the package script.  
**Warning signs:** `Error: Missing publisher name` or `A 'repository' field is missing` during `npm run package`.

### Pitfall 2: Icon path must be relative, file must exist before `vsce package`
**What goes wrong:** `vsce package` fails with "icon not found" if `resources/icon.png` doesn't exist or the path in `package.json` is wrong.  
**Why it happens:** vsce validates the icon file at package time.  
**How to avoid:** Ensure `resources/icon.png` is committed and `package.json` has `"icon": "resources/icon.png"` (no leading `./`).

### Pitfall 3: `.planning/` bloats the VSIX
**What goes wrong:** `.planning/` directory (large markdown tree) ends up bundled in the VSIX if `.vscodeignore` doesn't exclude it.  
**How to avoid:** Add `.planning/**` to `.vscodeignore` before running `npm run package`.

### Pitfall 4: `actions/upload-artifact@v3` is deprecated
**What goes wrong:** Workflows using v3 get deprecation warnings; v3 may stop working.  
**How to avoid:** Use `actions/upload-artifact@v4` in the workflow.

### Pitfall 5: `npm run compile` vs `vscode:prepublish` double-compilation
**What goes wrong:** CI runs `npm run compile` then `npm run package` (which also calls `vscode:prepublish` = `npm run compile`). This is harmless but wastes ~5s.  
**How to avoid:** Acceptable for MVP. Can optimize later by passing `--no-dependencies` or skipping the explicit compile step. Do not optimize in Phase 1.

---

## Code Examples

### Minimal `.vscodeignore` additions
```
# Existing entries preserved; add:
.planning/**
AGENTS.md
.git/**
scripts/**
```

### `package.json` diff (key fields only)
```json
{
  "name": "altium365-scripting",
  "displayName": "Altium 365 Developer Tools",
  "description": "Browse Altium 365 workspaces, run Python scripts locally with live API access, and manage remote scripts — without leaving VS Code.",
  "version": "0.1.0",
  "publisher": "altium",
  "icon": "resources/icon.png",
  "keywords": ["altium", "altium365", "a365", "scripting", "pcb", "eda", "electronics"],
  "categories": ["Other"],
  "repository": {
    "type": "git",
    "url": "https://github.com/altium/a365-vscode-extension"
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "typescript": "^5.4.0",
    "@vscode/vsce": "^3.9.1"
  }
}
```

### Inline PNG icon generation (Node.js, zero dependencies)
```js
// scripts/generate-icon.js
// Produces a 128×128 monochrome PNG — no npm dependencies
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createMonochromePng(width, height, drawFn) {
  // drawFn(x, y) → boolean (true = foreground pixel)
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const fg = drawFn(x, y);
      pixels[i] = fg ? 220 : 0;      // R
      pixels[i+1] = fg ? 220 : 0;    // G
      pixels[i+2] = fg ? 220 : 0;    // B
      pixels[i+3] = fg ? 255 : 0;    // A (transparent background)
    }
  }
  // Build raw PNG (IHDR + IDAT + IEND)
  // ... (full implementation in the plan)
}
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `repository` field is required or `--allow-missing-repository` needed for vsce package | Pitfall 1 | Package step fails in CI; easy to fix |
| A2 | `sharp` has pre-built binaries for ubuntu-latest (GitHub Actions runner) | Architecture Patterns | Icon generation script fails; use fallback raw PNG approach |
| A3 | Version bump to `0.1.0` is appropriate for first packageable build | package.json diff | Cosmetic only; no functional impact |

---

## Open Questions

1. **`repository` URL** — What is the actual GitHub repo URL for this extension? The planner should either use the real URL or add `--allow-missing-repository` to the `package` script. Recommendation: add the flag to avoid blocking on an unknown URL.

2. **Icon rendering approach** — The user wants a brand-inspired icon. A raw PNG writer can produce geometric shapes but cannot faithfully render the A365 brand mark. Recommendation: produce a simple, recognizable monochrome icon (circle + circuit node pattern) and note that it can be replaced by a designer later.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm ci, compile, package | ✓ | ≥18 (confirmed in package.json engines) | — |
| npm | npm ci | ✓ | bundled with Node | — |
| tsc | npm run compile | ✓ | 5.4.x (devDep) | — |
| `@vscode/vsce` | npm run package | ✗ (not yet installed) | 3.9.1 on registry | — (must install) |
| GitHub Actions runners | CI workflow | ✓ | ubuntu-latest | — |

---

## Validation Architecture

Nyquist validation is lightweight for this phase — it is pure infrastructure, no TypeScript logic changes. The primary validation is: does `npm run package` succeed and produce a `.vsix`?

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Manual smoke test (no unit tests for packaging) |
| Config file | none |
| Quick run command | `npm run package && ls *.vsix` |
| Full suite command | `npm run compile && npm run package && ls *.vsix` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PKG-01 | VSIX file produced | smoke | `npm run package && ls *.vsix` | N/A |
| PKG-02 | Single command compiles and packages | smoke | `npm run package` succeeds from clean | N/A |
| PKG-03 | Metadata fields present in package.json | static | `cat package.json \| grep -E '"publisher"\|"icon"\|"keywords"'` | N/A |
| PKG-04 | README covers all required topics | manual review | — | ✅ (needs rewrite) |
| PKG-05 | CI workflow file exists and is valid YAML | static | `cat .github/workflows/ci.yml` | ❌ Wave 0 |

### Wave 0 Gaps
- [ ] `.github/workflows/ci.yml` — must be created (PKG-05)
- [ ] `resources/icon.png` — must be created (PKG-03)

---

## Security Domain

No security-sensitive changes in this phase. The packaging pipeline does not handle secrets, tokens, or user input. The CI workflow uses only official GitHub Actions (`actions/*`) from the verified GitHub namespace — no third-party actions that could exfiltrate secrets.

**ASVS:** Not applicable to this phase (no auth, no input handling, no crypto).

---

## Sources

### Primary (HIGH confidence)
- `package.json` — read directly from repo; all current field values verified
- `.vscodeignore` — read directly from repo; current exclusions confirmed
- `npm view @vscode/vsce version` — 3.9.1, published 2026-04-17 [VERIFIED: npm registry via CLI]

### Secondary (MEDIUM confidence)
- `actions/upload-artifact@v4` — current major version [ASSUMED: training knowledge; verify at github.com/actions/upload-artifact]
- `actions/setup-node@v4` — current major version [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — @vscode/vsce version verified via npm CLI
- Architecture: HIGH — all patterns derived from reading actual repo files
- Pitfalls: MEDIUM — vsce behavior from training knowledge; `repository` requirement [ASSUMED]

**Research date:** 2026-05-19  
**Valid until:** 2026-07-19 (vsce releases infrequently)
