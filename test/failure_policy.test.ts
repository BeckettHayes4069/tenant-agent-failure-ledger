import assert from "node:assert/strict";
import test from "node:test";
import { captureAgentFailure, classifyFailure } from "../src/agent_failure_policy.js";

test("the lifecycle boundary changes grouping while run ids do not", () => {
  const base = {
    tenantId: "tenant-acme",
    operation: "answer-user" as const,
    message: "retrieval returned no approved source",
    exception: "RetrievalError: no approved source"
  };
  const first = classifyFailure({ ...base, accountStage: "active", runId: "run-101" });
  const retry = classifyFailure({ ...base, accountStage: "active", runId: "run-102" });
  const onboarding = classifyFailure({
    ...base,
    accountStage: "onboarding",
    runId: "run-103"
  });

  assert.deepEqual(first.fingerprint, retry.fingerprint);
  assert.notDeepEqual(first.fingerprint, onboarding.fingerprint);
  assert.equal(onboarding.lifecycleLane, "onboarding");
});

test("capture sends the run id as the contracted idempotency field", async () => {
  let requestBody: unknown;
  let requestHeaders: HeadersInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    requestHeaders = init?.headers;
    return new Response(JSON.stringify({ ok: true, data: { captured: true } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await captureAgentFailure(
    {
      tenantId: "tenant-acme",
      accountStage: "active",
      operation: "answer-user",
      runId: "run-101",
      message: "retrieval returned no approved source",
      exception: "RetrievalError: no approved source"
    },
    { apiKey: "test-key", fetchImpl }
  );

  assert.equal((requestBody as { idempotency_key?: string }).idempotency_key, "run-101");
  assert.equal(new Headers(requestHeaders).has("idempotency-key"), false);
});
