# Backend and Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working PostgreSQL-backed API with secure sign-in and enforced multi-branch access, while preserving the existing browser demo as explicitly separate.

**Architecture:** Fastify server with SQL migrations and PostgreSQL repository. HttpOnly opaque sessions stored as SHA-256 hashes in database; server endpoints enforce roles and branch ownership. Vite proxy forwards `/api` to server; authenticated frontend is a separate live workspace with only supported flows, not the demo's simulated inbox.

**Tech Stack:** Node.js 22, TypeScript, Fastify, pg, argon2, Zod, Vitest, Docker Compose PostgreSQL.

**Spec:** Internal PRD "WhatsApp AI Chatbot untuk Tim Sales" (not included in this repository; FR-01 to FR-05 foundation only).

## Global Constraints

- Each sales belongs to exactly one branch; WhatsApp number unique across all branches.
- Super admin manages branches, admins, sales; branch admin manages sales only in their branch; sales only their own account.
- Passwords hashed with argon2; no login password or session token in logs or localStorage.
- Database is authoritative for roles and branch filtering; demo selector does not grant server permissions.
- No real WhatsApp, AI, RAG, push, inbox or follow-up APIs in this phase.

## Review Focus

- Existing/disabled user session must stop working after account deactivation.
- Branch admin cannot enumerate, create, or edit users in a different branch even by guessing IDs.
- Malformed input and duplicate email/phone return controlled 4xx, not 500.
- Login errors do not reveal whether email exists; repeated failures rate limited.
- State-changing cookie requests must be protected from cross-site origins.

---

### Task 1: Database and auth service

**Files:** `server/migrations/001_initial.sql`, `server/db.ts`, `server/auth.ts`, `server/auth.test.ts`, `docker-compose.yml`, `server/migrate.ts`, `server/bootstrap.ts`, `.env.example`.

**Interfaces:** `createSession(pool, userId)`, `lookupSession(pool, token)`, `destroySession(pool, token)`, `hashPassword`, `verifyPassword`, `scopedBranchIds(actor)`.

- [x] Write failing tests for password verification, opaque token hashing and actor branch scope.
- [x] Run targeted tests to witness failure.
- [x] Implement SQL schema, auth primitives and bootstrap via environment variable, then pass tests.

### Task 2: API and access tests

**Files:** `server/app.ts`, `server/index.ts`, `server/app.test.ts`, `vite.config.ts`, `package.json`.

**Interfaces:** `buildServer(pool)` supplies `/api/auth/login|logout|me`, `/api/branches`, `/api/users`, `/api/health`.

- [x] Write failing HTTP tests exercising login, session revocation, role scoping, cross-branch rejection and input validation.
- [x] Run tests to witness failure.
- [x] Implement endpoints, audit writes, origin checks and per-IP login throttle; run suite.

### Task 3: Secure workspace and documentation

**Files:** `src/SecureApp.tsx`, `src/main.tsx`, `src/styles.css`, `README.md`, `.gitignore`.

- [x] Write failing tests for API client credentials and auth state (if code is testable in isolation).
- [x] Implement login/logout and branch/user management in live mode; demo remains available only when API mode not enabled.
- [x] Run all tests, build, and document local setup plus remaining PRD gaps.
