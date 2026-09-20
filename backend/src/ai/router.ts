import { llmProviders, llmRoutingConfig, type ModelProvider } from '../config.js';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatRequest = { messages: ChatMessage[]; temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' };
type ProviderState = { inFlight: number; cooldownUntil: number; lastUsed: number; successes: number; failures: number };

const providerStates = new Map(llmProviders.map(provider => [provider.name, { inFlight: 0, cooldownUntil: 0, lastUsed: 0, successes: 0, failures: 0 }]));

class ProviderError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

async function callOpenAICompatible(provider: ModelProvider, request: ChatRequest): Promise<string> {
  if (!provider.enabled || !provider.apiKey || !provider.model) throw new ProviderError(`${provider.name} is not configured`);
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(25_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}`, ...(provider.headers || {}) },
    body: JSON.stringify({ model: provider.model, messages: request.messages, temperature: request.temperature ?? 0.4, max_tokens: request.maxTokens ?? 300, response_format: request.responseFormat === 'json_object' ? { type: 'json_object' } : undefined }),
  });
  if (!response.ok) throw new ProviderError(`${provider.name} failed: ${response.status} ${(await response.text().catch(() => '')).slice(0, 240)}`, response.status);
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content || '');
}

export async function routedChat(request: ChatRequest): Promise<{ text: string; provider: string; model?: string; fallback: boolean }> {
  const enabled = llmProviders.filter(provider => provider.enabled);
  const attempted = new Set<string>();
  while (attempted.size < enabled.length) {
    const now = Date.now();
    const candidates = enabled
      .filter(provider => !attempted.has(provider.name))
      .filter(provider => {
        const state = providerStates.get(provider.name)!;
        return state.cooldownUntil <= now && state.inFlight < llmRoutingConfig.maxConcurrencyPerProvider;
      })
      .sort((left, right) => {
        const leftState = providerStates.get(left.name)!;
        const rightState = providerStates.get(right.name)!;
        return leftState.inFlight - rightState.inFlight || enabled.indexOf(left) - enabled.indexOf(right);
      });
    const provider = candidates[0];
    if (!provider) break;
    attempted.add(provider.name);
    const state = providerStates.get(provider.name)!;
    state.inFlight += 1;
    state.lastUsed = now;
    try {
      const text = await callOpenAICompatible(provider, request);
      if (!text.trim()) throw new ProviderError(`${provider.name} returned empty text`, 502);
      state.successes += 1;
      console.log({ event: 'llm_route', provider: provider.name, model: provider.model, fallback: enabled.indexOf(provider) > 0 });
      return { text, provider: provider.name, model: provider.model, fallback: enabled.indexOf(provider) > 0 };
    } catch (error) {
      state.failures += 1;
      const status = error instanceof ProviderError ? error.status : undefined;
      if (!status || status === 429 || status >= 500) state.cooldownUntil = Date.now() + llmRoutingConfig.cooldownMs;
      console.error({ event: 'llm_provider_error', provider: provider.name, status, error: error instanceof Error ? error.message : String(error) });
    } finally {
      state.inFlight = Math.max(0, state.inFlight - 1);
    }
  }
  return { text: '', provider: 'mock', fallback: true };
}

export function configuredProviderNames() {
  return llmProviders.filter(provider => provider.enabled).map(provider => ({ name: provider.name, model: provider.model }));
}

export function providerRoutingStatus() {
  const now = Date.now();
  return llmProviders.filter(provider => provider.enabled).map(provider => {
    const state = providerStates.get(provider.name)!;
    return {
      name: provider.name,
      model: provider.model,
      inFlight: state.inFlight,
      overloaded: state.inFlight >= llmRoutingConfig.maxConcurrencyPerProvider,
      coolingDown: state.cooldownUntil > now,
      available: state.cooldownUntil <= now && state.inFlight < llmRoutingConfig.maxConcurrencyPerProvider,
      successes: state.successes,
      failures: state.failures,
    };
  });
}
