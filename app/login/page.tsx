'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function entrar() {
    setCargando(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('Correo o contraseña incorrectos.');
      setCargando(false);
    } else {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Bioongo CRM</h1>
        <p className="text-sm text-slate-500 mb-6">Acceso privado</p>

        <div className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Correo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2"
          />
          <button
            onClick={entrar}
            disabled={cargando}
            className="bg-slate-900 text-white rounded py-2 hover:bg-slate-700 disabled:opacity-50"
          >
            {cargando ? 'Entrando…' : 'Entrar'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </main>
  );
}
