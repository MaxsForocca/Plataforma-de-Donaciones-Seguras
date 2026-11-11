/**
 * Retorno del Hosted UI de Cognito (T047). Completa el login una sola vez (React StrictMode ejecuta
 * los efectos dos veces) y navega a la ruta de retorno. Si falla —por ejemplo, porque el usuario no
 * completó el segundo factor— se queda aquí y lo explica con un mensaje seguro. No muestra jamás los
 * parámetros de la URL (`error_description` puede traer texto del atacante) ni códigos de
 * autorización.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";

export function LoginCallbackPage() {
  const { completeLogin, login, error } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void completeLogin().then((returnTo) => {
      if (returnTo === null) setFailed(true);
      else navigate(returnTo, { replace: true });
    });
  }, [completeLogin, navigate]);

  if (!failed) {
    return (
      <p role="status" className="text-slate-700">
        Procesando inicio de sesión…
      </p>
    );
  }

  return (
    <section aria-labelledby="titulo-callback">
      <h1 id="titulo-callback" className="text-2xl font-semibold">
        No se pudo iniciar sesión
      </h1>
      <p className="mt-2 text-slate-800">{error ?? "Inténtelo nuevamente."}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void login()}
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Intentar de nuevo
        </button>
        <Link
          to="/"
          className="text-blue-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Volver al catálogo
        </Link>
      </div>
    </section>
  );
}
