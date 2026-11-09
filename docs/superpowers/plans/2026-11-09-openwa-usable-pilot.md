# OpenWA Usable Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One consenting sales account can link its own phone via QR, read inbound messages, send manual replies, disconnect, and remove expired chats in a locally operated OpenWA pilot.

**Architecture:** A server-only OpenWA HTTP adapter owns API credentials. The backend provisions and verifies sessions; webhook subscription is configured per session, authenticated by existing raw-body HMAC ingress. Session operations authorize sales ownership in SQL and check the gateway-reported phone before sends. A daily cleanup job removes unpinned conversations after seven days. UI polls status and inbox rather than holding privileged gateway credentials.

**Tech Stack:** Existing Fastify/pg/React/Vitest, OpenWA 0.29.1 with `ENGINE_TYPE=baileys`.

**Spec:** Internal PRD "WhatsApp AI Chatbot untuk Tim Sales" (not included in this repository), FR-10/11/13/60/61/65. Gateway API contract: https://github.com/rmyndharis/OpenWA/blob/v0.29.1/docs/06-api-specification.md.

## Global Constraints

- No automatic reply, blast, follow-up, or AI send; number owner must consent before linking unofficial client.
- API key and webhook secret only on server; never in frontend, URLs, logs, or Git.
- Only owner sales may send; super admin may inspect but not send as sales.
- Outbound gateway 201 means accepted, not delivered; network timeout/5xx is outcome-unknown, never blindly replay.
- No pretense that unit tests replace real phone/QR/reconnect tests; report remaining validation.

## Review Focus

- Wrong gateway-reported phone: block send and report mismatched identity; never assume manual mapping establishes phone ownership.
- Cross-branch guessed conversation ID: no access to send; no action to another sales session.
- Missing gateway key, upstream timeout or invalid response: bounded failure without leaking secrets or replaying sends.
- Webhook retries and self-sent echo: avoid duplicate outbound history.
- Seven-day deletion must spare pinned chats and keep only minimal aggregate/audit data.

---

### Task 1: Gateway client and lifecycle

**Files:** Create `server/openwa-client.ts`, `server/openwa-client.test.ts`; modify `server/openwa.ts`, `server/app.test.ts`, `.env.example`, `docker-compose.openwa.yml`.

**Interfaces:** `OpenWaClient` with `createSession`, `startSession`, `getSession`, `getQr`, `addWebhook`, `sendText`, `logoutSession`; `registerOpenWaRoutes` accepts injected client.

- [x] Write failing contract/client and route tests for create/start/QR/status, sales isolation and phone mismatch.
- [x] Witness red; implement minimal adapter and routes; run targeted suite.

### Task 2: Outbound reply, retention, and UI

**Files:** Create `server/migrations/003_outbound.sql`, `server/retention.ts`, `server/retention.test.ts`; modify `server/migrate.ts`, `server/openwa.ts`, `server/index.ts`, `src/SecureApp.tsx`, `src/PilotInbox.tsx`, `src/styles.css`, `README.md`.

- [x] Write failing tests for owner-only send, accepted-vs-delivered, wrong phone, upstream failures, retention (seven days, pinned exception) and UI controls.
- [x] Witness red; implement with server-side validation, polling, manual send only; run suite/build and validate gateway compose.
- [x] Document operating procedure and manual on-phone test checklist; report actual validation results separately.

**Verification note:** Tests use a mocked gateway and a separate PostgreSQL test database. The image boots and `/api/health` responds in a throwaway container without linking a phone. Real QR pairing, webhook delivery across the complete Compose stack, session recovery and customer delivery remain manual pilot gates; never conflate these with mocked coverage.
