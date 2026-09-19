import { llmProviders, type ModelProvider } from '../config.js';
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatRequest = { messages: ChatMessage[]; temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' };
async function callOpenAICompatible(provider: ModelProvider, request: ChatRequest): Promise<string> {
  if (!provider.enabled || !provider.apiKey || !provider.model) throw new Error(`${provider.name} is not configured`);
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}`, ...(provider.headers || {}) },
    body: JSON.stringify({ model: provider.model, messages: request.messages, temperature: request.temperature ?? 0.4, max_tokens: request.maxTokens ?? 300, response_format: request.responseFormat === 'json_object' ? { type: 'json_object' } : undefined }),
  });
  if (!response.ok) throw new Error(`${provider.name} failed: ${response.status} ${(await response.text().catch(()=>'')).slice(0,240)}`);
  const data = await response.json(); return data?.choices?.[0]?.message?.content || '';
}
export async function routedChat(request: ChatRequest): Promise<{text:string;provider:string;model?:string;fallback:boolean}> {
  for (const provider of llmProviders.filter(p=>p.enabled)) {
    try { const text=await callOpenAICompatible(provider,request); if(text.trim())return{text,provider:provider.name,model:provider.model,fallback:false}; }
    catch(error){console.error({event:'llm_provider_error',provider:provider.name,error:error instanceof Error?error.message:String(error)})}
  }
  return{text:'',provider:'mock',fallback:true};
}
export function configuredProviderNames(){return llmProviders.filter(p=>p.enabled).map(p=>({name:p.name,model:p.model}))}
