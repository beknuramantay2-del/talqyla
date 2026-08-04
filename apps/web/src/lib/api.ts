// Browser API client: access token is memory-only, refresh token is an httpOnly cookie.
import type { Ballot, CaseCard, DashboardStats, LeagueRow, PracticeSession, Topic } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) { accessToken = token; }
export function getAccessToken() { return accessToken; }

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(`${API_BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}' })
    .then(async (response) => { if (!response.ok) return null; const body = (await response.json()) as { accessToken?: string }; accessToken = body.accessToken ?? null; return accessToken; })
    .catch(() => null)
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function restoreSession() { return Boolean(await refreshAccessToken()); }

async function request<T>(path: string, options: RequestInit = {}, canRefresh = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers as Record<string, string>) ?? {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  if (res.status === 401 && canRefresh && !path.startsWith('/auth/')) {
    const next = await refreshAccessToken();
    if (next) return request<T>(path, options, false);
    accessToken = null;
    if (typeof window !== 'undefined') window.location.href = '/auth/login';
    throw new Error('Сессия истекла');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: 'Что-то пошло не так' } }));
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const enc = encodeURIComponent;

export const api = {
  register: (data: { email: string; password: string; name: string; parentEmail: string; parentalConsent: boolean }) =>
    request<{ user: { id: string; email: string; name: string; role: string }; accessToken: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    request<{ user: { id: string; email: string; name: string; role: string }; accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: '{}' }),

  // API отдаёт конверт с пагинацией: разворачиваем здесь, чтобы страницы не
  // знали про её формат.
  getTopics: async () => (await request<{ items: Topic[]; total: number }>('/topics')).items,
  getTopic: (idOrSlug: string) => request<Topic>(`/topics/${enc(idOrSlug)}`),

  submitOnboarding: (data: { grade: number; priorExperience: string; goal: string; logicAnswer: string }) =>
    request<{ level: string; grade: number; message: string }>('/onboarding', { method: 'POST', body: JSON.stringify(data) }),
  getOnboarding: () => request<{ grade: number; priorExperience: string; goal: string; logicAnswer: string; derivedLevel: string }>('/onboarding'),

  // ── v2: тренировочные сессии ──────────────────────────────────────
  getCaseCard: (topicId: string) => request<CaseCard>(`/sessions/case?topicId=${enc(topicId)}`),
  createSession: (data: { topicId: string; stance: string; mode?: string; role?: string }) =>
    request<PracticeSession>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
  getSessions: (query = '') => request<{ items: PracticeSession[]; total: number; page: number; limit: number }>(`/sessions${query}`),
  getSession: (id: string) => request<PracticeSession>(`/sessions/${enc(id)}`),
  requestPoi: (id: string, speechSoFar: string) =>
    request<{ question: string }>(`/sessions/${enc(id)}/poi`, { method: 'POST', body: JSON.stringify({ speechSoFar }) }),
  submitSpeech: (id: string, data: { text: string; durationSec?: number; poiAnswer?: string }) =>
    request<Ballot>(`/sessions/${enc(id)}/speech`, { method: 'POST', body: JSON.stringify(data) }),
  submitBlitz: (id: string, data: { text: string; durationSec?: number }) =>
    request<Ballot>(`/sessions/${enc(id)}/blitz`, { method: 'POST', body: JSON.stringify(data) }),
  abortSession: (id: string) => request<{ ok: boolean }>(`/sessions/${enc(id)}/abort`, { method: 'PATCH' }),

  getDashboard: () => request<DashboardStats>('/dashboard/stats'),
  getLeague: () => request<{ items: LeagueRow[]; myRank: number | null }>('/dashboard/league'),

  // Голос. Multipart идёт мимо request(), поэтому refresh делаем вручную.
  uploadAudio: async (blob: Blob) => {
    const formData = new FormData();
    formData.append('audio', blob, 'speech.webm');
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let response = await fetch(`${API_BASE}/voice/stt`, { method: 'POST', body: formData, headers, credentials: 'include' });
    if (response.status === 401) {
      const next = await refreshAccessToken();
      if (next) {
        headers.Authorization = `Bearer ${next}`;
        response = await fetch(`${API_BASE}/voice/stt`, { method: 'POST', body: formData, headers, credentials: 'include' });
      }
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message ?? 'Не удалось распознать речь');
    }
    return response.json() as Promise<{ text: string; durationSec: number; provider: string }>;
  },
};
