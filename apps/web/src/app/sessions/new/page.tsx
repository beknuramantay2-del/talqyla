'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell, Topbar } from '../../components';
import { api } from '@/lib/api';
import type { SessionMode, SpeakerRole, Stance, Topic } from '@/types';

// Роли ограничены четырьмя: их достаточно, чтобы судья понимал задачу речи,
// и не превращает выбор в анкету на восемь пунктов.
const ROLE_OPTIONS: { role: SpeakerRole; stance: Stance; label: string; duty: string }[] = [
  { role: 'PM', stance: 'PRO', label: 'PM · открываю за', duty: 'задать модель и первую линию Government' },
  { role: 'LO', stance: 'CON', label: 'LO · открываю против', duty: 'оспорить модель и назвать главный clash' },
  { role: 'MG', stance: 'PRO', label: 'MG · закрываю за', duty: 'дать extension, а не пересказ' },
  { role: 'MO', stance: 'CON', label: 'MO · закрываю против', duty: 'переломить сравнение в пользу Opposition' },
];

const MODE_OPTIONS: { mode: SessionMode; title: string; time: string; about: string }[] = [
  { mode: 'SPEECH', title: 'Речь', time: '8–12 мин', about: 'Кейс-карта, речь на 3–4 минуты, ballot и дрилл.' },
  { mode: 'BLITZ', title: 'Блиц', time: '60–90 сек', about: 'Один короткий ответ на скорость мышления.' },
  { mode: 'CASE', title: 'Разбор темы', time: '3–5 мин', about: 'Только кейс-карта, без речи.' },
];

export default function NewSessionPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [mode, setMode] = useState<SessionMode>('SPEECH');
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const id = params.get('topic');
    if (!id) { setError('Тема не выбрана'); return; }
    api.getTopic(id).then(setTopic).catch(() => setError('Не удалось загрузить тему'));
  }, [params]);

  async function start() {
    if (!topic) return;
    setBusy(true); setError('');
    try {
      const option = ROLE_OPTIONS[selected];
      const session = await api.createSession({ topicId: topic.id, stance: option.stance, role: option.role, mode });
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось начать тренировку');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <Topbar eyebrow="Новая тренировка" title={topic?.title ?? 'Подбираем тему...'} />
      <div style={{ maxWidth: 860 }}>
        <Link href="/topics" className="eyebrow">← К темам</Link>

        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panel-title"><h2>Формат</h2><span>Шаг 1 из 2</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            {MODE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.mode}
                onClick={() => setMode(option.mode)}
                className={`button ${mode === option.mode ? 'primary' : 'ghost'}`}
                style={{ display: 'block', textAlign: 'left', padding: '14px 16px', height: 'auto' }}
              >
                <strong style={{ display: 'block' }}>{option.title}</strong>
                <small style={{ opacity: 0.75 }}>{option.time} · {option.about}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-title"><h2>Роль</h2><span>Шаг 2 из 2</span></div>
          <div style={{ display: 'grid', gap: 8 }}>
            {ROLE_OPTIONS.map((option, index) => (
              <button
                type="button"
                key={option.role}
                onClick={() => setSelected(index)}
                className={`button ${selected === index ? 'primary' : 'ghost'}`}
                style={{ display: 'block', textAlign: 'left', padding: '13px 16px', height: 'auto' }}
              >
                <strong style={{ display: 'block' }}>{option.label}</strong>
                <small style={{ opacity: 0.75 }}>Задача: {option.duty}</small>
              </button>
            ))}
          </div>

          {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button className="button primary" onClick={start} disabled={busy || !topic}>
              {busy ? 'Готовим тренировку...' : 'Начать  →'}
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
