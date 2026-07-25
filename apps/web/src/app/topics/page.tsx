'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const CATEGORY_LABELS: Record<string, string> = {
  SCHOOL: 'Школа',
  SOCIETY: 'Общество',
  TECHNOLOGY: 'Технологии',
  ETHICS: 'Этика',
  ENVIRONMENT: 'Экология',
  SPORTS: 'Спорт',
  CULTURE: 'Культура',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: 'Лёгкая',
  MEDIUM: 'Средняя',
  HARD: 'Сложная',
};

export default function TopicsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
  }, [user, loading, router]);

  const { data: topics, isLoading } = useQuery({
    queryKey: ['topics'],
    queryFn: api.getTopics,
    enabled: !!user,
  });

  if (loading || isLoading) return <div className="p-8">Загрузка...</div>;
  if (!user) return null;

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold">Выбери тему для дебатов</h1>

        <div className="space-y-4">
          {topics?.map((topic) => (
            <div key={topic.id} className="rounded-xl border bg-white p-6">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800">
                  {CATEGORY_LABELS[topic.category] ?? topic.category}
                </span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                  {DIFFICULTY_LABELS[topic.difficulty] ?? topic.difficulty}
                </span>
              </div>

              <h2 className="mb-2 text-lg font-semibold">{topic.title}</h2>
              <p className="mb-4 text-sm text-gray-600">{topic.description}</p>

              <div className="flex gap-3">
                <button
                  onClick={() => router.push(`/rounds/new?topicId=${topic.id}&stance=PRO`)}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
                >
                  {topic.proHint ?? 'Аргумент "ЗА"'}
                </button>
                <button
                  onClick={() => router.push(`/rounds/new?topicId=${topic.id}&stance=CON`)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
                >
                  {topic.conHint ?? 'Аргумент "ПРОТИВ"'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
