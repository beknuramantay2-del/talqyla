'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell, Topbar } from '../components';
import { api } from '@/lib/api';
import { SKILL_LABELS, type DashboardStats, type LeagueRow } from '@/types';

const MODE_LABELS: Record<string, string> = { SPEECH: 'Речь', BLITZ: 'Блиц', CASE: 'Разбор' };

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [league, setLeague] = useState<{ items: LeagueRow[]; myRank: number | null } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDashboard().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить прогресс'));
    // Лига не критична: если упала, страница всё равно рисуется.
    api.getLeague().then(setLeague).catch(() => setLeague(null));
  }, []);

  if (error) {
    return (
      <AppShell>
        <Topbar eyebrow="Твой прогресс" title="Не удалось загрузить данные" />
        <div className="panel error-state">
          <p>{error}</p>
          <button className="button primary" onClick={() => window.location.reload()}>Повторить</button>
        </div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell>
        <Topbar eyebrow="Твой прогресс" title="Собираем картину навыков" />
        <div className="dashboard-grid"><div className="panel skeleton wide" /><div className="panel skeleton wide" /></div>
      </AppShell>
    );
  }

  const { stats, profile, recentSessions } = data;
  const hasData = stats.totalSessions > 0;

  return (
    <AppShell>
      <Topbar eyebrow="Твой прогресс" title={hasData ? 'Навыки растут от речи к речи' : 'Первая речь всё покажет'} />
      <div className="dashboard-grid">
        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="section-heading" style={{ marginTop: 0 }}>
            <div>
              <h2>Карта навыков</h2>
              <p>{hasData ? `${stats.totalSessions} тренировок · средний балл ${stats.averageScore} из ${stats.maxScore}` : 'Появится после первой оценённой речи.'}</p>
            </div>
            <Link href="/topics" className="button primary">Новая тренировка</Link>
          </div>
          <div className="skill-grid">
            {stats.radarData.map((item) => (
              <div key={item.skill} className={`skill-card ${stats.focusSkill === item.skill ? 'focus-skill' : ''}`}>
                <small>{item.label}</small>
                <strong>{item.samples > 0 ? item.score.toFixed(1) : '—'}</strong>
                <span>{item.samples > 0 ? 'из 10' : 'нет данных'}</span>
                {stats.focusSkill === item.skill && <em>Следующий фокус</em>}
              </div>
            ))}
          </div>
        </section>

        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title"><h2>Что делать сегодня</h2><span>Решение по последнему разбору</span></div>
          {stats.focusSkill ? (
            <div className="focus-action">
              <span className="progress-dot p">◉</span>
              <div>
                <strong>Тренировать {SKILL_LABELS[stats.focusSkill]}</strong>
                <p>Это самый слабый навык последней речи. Следующая сессия будет заточена под него.</p>
              </div>
              <Link href="/topics" className="button secondary">Начать</Link>
            </div>
          ) : (
            <div className="empty-action">
              <strong>Сдай первую речь</strong>
              <p>После неё появятся оценки, персональный фокус и место в лиге.</p>
              <Link href="/topics" className="button primary">Выбрать тему</Link>
            </div>
          )}
        </section>

        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title">
            <h2>Недельная лига</h2>
            <span>{profile.ratingPoints} очков{league?.myRank ? ` · место ${league.myRank}` : ''}</span>
          </div>
          {league && league.items.length > 0 ? (
            <div className="recent-list">
              {league.items.slice(0, 5).map((row) => (
                <div className="recent-row" key={`${row.rank}-${row.name}`}>
                  <div><strong>{row.rank}. {row.name}{row.isMe ? ' (ты)' : ''}</strong><span>{row.sessionsPlayed} тренировок</span></div>
                  <b>{row.ratingPoints}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-action">
              <strong>Лига ещё пустая</strong>
              <p>Очки начисляются за прирост слабого навыка, а не за количество речей.</p>
            </div>
          )}
        </section>

        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title"><h2>Последние тренировки</h2></div>
          {recentSessions.length ? (
            <div className="recent-list">
              {recentSessions.map((item) => (
                <Link href={`/sessions/${item.id}`} className="recent-row" key={item.id}>
                  <div>
                    <strong>{item.topicTitle}</strong>
                    <span>{MODE_LABELS[item.mode] ?? item.mode} · {item.role} · {item.stance === 'PRO' ? 'за' : 'против'}</span>
                  </div>
                  <b>{item.score != null ? `${item.score}/${stats.maxScore}` : item.status === 'COMPLETED' ? '—' : 'не закончена'}</b>
                  <span>→</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-action">
              <strong>История появится после первой речи</strong>
              <Link href="/topics" className="button secondary">Выбрать тему</Link>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
