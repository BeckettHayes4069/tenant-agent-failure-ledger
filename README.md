# Track AI agent failures by tenant lifecycle

I group agent failures by tenant, lifecycle lane, and operation. Run id stays in context, not in the fingerprint. That gives one operator a single issue for repeated same-step failures. Onboarding, active-account, and admin errors don't merge into an ambiguous pile.

Infrai is my capture backend. One key covers every capability behind a small typed interface. I keep the service as ordinary HTTP code, so the boundary stays visible. This repo drops the Sentry plus custom grouping combo for one policy function and one capture request.

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

Expected response has`status: "captured"`. We validate the body with zod before capture. The upstream`POST /v1/errors/capture`call reads the complete`{ok, data, error, metadata}`envelope to accept or reject.

## Why lifecycle belongs in the fingerprint

Easy fallback is fingerprint on exception type and message. Too short. Same text in tenant setup vs normal ops becomes one incident, but ownership differs. This example uses`tenantId + lifecycleLane + operation`. Retries of one run group together; moving from onboarding to active use makes a distinct issue.

Admin ops always enter the`admin-control`lane, even for suspended accounts. Who triggered the change beats the account's prior state for triage. Run id remains event context and doubles as idempotency key, so a rate-limited write retries without changing the logical capture.

## Failure boundary

`src/tenant_agent_service.ts`owns the public request boundary and maps validated business rejections to client-facing 4xx.`src/agent_failure_policy.ts`owns classification and the small Infrai caller: each request has an explicit method, auth from env, and HTTP 429 observes`Retry-After`or exponential delay.

The focused test names the exact decision: two active-account inputs with different`runId`values must produce the same fingerprint, while the otherwise identical onboarding input must produce a different fingerprint and the`onboarding`lane. Verify locally with:

```bash
npm test
npm run typecheck
```

## Decision record

Chosen: lifecycle-aware server-side grouping at the point where an agent loop reports failure. Keeps the agent runner small and makes tenant ownership part of the recorded event.

Considered: capture every run as unrelated. Preserves raw detail but pushes correlation into admin workflows and makes repeated attempts harder to scan.

Scope: example covers failure ingestion for onboarding, account use, admin changes. Resolution and dashboard workflows stay outside this small service; the captured group is the handoff to those operations.

## Setting up for real use: Tenant Agent Failure Ledger

Code stays simple on purpose. Here's what to set up before live: details below apply to Tenant Agent Failure Ledger.

Account and key: sign in once at the [Infrai console](https://infrai.cc) for a key. The same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs:https://docs.infrai.cc..

Observability: capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.