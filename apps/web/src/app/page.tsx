'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell, Topbar, ProgressRing } from './components';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { DashboardStats } from '@/types';

const skillLabels: Record<string, string> = { STRUCTURE: 'Структура', CONTENT: 'Содержание', REFUTATION: 'Опровержение', LOGIC: 'Логика', DELIVERY: 'Подача' };
const bars = [18, 26, 34, 46, 62, 38, 24];
const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export default function HomePage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    api.getDashboard().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить прогресс'));
  }, [user]);

  if (loading) return <div className="form-page"><div className="eyebrow">Загружаем твой кабинет...</div></div>;
  if (!user) return <main className="form-page"><div className="form-card" style={{ textAlign: 'center' }}><div className="brand" style={{ justifyContent: 'center', padding: 0, marginBottom: 28 }}><span className="brand-mark">✦</span><span>Talqyla</span></div><h1>Говори увереннее.</h1><p>Тренируй аргументы в живом споре с AI-оппонентом и получай честный разбор по пяти навыкам.</p><div style={{ display: 'grid', gap: 10 }}><Link href="/auth/register" className="button primary">Начать тренировку</Link><Link href="/auth/login" className="button ghost">У меня уже есть аккаунт</Link></div></div></main>;
  if (error) return <AppShell><Topbar title="Не удалось загрузить прогресс" /><div className="panel error-state"><h2>Что-то не подгрузилось</h2><p>{error}</p><button className="button primary" onClick={() => window.location.reload()}>Повторить</button></div></AppShell>;
  if (!data) return <AppShell><Topbar title="Загружаем прогресс" /><div className="dashboard-grid"><div className="panel skeleton" /><div className="panel skeleton" /><div className="panel skeleton wide" /></div></AppShell>;

  const focus = data.stats.focusSkill;
  const last = data.recentRounds[0];
  const progress = Math.round((data.stats.averageScore / 10) * 100);

  return <AppShell><Topbar eyebrow="Панель ученика" title={`Доброе утро, ${user.name.split(' ')[0]}`} />
    <div className="dashboard-grid">
      <section className="panel activity"><div className="panel-title"><h2>Ритм тренировок</h2><span>Последние 7 дней</span></div><div className="dashboard-copy"><strong>{data.stats.totalRounds}</strong><span>завершённых раундов</span><span className="up">Средний балл {data.stats.averageScore.toFixed(1)} / 10</span></div><div className="chart">{bars.map((h, i) => <div className="bar-col" key={days[i]}><div className={`bar ${i === 4 ? 'hot' : ''}`} style={{ height: `${h}%` }} /><span className="bar-label">{days[i]}</span></div>)}</div></section>
      <section className="panel progress"><div className="panel-title"><h2>Текущий уровень</h2><span>{data.profile.experienceLevel}</span></div><div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 17px' }}><ProgressRing value={progress} /></div><div className="progress-list"><div className="progress-row"><span className="progress-dot v">◈</span><div><strong>Средний результат</strong><small>{data.stats.averageScore.toFixed(1)} из 10</small></div><Link href="/dashboard">Детали</Link></div><div className="progress-row"><span className="progress-dot p">◉</span><div><strong>Фокус следующего раунда</strong><small>{focus ? skillLabels[focus] : 'Определи после первого раунда'}</small></div><Link href="/topics">Тренировать</Link></div></div></section>
      <section className="panel continue"><div className="section-heading" style={{ marginTop: 0 }}><div><h2>Следующее полезное действие</h2><p>Dashboard должен вести к прогрессу, а не просто показывать цифры.</p></div><Link className="button primary" href="/topics">Новый раунд</Link></div><div className="action-grid"><div className="action-main"><span className="action-kicker">Рекомендация судьи</span><h3>{focus ? `Прокачай: ${skillLabels[focus]}` : 'Сыграй первый раунд'}</h3><p>{focus ? 'Оппонент будет специально давить на этот навык, а после раунда сравним результат.' : 'Собери Claim, Warrant, Impact и получи первую точку отсчёта.'}</p><Link className="button secondary" href="/topics">{focus ? 'Начать фокусную тренировку' : 'Выбрать тему'}</Link></div><div className="action-side"><span className="action-kicker">Последний раунд</span>{last ? <><strong>{last.topicTitle}</strong><span className="eyebrow">{last.score ? `Результат: ${last.score} / 50` : 'Разбор ещё не готов'}</span><Link href={`/rounds/${last.id}`} className="text-link">Открыть раунд →</Link></> : <><strong>Пока пусто</strong><span className="eyebrow">Здесь появится твоя история.</span></>}</div></div></section>
      <section className="stats"><div className="stat"><span className="stat-icon">◈</span><div><strong>{data.stats.totalRounds}</strong><span>раундов</span></div></div><div className="stat"><span className="stat-icon" style={{ background: 'var(--mint)' }}>✓</span><div><strong>{data.profile.roundsPlayed}</strong><span>занятий в профиле</span></div></div><div className="stat"><span className="stat-icon" style={{ background: 'var(--peach)' }}>◷</span><div><strong>{focus ? skillLabels[focus] : 'Старт'}</strong><span>следующий фокус</span></div></div><div className="stat"><span className="stat-icon" style={{ background: 'var(--lavender)' }}>↗</span><div><strong>{data.profile.grade} кл.</strong><span>уровень обучения</span></div></div></section>
    </div></AppShell>;
}
