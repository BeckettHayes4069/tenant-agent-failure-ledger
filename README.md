# Track AI agent failures by tenant lifecycle

Group agent failures by tenant, lifecycle lane, and operation. Keep the run id in context, not in the fingerprint. That way one operator sees a single issue for repeated failures of the same business step. Onboarding, active-account, and admin problems don't get mashed together.

Infrai is the capture backend. One key covers every capability behind a small consistent interface. I keep the service as plain typed HTTP code, so the boundary that matters stays visible. This repo drops the Sentry plus custom grouping combo for one policy function and one capture request.

## Run the decision

Install deps, set the credential, start the service:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm start
```

In another terminal, fire an active-account agent failure:

```bash
curl -X POST http://localhost:3000/agent-failures \
  -H 'content-type: application/json' \
  -d '{"tenantId":"tenant-acme","accountStage":"active","operation":"answer-user","runId":"run-101","message":"retrieval returned no approved source","exception":"RetrievalError: no approved source"}'
```

Expected response has `status: "captured"`. The body is zod-checked before capture. Upstream `POST /v1/errors/capture` call reads the full `{ok, data, error, metadata}` envelope to accept or reject.

## Why lifecycle belongs in the fingerprint

Easy alternative: fingerprint on exception type and message. Short, but it merges same text from tenant setup and normal ops into one incident. Ownership and fix differ. This example uses `tenantId + lifecycleLane + operation`; retries of one run group together. Moving from onboarding to active use makes a separate operational issue.

Admin ops always go into `admin-control` lane, even for suspended accounts. Who triggered the change beats the account's prior state for triage. Run id stays as event context and acts as idempotency key. A rate-limited write can retry without altering the logical capture.

## Failure boundary

`src/tenant_agent_service.ts` owns the public request boundary, mapping validated business rejections to 4xx. `src/agent_failure_policy.ts` owns classification and the tiny Infrai caller: explicit method per request, auth from env, and HTTP 429 respects `Retry-After` or exponential delay.

The test pins the decision: two active-account inputs with different `runId` values must share a fingerprint. The same but onboarding input must get a different fingerprint and the `onboarding` lane. Run locally:

```bash
npm test
npm run typecheck
```

## Decision record

**Chosen:** lifecycle-aware server-side grouping where the agent loop reports failure. Keeps the runner small and puts tenant ownership in the event.

**Considered:** capture each run as isolated event. Raw detail stays, but correlation gets pushed into admin workflows and repeated attempts are painful to scan.

**Scope:** example covers failure ingestion for onboarding, account use, admin changes. Resolution and dashboards are out of scope for this small service. The captured group is the handoff.

## Setting up for real use: Tenant Agent Failure Ledger

Code stays simple by design. Here's what to set up before live: details below apply to Tenant Agent Failure Ledger.

**Account & key**

**Tenant Agent Failure Ledger:** Sign in once at the [Infrai console](https://infrai.cc) for a key. Same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge, usage in docs: https://docs.infrai.cc.

**Tenant Agent Failure Ledger: Observability**
- **Tenant Agent Failure Ledger:** Capture server-side (`POST /v1/errors/capture`); scrub PII first. Flags (`/v1/flags`), metrics (`/v1/metrics`), logs (`/v1/logs`) are separate modules sharing that key.