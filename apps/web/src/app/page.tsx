'use client';

import { useAuth } from '@/lib/auth';
import Link from 'next/link';

export default function HomePage() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Загрузка...</div>;
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <h1 className="mb-4 text-4xl font-bold">ДебатоТренер</h1>
        <p className="mb-8 text-lg text-gray-600">AI-тренер по дебатам для школьников 7–11 классов</p>
        <div className="flex gap-4">
          <Link href="/auth/login" className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700">
            Войти
          </Link>
          <Link href="/auth/register" className="rounded-lg border border-gray-300 px-6 py-3 text-gray-700 hover:bg-gray-100">
            Зарегистрироваться
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">ДебатоТренер</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">{user.name}</span>
            <button onClick={logout} className="text-sm text-red-600 hover:text-red-800">Выйти</button>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link href="/topics" className="rounded-xl border p-6 hover:shadow-lg transition-shadow">
            <h2 className="mb-2 text-lg font-semibold">Новые дебаты</h2>
            <p className="text-sm text-gray-600">Выбери тему и начни тренировку</p>
          </Link>
          <Link href="/rounds" className="rounded-xl border p-6 hover:shadow-lg transition-shadow">
            <h2 className="mb-2 text-lg font-semibold">Мои раунды</h2>
            <p className="text-sm text-gray-600">История и результаты дебатов</p>
          </Link>
          <Link href="/dashboard" className="rounded-xl border p-6 hover:shadow-lg transition-shadow">
            <h2 className="mb-2 text-lg font-semibold">Прогресс</h2>
            <p className="text-sm text-gray-600">Статистика и навыки</p>
          </Link>
        </div>
      </div>
    </main>
  );
}
