import { createServer } from "node:http";
import { z } from "zod";
import {
  captureAgentFailure,
  InfraiRequestError,
  type AgentFailure
} from "./agent_failure_policy.js";

const requestSchema = z.object({
  tenantId: z.string().min(1),
  accountStage: z.enum(["onboarding", "active", "suspended"]),
  operation: z.enum(["verify-domain", "answer-user", "admin-update"]),
  runId: z.string().min(1),
  message: z.string().min(1),
  exception: z.string().min(1)
});

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method !== "POST" || request.url !== "/agent-failures") {
    response.writeHead(404).end(JSON.stringify({ error: "route not found" }));
    return;
  }

  try {
    const failure = requestSchema.parse(await readJson(request)) as AgentFailure;
    const apiKey = process.env.INFRAI_API_KEY;
    if (!apiKey) {
      response.writeHead(503).end(JSON.stringify({ error: "INFRAI_API_KEY is required" }));
      return;
    }
    const captured = await captureAgentFailure(failure, { apiKey });
    response.writeHead(202).end(JSON.stringify({ status: "captured", captured }));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid request body" }));
      return;
    }
    if (error instanceof InfraiRequestError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.code }));
      return;
    }
    response.writeHead(500).end(JSON.stringify({ error: "request processing failed" }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`tenant failure service listening on http://localhost:${port}`));
