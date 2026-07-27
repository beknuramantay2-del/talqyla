'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell, Topbar } from '../components';
import { api } from '@/lib/api';
import type { DashboardStats, SkillKey } from '@/types';

const labels: Record<SkillKey, string> = { STRUCTURE: 'Структура', CONTENT: 'Содержание', REFUTATION: 'Опровержение', LOGIC: 'Логика', DELIVERY: 'Подача' };
const tones: Record<SkillKey, string> = { STRUCTURE: 'var(--lavender)', CONTENT: 'var(--mint)', REFUTATION: 'var(--peach)', LOGIC: 'var(--sky)', DELIVERY: 'var(--lavender)' };

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.getDashboard().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить dashboard')); }, []);
  if (error) return <AppShell><Topbar eyebrow="Твой прогресс" title="Не удалось загрузить данные" /><div className="panel error-state"><p>{error}</p><button className="button primary" onClick={() => window.location.reload()}>Повторить</button></div></AppShell>;
  if (!data) return <AppShell><Topbar eyebrow="Твой прогресс" title="Собираем картину навыков" /><div className="dashboard-grid"><div className="panel skeleton wide" /><div className="panel skeleton wide" /></div></AppShell>;
  const focus = data.stats.focusSkill;
  return <AppShell><Topbar eyebrow="Твой прогресс" title="Навыки растут от раунда к раунду" /><div className="dashboard-grid"><section className="panel" style={{ gridColumn: '1 / -1' }}><div className="section-heading" style={{ marginTop: 0 }}><div><h2>Карта навыков</h2><p>Оценки из завершённых раундов, без декоративных метрик.</p></div><Link href="/topics" className="button primary">Новый раунд</Link></div><div className="skill-grid">{data.stats.radarData.map((item) => <div key={item.skill} className={`skill-card ${focus === item.skill ? 'focus-skill' : ''}`} style={{ background: tones[item.skill] }}><small>{labels[item.skill]}</small><strong>{item.score.toFixed(1)}</strong><span>из 10</span>{focus === item.skill && <em>Следующий фокус</em>}</div>)}</div></section><section className="panel" style={{ gridColumn: '1 / -1' }}><div className="panel-title"><h2>Что делать сегодня</h2><span>Решение на основе последних оценок</span></div>{focus ? <div className="focus-action"><span className="progress-dot p">◉</span><div><strong>Тренировать {labels[focus]}</strong><p>Это твой самый слабый навык по последнему разбору. Следующий оппонент будет бить именно туда.</p></div><Link href="/topics" className="button secondary">Начать</Link></div> : <div className="empty-action"><strong>Сыграй первый раунд</strong><p>После него появится персональный фокус и сравнение навыков.</p><Link href="/topics" className="button primary">Выбрать тему</Link></div>}</section><section className="panel" style={{ gridColumn: '1 / -1' }}><div className="panel-title"><h2>Последние раунды</h2><Link href="/rounds" className="text-link">Вся история →</Link></div>{data.recentRounds.length ? <div className="recent-list">{data.recentRounds.map((round) => <Link href={`/rounds/${round.id}`} className="recent-row" key={round.id}><div><strong>{round.topicTitle}</strong><span>{round.stance === 'PRO' ? 'За' : 'Против'} · {round.category}</span></div><b>{round.score ? `${round.score}/50` : 'В процессе'}</b><span>→</span></Link>)}</div> : <div className="empty-action"><strong>История появится после первого раунда</strong><Link href="/topics" className="button secondary">Выбрать тему</Link></div>}</section></div></AppShell>;
}
