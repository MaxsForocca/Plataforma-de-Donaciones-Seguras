import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/AuthProvider";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 text-sm font-medium ${focusRing} ${
    isActive ? "bg-blue-50 text-blue-900" : "text-slate-700 hover:bg-slate-100"
  }`;

/** Estructura común: enlace de salto, encabezado con navegación, contenido y aviso académico. */
export function Layout() {
  const { status, error, login, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <a
        href="#contenido"
        className={`sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-white focus:px-3 focus:py-2 ${focusRing}`}
      >
        Saltar al contenido
      </a>

      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className={`rounded text-lg font-semibold ${focusRing}`}>
            Donaciones Seguras
          </Link>
          <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
            <NavLink to="/" end className={navLink}>
              Catálogo
            </NavLink>
            {status === "authenticated" && (
              <NavLink to="/me/donations" className={navLink}>
                Mis donaciones
              </NavLink>
            )}
            {status === "authenticated" ? (
              <button
                type="button"
                onClick={() => void logout()}
                className={`rounded border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 ${focusRing}`}
              >
                Cerrar sesión
              </button>
            ) : (
              <button
                type="button"
                disabled={status === "loading"}
                onClick={() => void login()}
                className={`rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60 ${focusRing}`}
              >
                Iniciar sesión
              </button>
            )}
          </nav>
        </div>
      </header>

      {error && (
        <p role="alert" className="bg-red-50 px-4 py-2 text-center text-sm text-red-900">
          {error}
        </p>
      )}

      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 px-4 py-4 text-center text-sm text-slate-700">
        Proyecto académico: las donaciones son simuladas y no se realiza ningún cobro.
      </footer>
    </div>
  );
}
