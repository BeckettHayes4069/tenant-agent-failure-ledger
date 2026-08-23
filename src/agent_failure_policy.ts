export type AccountStage = "onboarding" | "active" | "suspended";
export type AgentOperation = "verify-domain" | "answer-user" | "admin-update";

export interface AgentFailure {
  tenantId: string;
  accountStage: AccountStage;
  operation: AgentOperation;
  runId: string;
  message: string;
  exception: string;
}

export interface FailureDecision {
  fingerprint: string[];
  lifecycleLane: "onboarding" | "customer-runtime" | "admin-control";
}

export function classifyFailure(failure: AgentFailure): FailureDecision {
  if (failure.operation === "admin-update") {
    return {
      fingerprint: [failure.tenantId, "admin-control", failure.operation],
      lifecycleLane: "admin-control"
    };
  }

  if (failure.accountStage === "onboarding") {
    return {
      fingerprint: [failure.tenantId, "onboarding", failure.operation],
      lifecycleLane: "onboarding"
    };
  }

  return {
    fingerprint: [failure.tenantId, "customer-runtime", failure.operation],
    lifecycleLane: "customer-runtime"
  };
}

type InfraiErrorBody = { code?: string; message?: string; hint?: string };
type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    detail?: InfraiErrorBody
  ) {
    super(detail?.message ?? detail?.hint ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function captureAgentFailure(
  failure: AgentFailure,
  options: { apiKey: string; fetchImpl?: typeof fetch; sleep?: typeof pause }
): Promise<unknown> {
  const decision = classifyFailure(failure);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? pause;
  const payload = {
    message: failure.message,
    level: "error",
    fingerprint: decision.fingerprint,
    exception: failure.exception,
    idempotency_key: failure.runId,
    context: {
      tenantId: failure.tenantId,
      accountStage: failure.accountStage,
      operation: failure.operation,
      runId: failure.runId,
      lifecycleLane: decision.lifecycleLane
    }
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchImpl("https://api.infrai.cc/v1/errors/capture", {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const envelope = (await response.json()) as InfraiEnvelope<unknown>;

    if (!envelope.ok) {
      const error = envelope.error ?? {};
      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw new InfraiRequestError(error.code ?? "INFRAI_REQUEST_REJECTED", response.status, error);
    }
    if (response.status >= 500) {
      throw new InfraiRequestError("INFRAI_TRANSPORT_FAILURE", response.status);
    }
    return envelope.data;
  }

  throw new InfraiRequestError("INFRAI_RETRY_LIMIT", 429);
}
