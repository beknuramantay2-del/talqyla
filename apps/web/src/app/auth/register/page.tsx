'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { register } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await register(email, password, name);
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-bold">Регистрация</h1>

        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium">Имя</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            required
          />
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            required
          />
        </div>

        <div className="mb-6">
          <label className="mb-1 block text-sm font-medium">Пароль (минимум 8 символов)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            required
            minLength={8}
          />
        </div>

        <button type="submit" className="w-full rounded-lg bg-blue-600 py-2 text-white hover:bg-blue-700">
          Зарегистрироваться
        </button>

        <p className="mt-4 text-center text-sm text-gray-600">
          Уже есть аккаунт?{' '}
          <Link href="/auth/login" className="text-blue-600 hover:underline">Войти</Link>
        </p>
      </form>
    </main>
  );
}
