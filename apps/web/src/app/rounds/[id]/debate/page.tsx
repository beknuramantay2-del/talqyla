'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { DebateRound, DebateTurn } from '@/types';

export default function DebatePage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
  }, [user, loading, router]);

  const { data: round, refetch } = useQuery({
    queryKey: ['round', id],
    queryFn: () => api.getRound(id),
    enabled: !!user,
    refetchInterval: 2000,
  });

  const turnMutation = useMutation({
    mutationFn: (turnText: string) => api.submitTurn(id, { text: turnText }),
    onSuccess: () => {
      setText('');
      refetch();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Ошибка'),
  });

  const judgeMutation = useMutation({
    mutationFn: () => api.judgeRound(id),
    onSuccess: () => router.push(`/rounds/${id}/results`),
    onError: (err) => setError(err instanceof Error ? err.message : 'Ошибка'),
  });

  const abortMutation = useMutation({
    mutationFn: () => api.abortRound(id),
    onSuccess: () => router.push('/topics'),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [round?.turns]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    turnMutation.mutate(text.trim());
  }

  if (loading) return <div className="p-8">Загрузка...</div>;
  if (!user || !round) return null;

  const turns: DebateTurn[] = round.turns ?? [];
  const isWaiting = round.status === 'AWAITING_JUDGE';
  const isFinished = round.status === 'COMPLETED' || round.status === 'ABORTED';

  return (
    <main className="flex min-h-screen flex-col">
      <div className="border-b bg-white p-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <h1 className="font-semibold">{round.topic?.title}</h1>
            <span className="text-sm text-gray-600">
              {round.stance === 'PRO' ? 'ЗА' : 'ПРОТИВ'} · Обмен {round.exchangesDone}
            </span>
          </div>
          <div className="flex gap-2">
            {isWaiting && (
              <button
                onClick={() => judgeMutation.mutate()}
                disabled={judgeMutation.isPending}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {judgeMutation.isPending ? 'Оценивание...' : 'Завершить и оценить'}
              </button>
            )}
            {!isFinished && (
              <button
                onClick={() => abortMutation.mutate()}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600"
              >
                Прервать
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`rounded-xl p-4 ${
                turn.role === 'STUDENT'
                  ? 'ml-12 bg-blue-50'
                  : 'mr-12 bg-gray-50'
              }`}
            >
              <div className="mb-1 text-xs font-medium text-gray-500">
                {turn.role === 'STUDENT' ? 'Ты' : 'Оппонент'} · {turn.kind}
              </div>
              <p className="text-gray-900">{turn.contentText}</p>
              {turn.question && (
                <p className="mt-2 text-sm italic text-gray-600">❓ {turn.question}</p>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {!isFinished && (
        <div className="border-t bg-white p-4">
          <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl gap-3">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={isWaiting ? 'Ожидание оценки...' : 'Напиши свой аргумент...'}
              disabled={turnMutation.isPending || isWaiting}
              className="flex-1 rounded-lg border px-4 py-3 disabled:opacity-50"
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={turnMutation.isPending || isWaiting || !text.trim()}
              className="rounded-lg bg-blue-600 px-6 py-3 text-white disabled:opacity-50"
            >
              {turnMutation.isPending ? '...' : 'Отправить'}
            </button>
          </form>
          {error && <div className="mx-auto mt-2 max-w-3xl text-sm text-red-600">{error}</div>}
        </div>
      )}
    </main>
  );
}
