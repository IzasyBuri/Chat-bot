# Dependencies and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove known high/critical development vulnerabilities and enforce repeatable repository quality gates on every change.

**Architecture:** Upgrade one direct dependency at a time, then add explicit package scripts and a GitHub Actions workflow backed by PostgreSQL 16. CI must prove all integration tests ran rather than accepting skipped tests.

**Tech Stack:** npm, Vitest, TypeScript, ESLint, GitHub Actions, PostgreSQL 16

**Spec:** `docs/superpowers/specs/2026-11-10-pilot-readiness-design.md`

## Global Constraints

- Use `package-lock.json`; never use forced audit remediation.
- Keep Node.js 22 and pin the npm package manager version in `package.json`.
- CI uses throwaway credentials and a database ending in `_test`.
- Dependency upgrades remain separate from application behavior changes.

## Review Focus

- Vitest major-version behavior changes do not silently skip integration tests; test in Task 1.
- CI fails when PostgreSQL is unavailable instead of reporting partial success; test in Task 3.
- Lifecycle scripts are minimized and documented; verify in Task 1.
- Lint configuration does not disable security-relevant rules to obtain green output; verify in Task 2.
- Pull requests cannot pass with high/critical audit findings; verify in Task 3.

---

### Task 1: Upgrade Vitest safely

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify only if required by documented migration: `vite.config.ts`, test files

**Interfaces:**
- Produces: a supported Vitest release with no known high/critical audit path

- [ ] **Step 1: Capture the baseline**

Run: `npm test`

Run: `npm audit --json`

- [ ] **Step 2: Read the Vitest migration notes for the selected supported release**

Document required config changes in the commit body; upgrade only Vitest and lockfile dependencies pulled by it.

- [ ] **Step 3: Install the selected version without forced remediation**

Run: `npm install --save-dev vitest@<reviewed-version>`

- [ ] **Step 4: Verify tests, build, lockfile diff, and audit**

Run: `npm test`

Run: `npm run build`

Run: `npm audit --json`

- [ ] **Step 5: Commit**

Commit: `chore: upgrade vitest safely`

### Task 2: Add local quality scripts

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify source only for real lint findings, without suppression comments

**Interfaces:**
- Produces scripts: `lint`, `typecheck`, `test:integration`, `verify`

- [ ] **Step 1: Add the minimum maintained TypeScript/React ESLint dependencies**

Prefer flat config and avoid a formatter dependency unless formatting is separately adopted.

- [ ] **Step 2: Add scripts with explicit responsibilities**

`typecheck` runs `tsc -b`; `test:integration` requires `TEST_DATABASE_URL`; `verify` runs lint, typecheck, tests, and build.

- [ ] **Step 3: Run lint and fix actual findings**

Run: `npm run lint`

- [ ] **Step 4: Run the local verification chain**

Run: `npm run verify`

- [ ] **Step 5: Commit**

Commit: `chore: add repository quality scripts`

### Task 3: Add PostgreSQL-backed GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Modify: `README.md`

**Interfaces:**
- Produces required jobs: `quality`, `integration`, `security`

- [ ] **Step 1: Add a PostgreSQL 16 service and integration job**

Use a `_test` database, health check it, run all tests with `TEST_DATABASE_URL`, and assert the Vitest summary contains no skipped integration file.

- [ ] **Step 2: Add quality and security jobs**

Quality runs lockfile install, lint, typecheck, and build. Security runs `npm audit --audit-level=high`. Cache npm's download cache, not `node_modules`.

- [ ] **Step 3: Add weekly Dependabot configuration**

Limit open npm update PRs and keep dependency changes reviewable.

- [ ] **Step 4: Validate workflow syntax and reproduce commands locally**

Run every command from the workflow locally against the isolated test database.

- [ ] **Step 5: Document branch-protection requirements**

README must name the checks that repository settings should require before merge.

- [ ] **Step 6: Commit**

Commit: `ci: enforce PostgreSQL quality gates`
