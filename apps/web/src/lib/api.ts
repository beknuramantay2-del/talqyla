// Browser API client: access token is memory-only, refresh token is an httpOnly cookie.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
export function setAccessToken(token: string | null) { accessToken = token; }
export function getAccessToken() { return accessToken; }
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(`${API_BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}' })
    .then(async (response) => { if (!response.ok) return null; const body = (await response.json()) as { accessToken?: string }; accessToken = body.accessToken ?? null; return accessToken; })
    .catch(() => null).finally(() => { refreshPromise = null; });
  return refreshPromise;
}
export async function restoreSession() { return Boolean(await refreshAccessToken()); }
async function request<T>(path: string, options: RequestInit = {}, canRefresh = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> ?? {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  if (res.status === 401 && canRefresh && !path.startsWith('/auth/')) { const next = await refreshAccessToken(); if (next) return request<T>(path, options, false); accessToken = null; if (typeof window !== 'undefined') window.location.href = '/auth/login'; throw new Error('Сессия истекла'); }
  if (!res.ok) { const body = await res.json().catch(() => ({ error: { message: 'Что-то пошло не так' } })); throw new Error(body.error?.message ?? `HTTP ${res.status}`); }
  return res.json();
}
export const api = {
  register: (data: { email: string; password: string; name: string; parentEmail: string; parentalConsent: boolean }) => request<{ user: { id: string; email: string; name: string; role: string }; accessToken: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) => request<{ user: { id: string; email: string; name: string; role: string }; accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: '{}' }),
  getTopics: async () => { const response = await request<{ items: import('@/types').Topic[]; total: number; page: number; limit: number }>('/topics'); return response.items; },
  getTopic: (idOrSlug: string) => request<import('@/types').Topic>(`/topics/${encodeURIComponent(idOrSlug)}`),
  submitOnboarding: (data: { grade: number; priorExperience: string; goal: string; logicAnswer: string }) => request<{ level: string; grade: number; message: string }>('/onboarding', { method: 'POST', body: JSON.stringify(data) }),
  getOnboarding: () => request<{ grade: number; priorExperience: string; goal: string; logicAnswer: string; derivedLevel: string }>('/onboarding'),
  createRound: (data: { topicId: string; stance: string; focusSkill?: string }) => request<import('@/types').DebateRound>('/rounds', { method: 'POST', body: JSON.stringify(data) }),
  getRounds: (query = '') => request<{ items: import('@/types').DebateRound[]; total: number; page: number; limit: number }>(`/rounds${query}`),
  getRound: (id: string) => request<import('@/types').DebateRound>(`/rounds/${encodeURIComponent(id)}`),
  submitArgument: (id: string, data: { claim: string; warrant: string; impact: string }) => request<import('@/types').DebateRound>(`/rounds/${encodeURIComponent(id)}/argument`, { method: 'POST', body: JSON.stringify(data) }),
  submitTurn: (id: string, data: { text: string; kind?: string }) => request<{ studentTurn: { idx: number; role: string; kind: string; text: string }; opponentTurn: { idx: number; role: string; kind: string; text: string; question: string | null }; status: string; exchangesDone: number }>(`/rounds/${encodeURIComponent(id)}/turn`, { method: 'POST', body: JSON.stringify(data) }),
  judgeRound: (id: string) => request<import('@/types').RoundFeedback & { scores: { skill: string; score: number; comment?: string }[] }>(`/rounds/${encodeURIComponent(id)}/judge`, { method: 'POST' }),
  abortRound: (id: string) => request<{ ok: boolean }>(`/rounds/${encodeURIComponent(id)}/abort`, { method: 'PATCH' }),
  getDashboard: () => request<import('@/types').DashboardStats>('/dashboard/stats'),
  uploadAudio: async (blob: Blob) => { const formData = new FormData(); formData.append('audio', blob, 'recording.webm'); const headers: Record<string, string> = {}; if (accessToken) headers.Authorization = `Bearer ${accessToken}`; let response = await fetch(`${API_BASE}/voice/stt`, { method: 'POST', body: formData, headers, credentials: 'include' }); if (response.status === 401) { const next = await refreshAccessToken(); if (next) { headers.Authorization = `Bearer ${next}`; response = await fetch(`${API_BASE}/voice/stt`, { method: 'POST', body: formData, headers, credentials: 'include' }); } } if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? 'Не удалось распознать речь'); } return response.json() as Promise<{ text: string; durationSec: number; provider: string }>; },
};
