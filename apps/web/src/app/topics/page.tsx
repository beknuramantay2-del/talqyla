'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell, Topbar } from '../components';
import { api } from '@/lib/api';
import type { Topic } from '@/types';

const tones = ['v', 'm', 'p', 'v', 'm', 'p'];
const glyphs = ['◒', '⌁', '◈', '✦', '◉', '⌬'];

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getTopics()
      .then(setTopics)
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить темы'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <Topbar eyebrow="Библиотека тем" title="Выбери резолюцию для тренировки" />
      <div className="section-heading" style={{ marginTop: 0 }}>
        <div>
          <h2>{topics.length || 15} тем</h2>
          <p>Одна речь на 3–4 минуты, разбор судьи и один дрилл после неё.</p>
        </div>
        <Link className="button secondary" href="/dashboard">Мой прогресс</Link>
      </div>
      {error && <div className="panel error-state"><p>{error}</p></div>}
      {loading ? (
        <div className="course-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <div className="panel skeleton" style={{ height: 168 }} key={i} />)}
        </div>
      ) : topics.length === 0 && !error ? (
        <div className="panel empty-action">
          <strong>Каталог тем пуст</strong>
          <p>Похоже, база ещё не засеяна. Запусти seed, и темы появятся здесь.</p>
        </div>
      ) : (
        <div className="course-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
          {topics.map((topic, i) => (
            // v2: тема ведёт в сессию, а не в раунд с тремя обменами.
            <Link className="course" href={`/sessions/new?topic=${topic.id}`} key={topic.id}>
              <div className={`course-art ${tones[i % tones.length]}`}>{glyphs[i % glyphs.length]}</div>
              <div className="course-body">
                <strong>{topic.title}</strong>
                <small>{topic.description}</small>
                <div className="course-meta"><span>{topic.category}</span><b>{topic.difficulty}</b></div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
