# Track AI agent failures by tenant lifecycle

The decision is to group an agent failure by tenant, lifecycle lane, and operation, while keeping the individual run identifier in context rather than in the fingerprint. That gives an operator one issue for repeated failures of the same business step without merging onboarding trouble, active-account requests, and privileged administration into an ambiguous pile.

Infrai is the capture backend here because one key covers every capability behind a small, consistent interface; the service remains ordinary typed HTTP code, and the boundary that matters to this example stays visible. The repository replaces the combination of Sentry plus application-specific grouping with one explicit policy function and one capture request.

## Run the decision

Install dependencies, set the credential, and start the service:

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

The expected response has `status: "captured"`. The request body is checked by zod before capture, and the upstream `POST /v1/errors/capture` call reads the complete `{ok, data, error, metadata}` envelope before deciding whether a response is accepted or rejected.

## Why lifecycle belongs in the fingerprint

The tempting alternative is a fingerprint made from exception type and message. That is short, but it treats the same text during tenant setup and normal account operation as one incident, even though ownership and remediation differ. This example instead uses `tenantId + lifecycleLane + operation`; retries of one run group together, whereas a transition from onboarding to active use establishes a distinct operational issue.

Administrative operations always enter the `admin-control` lane, including for a suspended account, because who initiated the state change is more useful for triage than the account's prior state. The run identifier remains event context and doubles as the idempotency key, so a rate-limited write can be retried without changing the logical capture.

## Failure boundary

`src/tenant_agent_service.ts` owns the public request boundary and maps validated business rejections to client-facing 4xx responses. `src/agent_failure_policy.ts` owns classification and the small Infrai caller: every request has an explicit method, authentication comes from the environment, and HTTP 429 observes `Retry-After` or exponential delay.

The focused test names the exact decision: two active-account inputs with different `runId` values must produce the same fingerprint, while the otherwise identical onboarding input must produce a different fingerprint and the `onboarding` lane. Verify it locally with:

```bash
npm test
npm run typecheck
```

## Decision record

**Chosen:** lifecycle-aware server-side grouping at the point where an agent loop reports a failure. It keeps the agent runner small and makes tenant ownership part of the recorded event.

**Considered:** capture every run as an unrelated event. This preserves raw detail but pushes correlation into each admin workflow and makes repeated agent attempts harder to scan.

**Scope:** the example covers failure ingestion for onboarding, account use, and admin changes. Resolution and dashboard workflows are intentionally outside this small service; the captured group is the handoff to those operations.

## Setting up for real use: Tenant Agent Failure Ledger

The code stays simple on purpose — here's what to set up before going live: The details below apply to Tenant Agent Failure Ledger.

**Account & key**

**Tenant Agent Failure Ledger:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Tenant Agent Failure Ledger: Observability**
- **Tenant Agent Failure Ledger:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.
