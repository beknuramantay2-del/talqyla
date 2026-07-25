'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useEffect } from 'react';

const SKILL_LABELS: Record<string, string> = {
  STRUCTURE: 'Структура',
  CONTENT: 'Содержание',
  REFUTATION: 'Опровержение',
  LOGIC: 'Логика',
  DELIVERY: 'Подача',
};

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
  }, [user, loading, router]);

  const { data: round, isLoading } = useQuery({
    queryKey: ['round', id, 'results'],
    queryFn: () => api.getRound(id),
    enabled: !!user,
  });

  if (loading || isLoading) return <div className="p-8">Загрузка...</div>;
  if (!user) return null;
  if (!round?.feedback) return <div className="p-8">Оценка ещё не готова</div>;

  const f = round.feedback;
  const skillScores = round.skillScores ?? [];

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold">{round.topic?.title}</h1>
        <p className="mb-6 text-gray-600">
          Твоя позиция: {round.stance === 'PRO' ? 'ЗА' : 'ПРОТИВ'} · Обменов: {round.exchangesDone}
        </p>

        <div className="mb-8 rounded-xl border bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold">Оценка судьи</h2>

          {skillScores.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-4">
              {skillScores.map((s) => (
                <div key={s.skill} className="rounded-lg bg-blue-50 p-3 text-center">
                  <div className="text-2xl font-bold text-blue-700">{s.score}</div>
                  <div className="text-xs text-gray-600">{SKILL_LABELS[s.skill] ?? s.skill}</div>
                </div>
              ))}
            </div>
          )}

          <div className="mb-2">
            <div className="text-sm font-medium">Итоговая оценка</div>
            <div className="text-3xl font-bold">{f.totalScore ?? '-'}/10</div>
          </div>

          {f.strengths.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-sm font-medium text-green-700">Сильные стороны</div>
              <ul className="list-disc pl-5 text-sm text-gray-700">
                {f.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {f.weaknesses.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-sm font-medium text-red-700">Слабые стороны</div>
              <ul className="list-disc pl-5 text-sm text-gray-700">
                {f.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {f.advice.length > 0 && (
            <div>
              <div className="mb-1 text-sm font-medium text-blue-700">Советы</div>
              <ul className="list-disc pl-5 text-sm text-gray-700">
                {f.advice.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          {f.summaryText && (
            <div className="mt-4 rounded-lg bg-gray-50 p-4">
              <div className="mb-1 text-sm font-medium">Итог</div>
              <p className="text-sm text-gray-700">{f.summaryText}</p>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => router.push('/topics')}
            className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
          >
            Новая тема
          </button>
          <button
            onClick={() => router.push('/rounds')}
            className="rounded-lg border px-6 py-3 text-gray-700 hover:bg-gray-100"
          >
            История
          </button>
        </div>
      </div>
    </main>
  );
}
