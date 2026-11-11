/**
 * Shell de la aplicación (T032): rutas públicas y protegidas. El guard `RequireAuth` es solo UX
 * (oculta pantallas a quien no inició sesión); la autorización la decide siempre el backend.
 * Las páginas reales se incorporan en las fases de cada historia de usuario.
 */
import { useEffect, useRef } from "react";
import { Link, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { Layout } from "./components/Layout";

function PagePlaceholder({ title }: { title: string }) {
  return (
    <section aria-labelledby="titulo-pagina">
      <h1 id="titulo-pagina" className="text-2xl font-semibold">
        {title}
      </h1>
      <p className="mt-2 text-slate-700">Esta sección se habilitará en una fase posterior.</p>
    </section>
  );
}

function NotFoundPage() {
  return (
    <section aria-labelledby="titulo-404">
      <h1 id="titulo-404" className="text-2xl font-semibold">
        Página no encontrada
      </h1>
      <p className="mt-2">
        <Link to="/" className="text-blue-800 underline">
          Volver al catálogo
        </Link>
      </p>
    </section>
  );
}

/** Guard de UX: no sustituye la autorización del backend. */
export function RequireAuth() {
  const { status, login } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <p role="status" className="text-slate-700">
        Verificando sesión…
      </p>
    );
  }
  if (status === "unauthenticated") {
    return (
      <section aria-labelledby="titulo-login">
        <h1 id="titulo-login" className="text-2xl font-semibold">
          Inicia sesión para continuar
        </h1>
        <p className="mt-2 text-slate-700">Esta sección requiere una sesión activa.</p>
        <button
          type="button"
          onClick={() => void login(`${location.pathname}${location.search}`)}
          className="mt-4 rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Iniciar sesión
        </button>
      </section>
    );
  }
  return <Outlet />;
}

/** Procesa el retorno del Hosted UI una sola vez (React StrictMode ejecuta los efectos dos veces). */
function AuthCallback() {
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void completeLogin().then((returnTo) => navigate(returnTo ?? "/", { replace: true }));
  }, [completeLogin, navigate]);

  return (
    <p role="status" className="text-slate-700">
      Procesando inicio de sesión…
    </p>
  );
}

/** Rutas de la aplicación; el enrutador (BrowserRouter) lo provee `main.tsx`. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PagePlaceholder title="Catálogo de proyectos" />} />
        <Route
          path="projects/:projectId"
          element={<PagePlaceholder title="Detalle del proyecto" />}
        />
        <Route path="callback" element={<AuthCallback />} />
        <Route element={<RequireAuth />}>
          <Route path="donate/:projectId" element={<PagePlaceholder title="Donar" />} />
          <Route
            path="donations/:donationId/simulate"
            element={<PagePlaceholder title="Simulación de donación" />}
          />
          <Route path="me/donations" element={<PagePlaceholder title="Mis donaciones" />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
