// Thin client for the Clocked API. Calls run one at a time from the server:
// the free tier allows a single request in flight, so a 429 means "wait your turn".

const BASE = "https://clocked.rezolve.ai/clocked";

export class ClockedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callClocked<T>(endpoint: string, payload: unknown): Promise<T> {
  const key = process.env.CLOCKED_API_KEY;
  if (!key) throw new ClockedError("CLOCKED_API_KEY is missing on the server.", 500);

  // Same key and same body on every retry, so a replay never double-runs the work.
  const idempotencyKey = crypto.randomUUID();
  const body = JSON.stringify(payload);
  let failure: ClockedError | null = null;
  let transientLeft = 2;

  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await sleep(Math.min(400 * 2 ** (attempt - 1), 5000) + Math.random() * 250);
    try {
      const res = await fetch(`${BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(50_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; retryAsNew?: boolean };
      if (res.ok) return data as T;
      failure = new ClockedError(data.error ?? `Clocked ${endpoint} returned ${res.status}`, res.status);
      if (data.retryAsNew) break;
      if (res.status === 429 || res.status === 409) continue;
      if (res.status >= 500 && transientLeft-- > 0) continue;
      break;
    } catch (err) {
      failure = new ClockedError(`Clocked ${endpoint} did not answer (${(err as Error).message})`, 504);
      if (transientLeft-- <= 0) break;
    }
  }
  throw failure ?? new ClockedError(`Clocked ${endpoint} failed`, 500);
}

// Response shapes, trimmed to the keys this app reads.

export type FillField = {
  value: string | string[] | null;
  confidence?: number;
  probabilities?: Record<string, number>;
};
export type FillResponse = { fields: Record<string, FillField> };

export type RerankResult = {
  index: number;
  id?: string;
  action: "use" | "expand" | "skip";
  reason?: string;
  relevance_score: number;
};
export type RerankResponse = { results: RerankResult[] };

export type ExtractValue = {
  value: string | string[] | null;
  start?: number;
  end?: number;
  confidence?: number;
};
export type ExtractResponse = { fields: Record<string, ExtractValue> };

export type GroundingClaim = {
  claim: string;
  supported: number;
  contradicted: number;
  not_stated: number;
  verdict: string;
  evidence?: { document: string; quote: string; confidence: number };
};
export type GroundingResponse = { grounded: number; verdict: string; claims: GroundingClaim[] };
