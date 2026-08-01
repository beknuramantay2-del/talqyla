'use client';
import './arena.css';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { DebateTurn } from '@/types';

const speakerOrder = ['PM', 'LO', 'DPM', 'DLO', 'MG', 'MO', 'GW', 'OW'];
const teams = [
  { key: 'gov-open', label: 'Government', accent: 'blue', speakers: ['PM', 'DPM'] },
  { key: 'opp-open', label: 'Opposition', accent: 'green', speakers: ['LO', 'DLO'] },
  { key: 'gov-close', label: 'Closing Government', accent: 'gold', speakers: ['MG', 'GW'] },
  { key: 'opp-close', label: 'Closing Opposition', accent: 'rose', speakers: ['MO', 'OW'] },
];
const speakerNames: Record<string, string> = { PM: 'Prime Minister', LO: 'Leader of Opposition', DPM: 'Deputy PM', DLO: 'Deputy LO', MG: 'Member of Government', MO: 'Member of Opposition', GW: 'Government Whip', OW: 'Opposition Whip' };
const skillLabels: Record<string, string> = { STRUCTURE: 'Структура', CONTENT: 'Доказательства', REFUTATION: 'Опровержение', LOGIC: 'Логика', DELIVERY: 'Подача' };
function phaseFor(status: string, exchanges: number) { if (status === 'AWAITING_JUDGE' || status === 'COMPLETED') return 3; return Math.min(exchanges, 2); }
function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }

export default function DebatePage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const { user, loading } = useAuth();
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [recording, setRecording] = useState(false); const [seconds, setSeconds] = useState(420);
  const recorderRef = useRef<MediaRecorder | null>(null);
  useEffect(() => { if (!loading && !user) router.push('/auth/login'); }, [loading, user, router]);
  useEffect(() => { const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer); }, []);
  const { data: round, refetch, isLoading } = useQuery({ queryKey: ['round', id], queryFn: () => api.getRound(id), enabled: Boolean(user), refetchInterval: 3000 });
  const turns = (round?.turns ?? []) as DebateTurn[];
  const phase = round ? phaseFor(round.status, round.exchangesDone) : 0;
  const isWaiting = round?.status === 'AWAITING_JUDGE'; const isFinished = round?.status === 'COMPLETED' || round?.status === 'ABORTED';
  const studentRole = round?.stance === 'PRO' ? 'PM' : 'LO'; const opponentRole = studentRole === 'PM' ? 'LO' : 'PM';
  const latestTurn = [...turns].reverse()[0];
  const activeSpeaker = turnMutationPendingPlaceholder;
  const focus = round?.focusSkill ? skillLabels[round.focusSkill] : 'точность ответа';
  const latestOpponent = [...turns].reverse().find((turn) => turn.role === 'OPPONENT');
  const prompt = latestOpponent?.question ?? (turns.length ? 'Подготовь следующий ответ' : 'Твоя очередь открыть раунд');
  const turnMutation = useMutation({ mutationFn: (value: string) => api.submitTurn(id, { text: value }), onSuccess: () => { setText(''); setError(''); refetch(); setSeconds(420); }, onError: (err) => setError(err instanceof Error ? err.message : 'Не удалось отправить реплику') });
  const activeRole = turnMutation.isPending ? opponentRole : (turns.length === 0 ? (round?.stance === 'CON' ? opponentRole : studentRole) : latestTurn?.role === 'OPPONENT' ? studentRole : opponentRole);
  const activeSpeakerName = speakerNames[activeRole];
  const judgeMutation = useMutation({ mutationFn: () => api.judgeRound(id), onSuccess: () => router.push(`/rounds/${id}/results`), onError: (err) => setError(err instanceof Error ? err.message : 'Судья не ответил') });
  const abortMutation = useMutation({ mutationFn: () => api.abortRound(id), onSuccess: () => router.push('/topics') });
  async function toggleRecording() { if (recording) { recorderRef.current?.stop(); setRecording(false); return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const recorder = new MediaRecorder(stream); const chunks: Blob[] = []; recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); }; recorder.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); try { const result = await api.uploadAudio(new Blob(chunks, { type: 'audio/webm' })); setText((value) => value ? `${value} ${result.text}` : result.text); } catch { setError('Не удалось распознать голос. Напиши ответ вручную.'); } }; recorder.start(); recorderRef.current = recorder; setRecording(true); } catch { setError('Нет доступа к микрофону. Можно ответить текстом.'); } }
  function submit(event: React.FormEvent) { event.preventDefault(); if (!text.trim() || turnMutation.isPending || isWaiting) return; turnMutation.mutate(text.trim()); }
  if (loading || isLoading) return <div className="arena-loading"/>;
  if (!user || !round) return null;
  const side = round.stance === 'PRO' ? 'Government' : 'Opposition';
  return <main className="arena-page">
    <header className="arena-topbar"><button className="arena-brand" onClick={() => router.push('/topics')}><span className="arena-brand-mark">T</span><span>talqyla</span></button><nav className="arena-nav"><span className="active">Раунд</span><span>Тренировки</span><span>Прогресс</span></nav><div className="arena-user"><span>{user.name.split(' ')[0]}</span><span className="arena-avatar">{user.name.slice(0, 1).toUpperCase()}</span></div></header>
    <div className="arena-shell">
      <aside className="arena-left"><section className="arena-panel context-panel"><div className="arena-kicker">ФОРМАТ: BPF</div><h2>British<br/>Parliamentary</h2><p>4 команды, 8 ролей. Полный BPF-порядок: PM → LO → DPM → DLO → MG → MO → GW → OW.</p><div className="format-legend"><span className="legend-blue"/> Government<span className="legend-green"/> Opposition<span className="legend-gold"/> Closing Gov<span className="legend-rose"/> Closing Opp</div></section><section className="arena-panel round-panel"><div className="arena-kicker">РАУНД</div><div className="round-caption">Раунд {Math.min(round.exchangesDone + 1, 3)} из 3 · тренировочный фрагмент</div>{speakerOrder.map((speaker, index) => { const hasSpoken = turns.some((turn) => turn.role === 'STUDENT' ? speaker === studentRole : speaker === opponentRole); return <div className={`speaker-row ${speaker === activeRole && !isWaiting ? 'active' : ''} ${hasSpoken ? 'spoken' : ''}`} key={speaker}><span>{index + 1}</span><b>{speaker}</b><small>{speakerNames[speaker]}</small><em>{hasSpoken ? '✓' : '7:00'}</em></div>; })}</section><button className="rules-button">BPF / APF rules <span>i</span></button></aside>
      <section className="arena-stage"><div className="stage-top"><div><div className="arena-kicker">DEBATE FLOOR</div><h1>Раунд {Math.min(round.exchangesDone + 1, 3)} из 3</h1></div><div className="stage-live"><span/> {isFinished ? 'завершён' : 'в процессе'}</div></div><div className="stage-progress"><span style={{ width: `${Math.max(7, (phase / 3) * 100)}%` }}/></div><div className="speaker-clock"><strong>{formatTime(seconds)}</strong><small>{isWaiting ? 'ROUND COMPLETE' : `${activeRole} · SPEAKING`}</small></div><div className="motion-card"><div className="arena-kicker">DEBATE MOTION</div><h2>{round.topic?.title}</h2><p>Твоя позиция: <b>{side}</b> · Фокус: <b>{focus}</b></p></div>
        <div className="debate-floor" aria-label="Визуализация команд и активного спикера">{teams.map((team) => <article className={`team-podium ${team.accent} ${team.speakers.includes(activeRole) ? 'active-team' : ''}`} key={team.key}><div className="team-title"><span className="team-icon">♜</span>{team.label}</div><div className="team-speakers">{team.speakers.map((speaker) => { const hasSpoken = turns.some((turn) => turn.role === 'STUDENT' ? speaker === studentRole : speaker === opponentRole); return <div className={`speaker-figure ${speaker === activeRole && !isWaiting ? 'speaking' : ''} ${hasSpoken ? 'has-spoken' : ''}`} key={speaker}><div className="figure-glow"/><div className="figure-head">●</div><div className="figure-body">◆</div><strong>{speaker}</strong><small>{speaker === 'PM' || speaker === 'LO' || speaker === 'MG' || speaker === 'MO' ? 'Speaker 1' : 'Speaker 2'}</small></div>; })}</div></article>)}</div><div className="floor-mic"><span>●</span><small>{isWaiting ? 'Раунд завершён' : `${activeSpeakerName} говорит`}</small></div>
        {!isFinished && !isWaiting && <form className="arena-composer" onSubmit={submit}><div className="composer-heading"><span>ТВОЯ ОЧЕРЕДЬ</span><b>{activeRole === studentRole ? prompt : 'Оппонент формулирует ответ…'}</b></div><div className="composer-actions"><button type="button" className="floor-tool">💡 Аргументы</button><button type="button" className={`record-button ${recording ? 'recording' : ''}`} onClick={toggleRecording}>{recording ? '■ Стоп' : '◉ Говорить'}</button><button type="button" className="floor-tool">▤ Заметки</button><details className="text-fallback"><summary>Ввести текстом</summary><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Текстовый fallback, если микрофон недоступен..." maxLength={2000} disabled={turnMutation.isPending}/><button className="arena-submit" type="submit" disabled={!text.trim() || turnMutation.isPending}>{turnMutation.isPending ? 'Следующий спикер…' : 'Передать слово →'}</button></details></div></form>}{isWaiting && <div className="arena-verdict"><div><span className="arena-kicker">Три обмена завершены</span><strong>Открыть ballot и разбор роли</strong></div><button className="arena-submit" onClick={() => judgeMutation.mutate()} disabled={judgeMutation.isPending}>{judgeMutation.isPending ? 'Судья считает…' : 'Открыть ballot →'}</button></div>}{error && <div className="arena-error">{error}</div>}</section>
      <aside className="arena-right"><section className="arena-panel score-panel"><div className="judge-tabs"><span className="active">SCORES</span><span>JUDGES</span></div><div className="arena-kicker">ТЕКУЩИЙ СПИКЕР</div><h2>{activeSpeakerName}</h2><div className="active-role"><span className="role-ring">{activeRole}</span><div><b>{isWaiting ? 'Раунд завершён' : 'Говорит сейчас'}</b><small>{teams.find((team) => team.speakers.includes(activeRole))?.label}</small></div></div><div className="score-placeholder"><span>Оценки появятся после финала</span><i/><i/><i/></div></section><section className="arena-panel feedback-panel"><div className="arena-kicker">ПОДСКАЗКА ДЛЯ ТЕБЯ</div><p>В BPF важны роль команды, clash, extension, weighing и вклад в сравнительный результат. В APF порядок другой: 6 речей, 3 на 3.</p><div className="role-note">Твоя роль в MVP: <b>{studentRole}</b> · сторона: <b>{side}</b></div></section><button className="arena-withdraw" onClick={() => abortMutation.mutate()} disabled={abortMutation.isPending || isFinished}>Выйти из раунда</button></aside>
    </div>
  </main>;
}
