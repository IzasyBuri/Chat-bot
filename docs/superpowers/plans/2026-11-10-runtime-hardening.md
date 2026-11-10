# Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-safe HTTP defaults, diagnosable operations, bounded session storage, and accurate live-mode behavior before public deployment.

**Architecture:** Centralize validated runtime configuration, register security/logging controls at server construction, and run bounded cleanup through existing startup scheduling. Keep the pilot single-instance until a shared rate-limit store is deliberately introduced.

**Tech Stack:** Fastify 5, PostgreSQL 16, React 19, Docker Compose

**Spec:** `docs/superpowers/specs/2026-11-10-pilot-readiness-design.md`

## Global Constraints

- Never log passwords, cookies, API keys, webhook signatures, phone numbers, or message bodies.
- Production requires HTTPS cookies and explicit application origins.
- Keep local development on loopback and keep OpenWA off the public host network.
- Do not add Redis while deployment remains one API instance.

## Review Focus

- Proxy-supplied Host headers cannot authorize a foreign write Origin; test in Task 1.
- Security headers remain present on success and error responses; test in Task 1.
- Logs redact authorization, cookie, and message content; test in Task 2.
- Cleanup deletes expired sessions without deleting active sessions; test in Task 2.
- Container health reflects database/API readiness and not merely process existence; test in Task 3.

---

### Task 1: Validate configuration and harden HTTP responses

**Files:**
- Create: `server/config.ts`
- Modify: `server/index.ts`
- Modify: `server/app.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `server/app.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): RuntimeConfig`
- `RuntimeConfig` includes explicit `appOrigins: string[]`, cookie policy, gateway URL, and 32-character webhook secret

- [ ] **Step 1: Write failing configuration and origin tests**

Assert production rejects missing origins/insecure cookies/short secrets; foreign Origin remains forbidden even when Host matches it; configured origins pass.

- [ ] **Step 2: Write failing header tests**

Assert CSP, frame protection, MIME protection, and referrer policy on health, authentication error, and normal API responses.

- [ ] **Step 3: Implement validated config and register the maintained Fastify helmet plugin**

Pass config into server construction instead of reading mutable environment values throughout request handlers.

- [ ] **Step 4: Run focused tests and build**

Run: `npm test -- server/app.test.ts`

Run: `npm run build`

- [ ] **Step 5: Commit**

Commit: `feat: harden API configuration and headers`

### Task 2: Add structured logging and expired-session cleanup

**Files:**
- Modify: `server/app.ts`
- Modify: `server/auth.ts`
- Modify: `server/index.ts`
- Modify: `server/retention.ts`
- Test: `server/auth.test.ts`
- Test: `server/app.test.ts`

**Interfaces:**
- Produces: `reapExpiredSessions(pool: Pool): Promise<number>`
- Logs include request ID, route, status, duration, and safe error class

- [ ] **Step 1: Write failing session-cleanup tests**

Insert expired and active sessions, run cleanup, and assert only expired rows are removed.

- [ ] **Step 2: Write a logging-redaction test**

Exercise login failure and gateway failure; assert captured logs omit passwords, cookie values, API keys, phone numbers, and message bodies.

- [ ] **Step 3: Implement cleanup and schedule it with retention**

Use one bounded SQL delete and log only counts and failure class.

- [ ] **Step 4: Enable structured Fastify logging with redaction**

Keep test logging injectable or disabled without changing production behavior.

- [ ] **Step 5: Run all tests**

Run: `npm test`

- [ ] **Step 6: Commit**

Commit: `feat: add safe operational logging and session cleanup`

### Task 3: Align containers and live UI with actual readiness

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Dockerfile.api`
- Modify: `src/SecureApp.tsx`
- Modify: `index.html` or create a local favicon asset
- Modify: `README.md`
- Test: relevant frontend tests and Compose validation

**Interfaces:**
- Produces API healthcheck on `/api/health`
- Documents single-instance in-memory rate limiting

- [ ] **Step 1: Add API healthcheck and tighten container startup**

Ensure Compose waits for database health and reports API readiness. Keep host ports loopback-only and gateway network internal.

- [ ] **Step 2: Correct live-mode copy and counts**

Remove claims that Inbox is unavailable; source WhatsApp session count/status from the existing API or label it explicitly as not loaded rather than hard-coding zero.

- [ ] **Step 3: Add a local favicon and browser smoke assertions**

Verify no favicon 404, anonymous login renders, and authenticated desktop/mobile views have no horizontal overflow.

- [ ] **Step 4: Validate runtime artifacts**

Run: `docker compose config --quiet`

Run: `docker build -f Dockerfile.api .`

Run: `npm run verify`

- [ ] **Step 5: Commit**

Commit: `chore: align runtime readiness and live UI`
