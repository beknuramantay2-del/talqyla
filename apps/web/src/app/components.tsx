'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

type NavItem = readonly [icon: string, label: string, href: string];
const items: readonly NavItem[] = [
  ['⌂', 'Обзор', '/'], ['◫', 'Мои раунды', '/rounds'], ['◷', 'Расписание', '/topics'], ['◇', 'Темы', '/topics'],
  ['✓', 'Достижения', '/dashboard'], ['⚙', 'Настройки', '/dashboard'],
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const { user, logout } = useAuth();
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark">✦</span><span>Talqyla</span></Link>
      <nav className="nav" aria-label="Основная навигация">{items.map(([icon, label, href]) => <Link key={href + label} href={href} className={`nav-link ${pathname === href ? 'active' : ''}`}><span className="nav-icon">{icon}</span><span>{label}</span></Link>)}</nav>
      <div className="premium"><h3>Больше практики</h3><p>Открой полный архив тем и разборов.</p><Link href="/topics">Начать раунд</Link></div>
      <button onClick={logout} className="nav-link" style={{border:0, background:'transparent', marginTop:10}}><span className="nav-icon">↪</span><span>Выйти</span></button>
    </aside><main className="main">{children}</main>
  </div>;
}

export function Topbar({ eyebrow = 'Панель ученика', title = 'Доброе утро' }: { eyebrow?: string; title?: string }) {
  const { user } = useAuth();
  return <header className="topbar"><div><div className="eyebrow">{eyebrow}</div><h1>{title}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}.</h1></div><div className="top-actions"><input className="search" placeholder="Поиск тем, раундов..." aria-label="Поиск" /><span style={{fontSize:20, color:'var(--muted)'}}>♧</span><span className="avatar">{user?.name?.slice(0,2).toUpperCase() ?? 'У'}</span></div></header>;
}

export function ProgressRing({ value }: { value: number }) { return <div style={{width:104,height:104,borderRadius:'50%',background:`conic-gradient(var(--violet) ${value * 3.6}deg, var(--lavender) 0)`,display:'grid',placeItems:'center'}}><div style={{width:82,height:82,borderRadius:'50%',background:'var(--surface)',display:'grid',placeItems:'center',fontWeight:800,fontSize:18}}>{value}%<small style={{display:'block',fontSize:9,color:'var(--muted)',fontWeight:500}}>завершено</small></div></div>; }
