# OpenWA Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gateway provisioning recoverable and ensure only messages for the currently verified sales phone enter the inbox.

**Architecture:** Persist provisioning state before external work, perform gateway calls outside database transactions, and activate a session in a short transaction. Bind each accepted webhook to the verified destination phone and fix the bounded message query.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL 16, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-11-10-pilot-readiness-design.md`

## Global Constraints

- No real gateway credentials, QR pairing, or customer data.
- Preserve raw-body HMAC verification and server-side branch authorization.
- PostgreSQL integration tests use a database ending in `_test`.
- Keep each gateway HTTP call outside an open PostgreSQL transaction.

## Review Focus

- Two concurrent connect requests for one sales user produce one active provision; test in Task 3.
- Gateway success followed by database failure leaves a retryable failed provision; test in Task 3.
- A signed event for a different destination phone stores nothing and clears verification; test in Task 2.
- Equal message timestamps still produce a deterministic newest-200 window; test in Task 1.
- A 16-character secret is rejected while a 32-character secret is accepted; test in Task 2.

---

### Task 1: Return the newest message window

**Files:**
- Modify: `server/openwa.ts:143-153`
- Test: `server/app.test.ts`

**Interfaces:**
- Consumes: existing `GET /api/conversations/:id/messages`
- Produces: at most 200 newest messages, returned oldest-to-newest within that window

- [ ] **Step 1: Write a failing integration test**

Add `returns the newest 200 messages in chronological display order`. Insert 201 messages with deterministic `sent_at` and IDs, request history as the owner, assert length `200`, the first old message is excluded, and returned order is ascending.

- [ ] **Step 2: Run the focused test and verify the oldest message is incorrectly retained**

Run: `npm test -- server/app.test.ts -t "newest 200"`

- [ ] **Step 3: Implement the bounded query**

Use an inner query ordered by `sent_at DESC, id DESC LIMIT 200` and an outer query ordered by `sent_at ASC, id ASC`.

- [ ] **Step 4: Run the focused test and full integration file**

Run: `npm test -- server/app.test.ts`

- [ ] **Step 5: Commit**

Commit: `fix: return latest conversation messages`

### Task 2: Bind webhook events to the verified phone

**Files:**
- Create: `server/openwa-contract.ts`
- Modify: `server/openwa.ts:8-54,93-106`
- Create: `server/migrations/004_session_verification.sql`
- Modify: `server/migrate.ts`
- Test: `server/openwa.test.ts`
- Test: `server/app.test.ts`

**Interfaces:**
- Produces: `normalizeGatewayPhone(value: string): string | null`
- Produces: `WEBHOOK_SECRET_MIN_LENGTH = 32`
- Persists: `wa_sessions.verified_phone`

- [ ] **Step 1: Write failing unit tests for phone normalization and secret length**

Assert supported individual JIDs normalize to digits, malformed/group JIDs return `null`, 16-character secrets fail, and 32-character secrets pass.

- [ ] **Step 2: Run focused unit tests and verify failure**

Run: `npm test -- server/openwa.test.ts`

- [ ] **Step 3: Implement the contract helpers and migration**

Keep parsing independent of Fastify routes. Set `verified_phone` with `verified_at` only after a ready gateway session matches the user's configured phone.

- [ ] **Step 4: Write a failing integration test for a stale verified session**

Deliver a correctly signed event whose destination phone differs from `verified_phone`; assert no message is inserted and both verification fields are cleared.

- [ ] **Step 5: Enforce destination ownership in webhook ingestion**

Select `verified_phone` with the mapped session and reject mismatches before opening the insert transaction.

- [ ] **Step 6: Run unit and integration tests**

Run: `npm test -- server/openwa.test.ts server/app.test.ts`

- [ ] **Step 7: Commit**

Commit: `fix: bind webhook messages to verified phone`

### Task 3: Make session provisioning recoverable

**Files:**
- Create: `server/openwa-provisioning.ts`
- Create: `server/migrations/005_session_provisioning.sql`
- Modify: `server/migrate.ts`
- Modify: `server/openwa.ts:57-91`
- Modify: `server/openwa-client.ts`
- Test: `server/app.test.ts`
- Test: `server/openwa-client.test.ts`

**Interfaces:**
- Produces: `provisionSalesSession(db: Pool, gateway: GatewayClient, actor: Actor, config: WebhookConfig): Promise<{sessionId: string; created: boolean}>`
- Persists states: `provisioning | active | failed`
- Gateway cleanup interface must match the documented OpenWA 0.29.1 operation; do not invent an endpoint.

- [ ] **Step 1: Confirm the OpenWA 0.29.1 cleanup/retry contract from its pinned documentation**

Record the exact endpoint and semantics in a short comment above the adapter method. If no delete operation exists, use logout as best-effort compensation and retain the failed row for operator cleanup.

- [ ] **Step 2: Write failing integration tests for concurrency and partial failure**

Assert concurrent connects result in one active record; gateway failure records `failed`; retry can reach `active`; and no gateway call occurs while the test pool reports an open transaction.

- [ ] **Step 3: Add the provisioning-state migration**

Keep one unique record per sales user and retain operator-visible failure metadata without storing secrets.

- [ ] **Step 4: Implement provisioning orchestration outside transactions**

Separate short reservation/finalization queries from gateway calls. Keep audit insertion in the final successful transaction.

- [ ] **Step 5: Add adapter cleanup behavior and tests**

Verify API keys remain header-only and cleanup errors do not mask the original provisioning failure.

- [ ] **Step 6: Run all tests and build**

Run: `npm test`

Run: `npm run build`

- [ ] **Step 7: Commit**

Commit: `fix: make gateway provisioning recoverable`
