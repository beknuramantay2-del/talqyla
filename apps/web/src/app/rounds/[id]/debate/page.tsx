'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { DebateTurn } from '@/types';

const phases = ['Позиция', 'Перекрёстный вопрос', 'Ответный удар', 'Вердикт'];
const phaseFor = (exchanges: number, status: string) => status === 'AWAITING_JUDGE' || status === 'COMPLETED' ? 3 : Math.min(exchanges, 2);

export default function DebatePage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!loading && !user) router.push('/auth/login'); }, [user, loading, router]);

  const { data: round, refetch, isLoading } = useQuery({
    queryKey: ['round', id], queryFn: () => api.getRound(id), enabled: !!user, refetchInterval: 3000,
  });

  const turnMutation = useMutation({
    mutationFn: (turnText: string) => api.submitTurn(id, { text: turnText }),
    onSuccess: () => { setText(''); setError(''); refetch(); },
    onError: (err) => setError(err instanceof Error ? err.message : 'Не удалось отправить реплику'),
  });
  const judgeMutation = useMutation({ mutationFn: () => api.judgeRound(id), onSuccess: () => router.push(`/rounds/${id}/results`), onError: (err) => setError(err instanceof Error ? err.message : 'Судья не ответил. Попробуй ещё раз.') });
  const abortMutation = useMutation({ mutationFn: () => api.abortRound(id), onSuccess: () => router.push('/topics') });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [round?.turns.length]);

  if (loading || isLoading) return <div className="arena-loading"><div className="skeleton-line"/><div className="skeleton-box"/><div className="skeleton-box short"/></div>;
  if (!user || !round) return null;

  const turns: DebateTurn[] = round.turns ?? [];
  const phase = phaseFor(round.exchangesDone, round.status);
  const isWaiting = round.status === 'AWAITING_JUDGE';
  const isFinished = round.status === 'COMPLETED' || round.status === 'ABORTED';
  const latestOpponent = [...turns].reverse().find((turn) => turn.role === 'OPPONENT');
  const latestQuestion = latestOpponent?.question;

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream); const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); try { const result = await api.uploadAudio(new Blob(chunks, { type: 'audio/webm' })); setText((current) => current ? `${current} ${result.text}` : result.text); } catch { setError('Не удалось распознать голос. Напиши ответ вручную.'); } };
      recorder.start(); recorderRef.current = recorder; setRecording(true); setError('');
    } catch { setError('Нет доступа к микрофону. Можно ответить текстом.'); }
  }
  function handleSubmit(event: React.FormEvent) { event.preventDefault(); if (!text.trim() || turnMutation.isPending || isWaiting) return; turnMutation.mutate(text.trim()); }

  return <main className="arena-page">
    <header className="arena-header"><button className="arena-back" onClick={() => router.push('/topics')}>← Темы</button><div className="arena-brand"><span className="brand-mark">✦</span><span>Живой раунд</span></div><button className="arena-exit" onClick={() => abortMutation.mutate()} disabled={abortMutation.isPending || isFinished}>Выйти</button></header>
    <div className="arena-wrap">
      <section className="motion-bar"><div><span className="arena-eyebrow">Дебатная резолюция</span><h1>{round.topic?.title}</h1><p>Ты выступаешь <strong>{round.stance === 'PRO' ? 'за' : 'против'}</strong>. Не доказывай всё сразу, выиграй один ключевой clash.</p></div><div className="stance-token">{round.stance === 'PRO' ? 'ЗА' : 'ПРОТИВ'}<small>твоя сторона</small></div></section>
      <nav className="arena-stepper" aria-label="Этапы раунда">{phases.map((name, index) => <div className={`arena-step ${index < phase ? 'done' : ''} ${index === phase ? 'current' : ''}`} key={name}><span>{index < phase ? '✓' : index + 1}</span>{name}</div>)}</nav>
      <div className="arena-layout"><section className="arena-transcript"><div className="transcript-head"><div><span className="arena-eyebrow">Твой спарринг</span><h2>{phase === 0 ? 'Заяви позицию' : phase === 1 ? 'Не уходи от вопроса' : phase === 2 ? 'Сделай ответный удар' : 'Раунд завершён'}</h2></div><span className="exchange-count">{Math.min(round.exchangesDone + 1, 3)} / 3 обмена</span></div><div className="turns">{turns.length === 0 && <div className="empty-turn"><span>✦</span><strong>Оппонент ждёт твою позицию</strong><p>Сформулируй первую реплику. После неё AI начнёт атаковать конкретные места, а не просто болтать.</p></div>}{turns.map((turn) => <article className={`turn ${turn.role === 'STUDENT' ? 'student' : 'opponent'}`} key={turn.id}><div className="turn-meta"><span className={`turn-avatar ${turn.role === 'STUDENT' ? 'student-avatar' : 'opponent-avatar'}`}>{turn.role === 'STUDENT' ? 'ТЫ' : 'AI'}</span><span>{turn.role === 'STUDENT' ? 'Твоя реплика' : 'Оппонент'}</span><span>·</span><span>{turn.kind === 'REBUTTAL' ? 'опровержение' : turn.kind === 'QUESTION' ? 'вопрос' : 'позиция'}</span></div><p>{turn.contentText}</p>{turn.question && <div className="question-callout"><span>?</span><div><small>Вопрос, на который нужно ответить</small><strong>{turn.question}</strong></div></div>}</article>)}<div ref={bottomRef}/></div></section><aside className="arena-coach"><div className="coach-card"><span className="arena-eyebrow">Тактика раунда</span><h3>Ответь на вопрос, не повторяй тезис</h3><p>Сначала назови, с чем споришь. Затем дай причину или пример. В конце покажи, почему это меняет вывод.</p><div className="formula"><span>Ответ</span><b>→</b><span>Причина</span><b>→</b><span>Следствие</span></div></div><div className="coach-card quiet"><span className="arena-eyebrow">Фокус навыка</span><strong>{round.focusSkill ? ({ STRUCTURE: 'Структура', CONTENT: 'Доказательства', REFUTATION: 'Опровержение', LOGIC: 'Логика', DELIVERY: 'Подача' } as Record<string, string>)[round.focusSkill] : 'Базовая проверка'}</strong><p>Оппонент подбирает вопросы под этот навык.</p></div></aside></div>
      {!isFinished && <section className="response-dock"><div className="dock-prompt"><span className="arena-eyebrow">Твоя очередь</span><strong>{isWaiting ? 'Все обмены завершены' : latestQuestion ?? 'Сделай первый ход: заяви главный аргумент'}</strong></div><form onSubmit={handleSubmit}><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={isWaiting ? 'Подготавливаем вердикт...' : 'Скажи это своими словами...'} disabled={turnMutation.isPending || isWaiting} maxLength={2000}/><div className="dock-actions"><span className="char-count">{text.length} / 2000</span><button type="button" className={`voice-button ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={isWaiting}>{recording ? '■ Стоп записи' : '● Голосом'}</button><button className="send-button" type="submit" disabled={turnMutation.isPending || isWaiting || !text.trim()}>{turnMutation.isPending ? 'Оппонент думает…' : 'Отправить реплику →'}</button></div></form>{error && <div className="arena-error">{error}</div>}</section>}
      {isWaiting && <section className="verdict-dock"><div><span className="arena-eyebrow">Ты прошёл все 3 обмена</span><strong>Готов увидеть, где ты был сильнее всего?</strong></div><button className="send-button" onClick={() => judgeMutation.mutate()} disabled={judgeMutation.isPending}>{judgeMutation.isPending ? 'Судья разбирает раунд…' : 'Открыть ballot →'}</button></section>}
    </div>
  </main>;
}
