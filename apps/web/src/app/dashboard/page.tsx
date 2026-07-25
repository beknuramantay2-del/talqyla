'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const SKILL_LABELS: Record<string, string> = {
  STRUCTURE: 'Структура',
  CONTENT: 'Содержание',
  REFUTATION: 'Опровержение',
  LOGIC: 'Логика',
  DELIVERY: 'Подача',
};

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
  }, [user, loading, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
    enabled: !!user,
  });

  if (loading || isLoading) return <div className="p-8">Загрузка...</div>;
  if (!user) return null;

  const stats = data?.stats;
  const profile = data?.profile;
  const radar = stats?.radarData;
  const hasRadar = !!radar?.length;

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold">Мой прогресс</h1>

        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border bg-white p-4 text-center">
            <div className="text-2xl font-bold text-blue-700">{profile?.roundsPlayed ?? stats?.totalRounds ?? 0}</div>
            <div className="text-xs text-gray-600">Сыграно раундов</div>
          </div>
          <div className="rounded-xl border bg-white p-4 text-center">
            <div className="text-2xl font-bold text-green-700">{profile?.grade ?? '-'}</div>
            <div className="text-xs text-gray-600">Класс</div>
          </div>
          <div className="rounded-xl border bg-white p-4 text-center">
            <div className="text-2xl font-bold text-orange-700">{stats?.averageScore?.toFixed(1) ?? '-'}</div>
            <div className="text-xs text-gray-600">Средняя оценка</div>
          </div>
          <div className="rounded-xl border bg-white p-4 text-center">
            <div className="text-2xl font-bold text-purple-700">{profile?.experienceLevel ?? '-'}</div>
            <div className="text-xs text-gray-600">Уровень</div>
          </div>
        </div>

        {hasRadar && (
          <div className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold">Навыки</h2>
            <div className="space-y-4">
              {radar.map((skill: { skill: string; score: number }) => {
                const pct = Math.round((skill.score / 10) * 100);
                return (
                  <div key={skill.skill}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{SKILL_LABELS[skill.skill] ?? skill.skill}</span>
                      <span className="text-gray-500">{skill.score}/10</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-200">
                      <div
                        className="h-2 rounded-full bg-blue-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!hasRadar && (
          <div className="rounded-xl border bg-white p-8 text-center text-gray-500">
            Пройди несколько раундов, чтобы увидеть статистику по навыкам.
          </div>
        )}
      </div>
    </main>
  );
}
