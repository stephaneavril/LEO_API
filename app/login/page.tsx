'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (email && token) {
      localStorage.setItem('email', email);
      localStorage.setItem('token', token);
      router.push('/dashboard');
    } else {
      alert('Completa los campos');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-900 text-white">
      <form onSubmit={handleSubmit} className="bg-zinc-800 p-6 rounded-lg space-y-4 w-full max-w-md">
        <h2 className="text-2xl font-bold text-center">Iniciar Sesión</h2>
        <input
          type="email"
          placeholder="Correo electrónico"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-2 rounded bg-zinc-700 text-white"
        />
        <input
          type="text"
          placeholder="Token de acceso"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full p-2 rounded bg-zinc-700 text-white"
        />
        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded">
          Entrar
        </button>
      </form>
    </div>
  );
}
