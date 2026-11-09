# OpenWA Pilot Ingress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first independently testable increment: signed OpenWA message ingestion and a read-only, branch-scoped inbox for a manually mapped pilot session.

**Architecture:** The OpenWA v0.29.1 Baileys gateway runs separately; its session UUID is mapped to an active sales user by a super admin. A signed webhook verifies raw bytes before parsing, persists individual inbound texts idempotently in PostgreSQL, and the authenticated API exposes scoped conversation/message reads. No outgoing message or automatic reply.

**Tech Stack:** Existing Fastify, PostgreSQL, React, Vitest; OpenWA v0.29.1 API/webhook contract.

**Spec:** Internal PRD "WhatsApp AI Chatbot untuk Tim Sales" (not included in this repository), FR-02, FR-10, FR-60; https://github.com/rmyndharis/OpenWA/blob/v0.29.1/docs/06-api-specification.md §6.6.

## Global Constraints

- One manually linked pilot sales number only; no real QR until gateway lifecycle can be tested; do not auto-send or auto-connect personal numbers.
- Session credentials remain with OpenWA, which must be privately deployed and separately backed up; API key and HMAC secret only server-side.
- Every list/detail query must enforce sales ownership or branch scope at the SQL layer; inactive sales cannot ingest.
- Reject unsigned/invalid HMAC, unknown sessions, group/status/broadcast, fromMe and non-text events; do not persist raw webhook payload/media.
- Avoid modifying the existing untracked prototype assets except files explicitly in this plan.

## Review Focus

- Webhook raw bytes vs JSON reserialization: signature must bind the exact bytes received.
- Unknown mapped session must never write another user's inbox; OpenWA v0.29.1 does not send a session-ID header.
- Repeated delivery (different delivery IDs) of same message must make one message.
- Cross-branch conversation ID guessing must return 404, not data.
- Unexpected media/base64 and group payload must not be stored.

---

### Task 1: Persistent inbox and signed ingress

**Files:** `server/migrations/002_pilot_inbox.sql`, `server/migrate.ts`, `server/openwa.ts`, `server/openwa.test.ts`, `server/app.ts`, `server/app.test.ts`.

**Interfaces:** `registerOpenWaRoutes(app, db, actor)` adds `POST /api/hooks/openwa`, `GET /api/wa-sessions`, `POST /api/wa-sessions/link`, `GET /api/conversations`, `GET /api/conversations/:id/messages`; `verifyOpenWaSignature(raw, signature, secret)` constant-time checks HMAC.

- [x] Write integration tests for signature rejection, foreign Origin exception only for signed hook, no mapping, idempotency, filters, and role-scoped listing/details.
- [x] Run targeted tests and witness failure.
- [x] Add idempotent migration and route module; modify migration runner to apply both migrations.
- [x] Run targeted tests and full tests.

### Task 2: Read-only pilot inbox UI and operations

**Files:** `src/SecureApp.tsx`, `src/styles.css`, `.env.example`, `README.md`, `docker-compose.yml`.

- [x] Write a UI/API integration check for read-only conversations (or API-client test if UI harness unavailable), witness failure.
- [x] Show read-only inbox with message history and clear no-send status, plus super-admin-only manual session mapping UI or documented mapping workflow.
- [x] Document isolated gateway v0.29.1 setup, webhook secret, no public port, consent and limitations; run full tests/build.
