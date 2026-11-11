/**
 * Guard de rutas protegidas (T048). Es solo UX: oculta pantallas a quien no inició sesión, pero NO
 * es una barrera de seguridad. La autorización real se decide siempre en el backend con RBAC y
 * propiedad del recurso; los grupos que conoce la SPA no cambian este comportamiento.
 */
import { Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthProvider";

export function ProtectedRoute() {
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
