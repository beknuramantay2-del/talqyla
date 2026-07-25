'use client';

import { Suspense, useState, useEffect, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Page wrapper — Next.js 14 requires any component using `useSearchParams()`
 * to be wrapped in a <Suspense> boundary, otherwise static prerendering bails
 * out at build time. The default export is a Server Component that provides
 * the boundary; the real client logic lives in <NewRoundForm> below.
 */
export default function NewRoundPage() {
  return (
    <Suspense fallback={<div className="p-8">Загрузка...</div>}>
      <NewRoundForm />
    </Suspense>
  );
}

function NewRoundForm() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const topicId = searchParams.get('topicId');
  const stance = searchParams.get('stance');

  const [claim, setClaim] = useState('');
  const [warrant, setWarrant] = useState('');
  const [impact, setImpact] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
  }, [user, loading, router]);

  const { data: topic } = useQuery({
    queryKey: ['topic', topicId],
    queryFn: () => api.getTopic(topicId!),
    enabled: !!topicId && !!user,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!topicId || !stance) {
        throw new Error('Не выбрана тема или позиция');
      }
      return api
        .createRound({ topicId, stance })
        .then((round) => api.submitArgument(round.id, { claim, warrant, impact }));
    },
    onSuccess: (round) => router.push(`/rounds/${round.id}/debate`),
    onError: (err) => setError(err instanceof Error ? err.message : 'Ошибка'),
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!topicId || !stance) return;
    createMutation.mutate();
  }

  if (loading) return <div className="p-8">Загрузка...</div>;
  if (!user) return null;
  if (!topicId || !stance) {
    return <div className="p-8">Ошибка: не выбрана тема или позиция</div>;
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-bold">{topic?.title ?? 'Загрузка...'}</h1>
        <p className="mb-6 text-gray-600">Твоя позиция: {stance === 'PRO' ? 'ЗА' : 'ПРОТИВ'}</p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Утверждение (Claim) — твой основной тезис
            </label>
            <textarea
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
              rows={2}
              minLength={8}
              maxLength={300}
              required
              placeholder={stance === 'PRO' ? (topic?.proHint ?? '') : (topic?.conHint ?? '')}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Обоснование (Warrant) — почему это так
            </label>
            <textarea
              value={warrant}
              onChange={(e) => setWarrant(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
              rows={3}
              minLength={20}
              maxLength={600}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Значимость (Impact) — почему это важно
            </label>
            <textarea
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
              rows={2}
              minLength={15}
              maxLength={400}
              required
            />
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full rounded-lg bg-blue-600 py-3 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Создание...' : 'Начать дебаты'}
          </button>
        </form>
      </div>
    </main>
  );
}
