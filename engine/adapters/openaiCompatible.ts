import type { LLMAdapter, SynthesisClaim, SynthesisRequest, SynthesisResult } from './llm';

/**
 * Optional adapter for an OpenAI-compatible chat endpoint, such as vLLM serving a
 * model on an AMD GPU (ROCm). Nothing in the MVP constructs it: the extractive
 * path stays the default and needs no GPU.
 *
 * It never throws. Any failure (no server, timeout, bad JSON, a claim citing an
 * unknown evidence id) yields `null` or drops that claim, so the pipeline can
 * always fall back to the deterministic answer.
 */

export interface OpenAICompatibleOptions {
  /** e.g. `http://vllm:8000/v1`. No trailing slash needed. */
  baseUrl: string;
  model: string;
  /** Optional bearer token. Never logged. */
  apiKey?: string;
  timeoutMs?: number;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT =
  'You answer only from the numbered passages. Reply with JSON only: ' +
  '{"claims":[{"text":"...","evidenceIds":["ev-1"]}]}. ' +
  'Every claim must cite the ids of the passages that contain it. ' +
  'If the passages do not answer the question, reply {"claims":[]}.';

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export class OpenAICompatibleLLMAdapter implements LLMAdapter {
  readonly id = 'openai-compatible';
  readonly enabled = true;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleOptions) {
    this.baseUrl = trimSlash(options.baseUrl);
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult | null> {
    if (request.passages.length === 0) {
      return null;
    }
    const passages = request.passages.map((p) => `[${p.evidenceId}] ${p.text}`).join('\n');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Question (${request.answerType}): ${request.question}\n\nPassages:\n${passages}`,
            },
          ],
        }),
      });
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      return content ? parseClaims(content, new Set(request.passages.map((p) => p.evidenceId))) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Keeps only well-formed claims that cite known evidence ids. */
export function parseClaims(content: string, knownIds: ReadonlySet<string>): SynthesisResult | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = (parsed as { claims?: unknown }).claims;
  if (!Array.isArray(raw)) {
    return null;
  }
  const claims: SynthesisClaim[] = [];
  for (const item of raw) {
    const text = (item as { text?: unknown })?.text;
    const ids = (item as { evidenceIds?: unknown })?.evidenceIds;
    if (typeof text !== 'string' || !text.trim() || !Array.isArray(ids)) {
      continue;
    }
    const cited = ids.filter((id): id is string => typeof id === 'string' && knownIds.has(id));
    if (cited.length > 0 && cited.length === ids.length) {
      claims.push({ text: text.trim(), evidenceIds: cited });
    }
  }
  return { claims };
}

export interface LLMHealth {
  available: boolean;
  models: string[];
  detail?: string;
}

/** Asks the server which models it serves. Never throws. */
export async function checkLLMHealth(
  baseUrl: string,
  options: { apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<LLMHealth> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await fetchImpl(`${trimSlash(baseUrl)}/models`, {
      signal: controller.signal,
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
    });
    if (!response.ok) {
      return { available: false, models: [], detail: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as { data?: { id?: string }[] };
    const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
    return { available: models.length > 0, models };
  } catch (error) {
    return { available: false, models: [], detail: error instanceof Error ? error.message : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
