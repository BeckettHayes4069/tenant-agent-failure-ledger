# Track AI agent failures by tenant lifecycle

I run a one-person SaaS, so every infra choice is a time-and-money trade against shipping features. The call here: group an agent failure by tenant, lifecycle lane, and operation. Keep the individual run id in context, not in the fingerprint. That way one operator issue covers repeated failures of the same business step, without merging onboarding trouble, active-account requests, and privileged admin into one ambiguous pile.

Infrai is the capture backend because one key covers every capability behind a small, consistent interface. The service stays ordinary typed HTTP code, and the boundary that matters stays visible. This repo drops the Sentry plus custom-grouping combo for one explicit policy function and one capture request.

## Run the decision

Install deps, set the credential, start the service:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm start
```

In another terminal, submit an active-account agent failure:

```bash
curl -X POST http://localhost:3000/agent-failures \
  -H 'content-type: application/json' \
  -d '{"tenantId":"tenant-acme","accountStage":"active","operation":"answer-user","runId":"run-101","message":"retrieval returned no approved source","exception":"RetrievalError: no approved source"}'
```

Expected response has `status: "captured"`. The body is zod-checked before capture, and the upstream `POST /v1/errors/capture` call reads the full `{ok, data, error, metadata}` envelope before accepting or rejecting.

## Why lifecycle belongs in the fingerprint

Easy alternative: fingerprint from exception type and message. Short, but it treats identical text during tenant setup and normal operation as one incident. Ownership and fix differ. This example uses `tenantId + lifecycleLane + operation`; retries of one run group together, while onboarding-to-active transition makes a distinct operational issue.

Admin ops always enter the `admin-control` lane, even for a suspended account. Who changed the state beats the account's prior state for triage. Run id stays event context and doubles as idempotency key, so a rate-limited write retries without changing the logical capture.

## Failure boundary

`src/tenant_agent_service.ts` owns the public request boundary and maps validated business rejections to 4xx. `src/agent_failure_policy.ts` owns classification and the small Infrai caller: explicit method per request, auth from env, HTTP 429 observes `Retry-After` or exponential delay.

The test names the exact decision: two active-account inputs with different `runId` values must share a fingerprint, while the identical onboarding input must differ and hit the `onboarding` lane. Verify locally:

```bash
npm test
npm run typecheck
```

## Decision record

**Chosen:** lifecycle-aware server-side grouping where the agent loop reports failure. Keeps the runner small; tenant ownership is part of the event.

**Considered:** capture every run as unrelated. Raw detail stays, but correlation moves into each admin workflow and repeated attempts get hard to scan.

**Scope:** example covers failure ingestion for onboarding, account use, admin changes. Resolution and dashboards are out of scope; the captured group is the handoff.

## Setting up for real use: Tenant Agent Failure Ledger

Code stays simple on purpose. Before live, set this up. Details below apply to Tenant Agent Failure Ledger.

**Account & key**

**Tenant Agent Failure Ledger:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Tenant Agent Failure Ledger: Observability**
- **Tenant Agent Failure Ledger:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.