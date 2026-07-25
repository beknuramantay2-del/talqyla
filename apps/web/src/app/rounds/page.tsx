'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const STATUS_LABELS: Record<string, string> = {
  SETUP: 'Подготовка',
  ARGUMENT_BUILT: 'Аргумент готов',
  IN_PROGRESS: 'В процессе',
  AWAITING_JUDGE: 'Ожидает оценки',
  COMPLETED: 'Завершён',
  ABORTED: 'Прерван',
};

const STANCE_LABELS: Record<string, string> = {
  PRO: 'ЗА',
  CON: 'ПРОТИВ',
};

export default function RoundsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
  }, [user, loading, router]);

  const { data: rounds, isLoading } = useQuery({
    queryKey: ['rounds'],
    queryFn: api.getRounds,
    select: (res) => res.items,
    enabled: !!user,
  });

  const deleteMutation = useMutation({
    mutationFn: (roundId: string) => api.abortRound(roundId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rounds'] }),
  });

  if (loading || isLoading) return <div className="p-8">Загрузка...</div>;
  if (!user) return null;

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Мои раунды</h1>
          <button
            onClick={() => router.push('/topics')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Новый раунд
          </button>
        </div>

        {!rounds?.length ? (
          <div className="rounded-xl border bg-white p-8 text-center text-gray-500">
            У тебя пока нет дебатов. <button onClick={() => router.push('/topics')} className="text-blue-600 hover:underline">Начни первый!</button>
          </div>
        ) : (
          <div className="space-y-3">
            {rounds.map((round) => (
              <div key={round.id} className="rounded-xl border bg-white p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-sm font-medium">{round.topic?.title ?? 'Тема'}</span>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {STATUS_LABELS[round.status] ?? round.status}
                      </span>
                      <span className={`text-xs font-medium ${round.stance === 'PRO' ? 'text-green-600' : 'text-red-600'}`}>
                        {STANCE_LABELS[round.stance] ?? round.stance}
                      </span>
                    </div>

                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>Обменов: {round.exchangesDone}</span>
                      {round.feedback && <span>Оценка: {round.feedback.totalScore ?? '-'}/10</span>}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {round.status === 'ARGUMENT_BUILT' || round.status === 'IN_PROGRESS' || round.status === 'AWAITING_JUDGE' ? (
                      <button
                        onClick={() => router.push(`/rounds/${round.id}/debate`)}
                        className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
                      >
                        Продолжить
                      </button>
                    ) : round.status === 'COMPLETED' ? (
                      <button
                        onClick={() => router.push(`/rounds/${round.id}/results`)}
                        className="rounded bg-green-600 px-3 py-1 text-sm text-white"
                      >
                        Результаты
                      </button>
                    ) : null}

                    {round.status !== 'COMPLETED' && round.status !== 'ABORTED' && (
                      <button
                        onClick={() => deleteMutation.mutate(round.id)}
                        className="rounded border border-red-300 px-3 py-1 text-sm text-red-600"
                      >
                        Прервать
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
