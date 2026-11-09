# Sales Chatbot Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a usable Indonesian-language browser prototype for the PRD's sales operations workflows without pretending that WhatsApp, AI, or a server is connected.

**Architecture:** Vite/React/TypeScript SPA with local browser persistence. Domain rules are pure functions, while screens share one app state store. Demo data is explicitly identified and can be reset. External integrations remain unavailable until a secure backend is built.

**Tech Stack:** React, TypeScript, Vite, Vitest, Lucide icons, CSS.

**Spec:** Internal PRD "WhatsApp AI Chatbot untuk Tim Sales" (not included in this repository; prototype is deliberately narrower than production scope).

## Global Constraints

- UI in Bahasa Indonesia, responsive; roles super admin, admin cabang, sales.
- Bot eligibility: new contacts or whitelisted, never existing unlisted contacts; OFF and handover override eligibility.
- Follow-up default two sends, 24 and 72 hours, maximum five; stop on customer reply or handover.
- Retention seven days unless saved permanently; sales owner or super admin only may delete/save.
- No simulated QR or provider response represented as a genuine connected service.

## Review Focus

- Contact lama tanpa whitelist tidak dibalas bot: eligibility test.
- Bot OFF/handover override whitelist: eligibility test.
- Cabang admin cannot remove another branch's data: access test.
- Retention exemption and permission boundary: retention test.
- Follow-up capped at five: follow-up test.

---

### Task 1: Domain rules and tests

**Files:** Create `src/domain.ts`, `src/domain.test.ts`, `package.json`, `tsconfig.json`, `vite.config.ts`.

**Interfaces:** `canBotReply(conversation): boolean`, `canManageConversation(role, ownerId, actorId): boolean`, `nextFollowup(rule, conversation): number | null`, `isExpired(conversation, now): boolean`.

- [ ] Write tests for new, whitelisted, old, OFF, handover, permissions, retention and follow-up cap.
- [ ] Run `npm test` and observe expected missing-module failure.
- [ ] Implement pure functions and run `npm test` to green.

### Task 2: Operational app screens

**Files:** Create `src/App.tsx`, `src/main.tsx`, `src/data.ts`, `index.html`.

**Interfaces:** Local state initialized from `src/data.ts`, persisted in localStorage; screens Dashboard, Inbox, Sales, Knowledge Base, Cabang, Pengaturan.

- [ ] Render demo-data state and empty states, role selector, branch scope, search/filter, inbox detail and composer.
- [ ] Wire bot toggle, handover, lead label, save/delete, sample inbound message, FAQ CRUD, sales/branch CRUD, settings and follow-up form.
- [ ] Verify build and interaction in browser where possible.

### Task 3: Visual finish and handoff

**Files:** Create `src/tokens.css`, `src/styles.css`, `README.md`.

- [ ] Apply Hallmark Coral app-screen system, focus states, responsive layout and clear prototype labeling.
- [ ] Run `npm test`, `npm run build`, and Hallmark sloplint; fix blockers.
- [ ] Document run instructions and precise limits (no production auth, WhatsApp, AI, RAG, push, backend).

## Scope gap to production PRD

Baileys sessions, encrypted credentials, auth/RBAC enforcement, backend/database, Redis queues, LLM adapters, document ingestion, Sheets OAuth, notifications and actual automated sending require a later backend implementation; this prototype must not claim them.
