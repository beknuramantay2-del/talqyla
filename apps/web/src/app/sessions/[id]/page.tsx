'use client';
import './session.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS, SKILL_LABELS, type Ballot, type CaseCard } from '@/types';

type Phase = 'PREP' | 'SPEECH' | 'BALLOT';

const PREP_SECONDS = 180;
const SPEECH_SECONDS = 240;
const BLITZ_SECONDS = 90;

function clock(total: number) {
  const value = Math.max(0, total);
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [phase, setPhase] = useState<Phase>('PREP');
  const [text, setText] = useState('');
  const [poiAnswer, setPoiAnswer] = useState('');
  const [poi, setPoi] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [left, setLeft] = useState(PREP_SECONDS);
  const [caseCard, setCaseCard] = useState<CaseCard | null>(null);
  const [caseError, setCaseError] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => { if (!loading && !user) router.push('/auth/login'); }, [loading, user, router]);

  // Сессия читается один раз. Здесь нечего опрашивать: оппонент больше не
  // отвечает в фоне, поэтому polling из v1 убран вместе с ним.
  const { data: session, isLoading } = useQuery({
    queryKey: ['session', id],
    queryFn: () => api.getSession(id),
    enabled: Boolean(user),
  });

  const isBlitz = session?.mode === 'BLITZ';
  const isCaseOnly = session?.mode === 'CASE';
  const speechBudget = isBlitz ? BLITZ_SECONDS : SPEECH_SECONDS;

  // Кейс-карта грузится отдельно: она кешируется на тему, поэтому у второго
  // и следующих учеников появляется мгновенно.
  useEffect(() => {
    if (!session) return;
    api.getCaseCard(session.topicId)
      .then(setCaseCard)
      .catch((err) => setCaseError(err instanceof Error ? err.message : 'Материал недоступен'));
  }, [session]);

  useEffect(() => {
    if (phase === 'BALLOT') return;
    const timer = window.setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (session?.status === 'COMPLETED') setPhase('BALLOT');
  }, [session?.status]);

  const startSpeech = useCallback(() => {
    setPhase('SPEECH');
    setLeft(speechBudget);
    startedAtRef.current = Date.now();
  }, [speechBudget]);

  const speechMutation = useMutation({
    mutationFn: (payload: { text: string; durationSec?: number; poiAnswer?: string }) =>
      isBlitz ? api.submitBlitz(id, payload) : api.submitSpeech(id, payload),
    onSuccess: (result) => { setBallot(result); setPhase('BALLOT'); setError(''); },
    onError: (err) => setError(err instanceof Error ? err.message : 'Судья не ответил, речь сохранена'),
  });

  const poiMutation = useMutation({
    mutationFn: () => api.requestPoi(id, text),
    onSuccess: (result) => setPoi(result.question),
    onError: (err) => setError(err instanceof Error ? err.message : 'POI недоступен'),
  });

  const abortMutation = useMutation({ mutationFn: () => api.abortSession(id), onSuccess: () => router.push('/topics') });

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setTranscribing(true);
        try {
          const result = await api.uploadAudio(new Blob(chunks, { type: 'audio/webm' }));
          setText((value) => (value ? `${value} ${result.text}` : result.text));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Не удалось распознать речь. Можно ввести текстом.');
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setError('');
    } catch {
      setError('Нет доступа к микрофону. Введи речь текстом ниже.');
    }
  }

  function submitSpeech() {
    if (!text.trim() || speechMutation.isPending) return;
    const spent = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : undefined;
    speechMutation.mutate({
      text: text.trim(),
      durationSec: spent,
      poiAnswer: poiAnswer.trim() || undefined,
    });
  }

  const minChars = isBlitz ? 20 : 120;
  const enoughText = text.trim().length >= minChars;
  const overtime = left === 0;

  const scoreRows = useMemo(() => ballot?.scores ?? [], [ballot]);

  if (loading || isLoading) return <main className="ses-page"><div className="ses-loading" /></main>;
  if (!user || !session) return null;

  return (
    <main className="ses-page">
      <header className="ses-top">
        <button className="ses-brand" onClick={() => router.push('/topics')}><span>T</span>talqyla</button>
        <div className="ses-steps">
          {(['PREP', 'SPEECH', 'BALLOT'] as Phase[]).map((step, index) => (
            <span key={step} className={phase === step ? 'now' : index < (['PREP', 'SPEECH', 'BALLOT'] as Phase[]).indexOf(phase) ? 'done' : ''}>
              {index + 1}. {step === 'PREP' ? 'Подготовка' : step === 'SPEECH' ? (isBlitz ? 'Блиц' : 'Речь') : 'Разбор'}
            </span>
          ))}
        </div>
        <button className="ses-exit" onClick={() => abortMutation.mutate()} disabled={phase === 'BALLOT' || abortMutation.isPending}>Выйти</button>
      </header>

      <section className="ses-motion">
        <div className="ses-role">
          <b>{session.role}</b>
          <span>{ROLE_LABELS[session.role]} · {session.stance === 'PRO' ? 'Government' : 'Opposition'}</span>
        </div>
        <h1>{session.topic.title}</h1>
        {phase !== 'BALLOT' && (
          <div className={`ses-clock ${overtime ? 'over' : ''}`}>
            <strong>{clock(left)}</strong>
            <small>{phase === 'PREP' ? 'на подготовку' : overtime ? 'время вышло, закругляйся' : 'на речь'}</small>
          </div>
        )}
      </section>

      {/* ── Фаза 1: кейс-карта ─────────────────────────────────────── */}
      {phase === 'PREP' && (
        <section className="ses-body">
          <div className="ses-case">
            <h2>Карта кейса</h2>
            {caseError && <p className="ses-note warn">{caseError} Речь можно сдать и без материала.</p>}
            {!caseCard && !caseError && <div className="ses-skeleton" />}
            {caseCard && (
              <>
                <div className="ses-block">
                  <h3>Кого задевает</h3>
                  <ul className="ses-chips">{caseCard.stakeholders.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className="ses-block">
                  <h3>Где столкновение</h3>
                  {caseCard.clashes.map((clash) => (
                    <div className="ses-clash" key={clash.title}>
                      <b>{clash.title}</b>
                      <p><i>За:</i> {clash.gov}</p>
                      <p><i>Против:</i> {clash.opp}</p>
                    </div>
                  ))}
                </div>
                <div className="ses-two">
                  <div>
                    <h3>Линии Government</h3>
                    <ul>{caseCard.govLines.map((line) => <li key={line}>{line}</li>)}</ul>
                  </div>
                  <div>
                    <h3>Линии Opposition</h3>
                    <ul>{caseCard.oppLines.map((line) => <li key={line}>{line}</li>)}</ul>
                  </div>
                </div>
                <div className="ses-block">
                  <h3>Где обычно сыпятся</h3>
                  <ul>{caseCard.traps.map((trap) => <li key={trap}>{trap}</li>)}</ul>
                </div>
              </>
            )}
          </div>

          <aside className="ses-side">
            <h3>Задача роли</h3>
            <p>Ты {ROLE_LABELS[session.role]}. Собери речь сам: карта даёт поле, а не готовый текст.</p>
            {session.focusSkill && (
              <p className="ses-note">Фокус этой сессии: <b>{SKILL_LABELS[session.focusSkill]}</b>. Судья разберёт его подробнее.</p>
            )}
            {isCaseOnly ? (
              <button className="ses-primary" onClick={() => router.push('/topics')}>Разбор закончен</button>
            ) : (
              <button className="ses-primary" onClick={startSpeech}>{isBlitz ? 'Начать блиц' : 'Начать речь'} →</button>
            )}
          </aside>
        </section>
      )}

      {/* ── Фаза 2: речь ───────────────────────────────────────────── */}
      {phase === 'SPEECH' && (
        <section className="ses-body">
          <div className="ses-speech">
            <div className="ses-mic-row">
              <button className={`ses-mic ${recording ? 'live' : ''}`} onClick={toggleRecording} disabled={transcribing}>
                {recording ? '■' : '●'}
              </button>
              <div>
                <strong>{recording ? 'Идёт запись' : transcribing ? 'Расшифровываем...' : 'Нажми и говори'}</strong>
                <small>Голос — основной способ. Текст ниже нужен, если микрофон недоступен.</small>
              </div>
            </div>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Здесь появится расшифровка речи. Можно править и дописывать."
              maxLength={4000}
            />
            <div className="ses-meta">
              <span className={enoughText ? '' : 'warn'}>{text.trim().length} символов, минимум {minChars}</span>
              {!isBlitz && !poi && (
                <button className="ses-ghost" onClick={() => poiMutation.mutate()} disabled={poiMutation.isPending || text.trim().length < 40}>
                  {poiMutation.isPending ? 'Оппонент думает...' : 'Принять POI'}
                </button>
              )}
            </div>

            {poi && (
              <div className="ses-poi">
                <b>POI от оппонента</b>
                <p>{poi}</p>
                <textarea
                  value={poiAnswer}
                  onChange={(event) => setPoiAnswer(event.target.value)}
                  placeholder="Ответ на POI в одно-два предложения"
                  maxLength={1200}
                />
              </div>
            )}

            {error && <div className="ses-error">{error}</div>}

            <button className="ses-primary wide" onClick={submitSpeech} disabled={!enoughText || speechMutation.isPending}>
              {speechMutation.isPending ? 'Судья слушает...' : 'Сдать судье →'}
            </button>
          </div>

          <aside className="ses-side">
            <h3>Держи каркас</h3>
            <ol className="ses-frame">
              <li>Заяви позицию одним предложением.</li>
              <li>Дай механизм: почему это работает.</li>
              <li>Ответь противоположной линии.</li>
              <li>Взвесь: почему твой мир лучше.</li>
            </ol>
            {caseCard && caseCard.clashes[0] && (
              <p className="ses-note">Главный clash: <b>{caseCard.clashes[0].title}</b></p>
            )}
          </aside>
        </section>
      )}

      {/* ── Фаза 3: ballot ─────────────────────────────────────────── */}
      {phase === 'BALLOT' && (
        <section className="ses-body">
          <div className="ses-ballot">
            {!ballot && <p className="ses-note">Эта сессия уже оценена. Открой историю, чтобы увидеть разбор.</p>}
            {ballot && (
              <>
                <div className="ses-score">
                  <strong>{ballot.totalScore}</strong>
                  <span>из {ballot.maxScore}<small>{ballot.ratingDelta > 0 ? `+${ballot.ratingDelta} к рейтингу` : 'рейтинг без изменений'}</small></span>
                </div>
                <p className="ses-summary">{ballot.summaryText}</p>

                <div className="ses-bars">
                  {scoreRows.map((row) => (
                    <div key={row.skill} className={row.skill === ballot.drill.skill ? 'weak' : ''}>
                      <span>{SKILL_LABELS[row.skill]}</span>
                      <i><b style={{ width: `${row.score * 10}%` }} /></i>
                      <strong>{row.score}</strong>
                    </div>
                  ))}
                </div>

                {ballot.strengths.length > 0 && (
                  <div className="ses-block"><h3>Сработало</h3><ul>{ballot.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>
                )}
                {ballot.weaknesses.length > 0 && (
                  <div className="ses-block"><h3>Просело</h3><ul>{ballot.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul></div>
                )}
              </>
            )}
          </div>

          <aside className="ses-side drill">
            <h3>Следующий дрилл</h3>
            {ballot ? (
              <>
                <p className="ses-drill-skill">{SKILL_LABELS[ballot.drill.skill]}</p>
                <p className="ses-drill-task">{ballot.drill.task}</p>
                <button className="ses-primary" onClick={() => router.push(`/sessions/new?topic=${session.topicId}`)}>Сделать за 60 секунд</button>
              </>
            ) : (
              <p className="ses-note">Дрилл появится после оценки речи.</p>
            )}
            <button className="ses-ghost wide" onClick={() => router.push('/dashboard')}>К прогрессу</button>
          </aside>
        </section>
      )}
    </main>
  );
}
