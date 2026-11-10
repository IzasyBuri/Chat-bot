# Pilot Readiness Design

## Intent

Prepare the existing local WhatsApp sales pilot for a controlled one-number trial without weakening its current consent, branch isolation, or manual-send constraints.

## Goals

- Prevent stale phone ownership from accepting webhook messages.
- Keep gateway provisioning recoverable when either PostgreSQL or OpenWA fails.
- Return the newest 200 conversation messages in chronological display order.
- Enforce one 32-character minimum webhook-secret policy.
- Make every pull request run lint, type checking, all 43 tests with PostgreSQL, build, and dependency audit.
- Add baseline HTTP headers, strict origin configuration, useful server logging, expired-session cleanup, and accurate live UI copy.

## Non-goals

- Enable AI replies, broadcasts, automatic follow-up, or production deployment.
- Connect a real WhatsApp number during implementation.
- Add Redis before the application runs more than one API instance.
- Replace PostgreSQL or the OpenWA gateway.

## Constraints

- Node.js 22, npm lockfile, TypeScript strict mode, Fastify 5, React 19, PostgreSQL 16.
- Real customer data and real gateway credentials must not enter tests or CI.
- SQL remains parameterized and integration tests use a database whose name ends in `_test`.
- Webhook HMAC is calculated over exact raw bytes.
- Only the owning sales user may pair and send; branch authorization remains server-side.
- Each phase must leave `npm test` and `npm run build` green.

## Approaches

### Chosen: three sequential, reviewable changes

1. Correctness and webhook ownership.
2. Dependency/tooling upgrade and enforced CI.
3. HTTP, operations, container, and live-UI hardening.

This isolates the risky OpenWA state change from the Vitest major upgrade and from infrastructure changes. A reviewer can reject or revert one phase without undoing the others.

### Rejected: one large readiness change

Faster to write, but combines gateway state, dependency graph, workflow YAML, and UI changes into a diff that is difficult to review or bisect.

### Rejected: connect OpenWA first and harden afterward

This creates real external sessions before stale ownership and partial-provisioning behavior are pinned by tests.

## Design

### Gateway provisioning

Represent provisioning explicitly in PostgreSQL rather than holding a database transaction open across gateway HTTP calls. A sales account reserves one provisioning record, gateway work occurs outside a transaction, and a short final transaction activates the session. Failures record a safe failed state and invoke the gateway's supported cleanup operation when available. Retrying resumes or replaces only that sales account's failed provision.

### Webhook ownership

Store the phone value verified against the ready gateway session. A message event must identify the same destination phone before it can be stored. A mismatch clears verification and stores no message.

### Message window

Select the newest 200 rows using descending time/id ordering in an inner query, then return that window in ascending display order.

### CI

GitHub Actions provisions PostgreSQL 16, runs migrations through the integration suite, and fails if integration tests are skipped. Dependency installation uses the committed lockfile. Lint, typecheck, tests, build, and high-severity audit are required checks.

### HTTP and operations

Fastify emits baseline security headers, write origins come only from an explicit allowlist, and structured logs include request IDs without secrets or message bodies. Expired sessions are deleted periodically. Rate limiting remains in-process and the deployment is explicitly single-instance until a shared store is introduced.

## Success Criteria

- Tests reproduce and prevent stale-phone ingestion, partial provisioning, weak secrets, and stale message windows.
- CI runs all integration tests instead of reporting skips.
- Full dependency audit has no unmitigated high or critical findings.
- Anonymous startup, login, branch creation, sales creation, role scoping, and logout pass in browser smoke testing.
- No real WhatsApp session or customer message is used.
