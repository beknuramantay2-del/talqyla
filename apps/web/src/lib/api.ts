// API client — thin fetch wrapper with token management
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    accessToken = null;
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Auth
  register: (data: { email: string; password: string; name: string }) =>
    request<{ user: { id: string; email: string; name: string; role: string }; accessToken: string }>(
      '/auth/register', { method: 'POST', body: JSON.stringify(data) }
    ),

  login: (data: { email: string; password: string }) =>
    request<{ user: { id: string; email: string; name: string; role: string }; accessToken: string }>(
      '/auth/login', { method: 'POST', body: JSON.stringify(data) }
    ),

  // Topics
  getTopics: () => request<import('@/types').Topic[]>('/topics'),
  getTopic: (idOrSlug: string) => request<import('@/types').Topic>(`/topics/${idOrSlug}`),

  // Onboarding
  submitOnboarding: (data: { grade: number; priorExperience: string; goal: string; logicAnswer: string }) =>
    request<{ level: string; grade: number; message: string }>(
      '/onboarding', { method: 'POST', body: JSON.stringify(data) }
    ),

  getOnboarding: () => request<{ grade: number; priorExperience: string; goal: string; logicAnswer: string; derivedLevel: string }>('/onboarding'),

  // Rounds
  createRound: (data: { topicId: string; stance: string; focusSkill?: string }) =>
    request<import('@/types').DebateRound>('/rounds', { method: 'POST', body: JSON.stringify(data) }),

  getRounds: () => request<{ items: import('@/types').DebateRound[]; total: number }>('/rounds'),

  getRound: (id: string) => request<import('@/types').DebateRound>(`/rounds/${id}`),

  submitArgument: (id: string, data: { claim: string; warrant: string; impact: string }) =>
    request<import('@/types').DebateRound>(`/rounds/${id}/argument`, { method: 'POST', body: JSON.stringify(data) }),

  submitTurn: (id: string, data: { text: string; kind?: string }) =>
    request<{
      studentTurn: { idx: number; role: string; kind: string; text: string };
      opponentTurn: { idx: number; role: string; kind: string; text: string; question: string | null };
      status: string;
      exchangesDone: number;
    }>(`/rounds/${id}/turn`, { method: 'POST', body: JSON.stringify(data) }),

  judgeRound: (id: string) =>
    request<import('@/types').RoundFeedback & { scores: { skill: string; score: number; comment?: string }[] }>(
      `/rounds/${id}/judge`, { method: 'POST' }
    ),

  abortRound: (id: string) =>
    request<{ ok: boolean }>(`/rounds/${id}/abort`, { method: 'PATCH' }),

  // Dashboard
  getDashboard: () => request<import('@/types').DashboardStats>('/dashboard/stats'),

  // Voice
  uploadAudio: (blob: Blob) => {
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    const headers: Record<string, string> = {};
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}/voice/stt`, { method: 'POST', body: formData, headers, credentials: 'include' })
      .then((r) => r.json() as Promise<{ text: string; durationSec: number; provider: string }>);
  },
};
