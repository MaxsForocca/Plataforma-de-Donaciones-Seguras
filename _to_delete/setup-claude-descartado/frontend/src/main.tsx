import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root');

createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Plataforma de Donaciones Seguras</h1>
      <p className="mt-2 text-sm">Simulación académica: no se ha realizado ningún cobro.</p>
    </main>
  </StrictMode>,
);
