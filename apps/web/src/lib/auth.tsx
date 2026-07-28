'use client';
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { api, getAccessToken, restoreSession, setAccessToken } from './api';
interface AuthUser { id: string; email: string; name: string; role: string; }
interface AuthContextType { user: AuthUser | null; loading: boolean; login: (email: string, password: string) => Promise<AuthUser>; register: (email: string, password: string, name: string, parentEmail: string, parentalConsent: boolean) => Promise<AuthUser>; logout: () => void; }
const AuthContext = createContext<AuthContextType | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { let alive = true; restoreSession().then(async (ok) => { if (!alive || !ok) { setLoading(false); return; } try { const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/me`, { credentials: 'include', headers: { Authorization: `Bearer ${getAccessToken()}` } }); if (response.ok) { const body = await response.json(); if (alive) setUser({ id: body.id, email: body.email, name: body.name, role: body.role }); } } finally { if (alive) setLoading(false); } }); return () => { alive = false; }; }, []);
  const login = useCallback(async (email: string, password: string) => { const res = await api.login({ email, password }); setAccessToken(res.accessToken); setUser(res.user); return res.user; }, []);
  const register = useCallback(async (email: string, password: string, name: string, parentEmail: string, parentalConsent: boolean) => { const res = await api.register({ email, password, name, parentEmail, parentalConsent }); setAccessToken(res.accessToken); setUser(res.user); return res.user; }, []);
  const logout = useCallback(() => { void api.logout().catch(() => undefined); setAccessToken(null); setUser(null); }, []);
  return <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error('useAuth must be used within AuthProvider'); return ctx; }
