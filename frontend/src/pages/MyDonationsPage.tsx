/**
 * Historial propio de donaciones (T101; CA-07.1, CA-07.2).
 * Lista las donaciones del donante autenticado con fecha, importe en PEN, proyecto y estado.
 * Si una donación está en PENDIENTE_SIMULACION, ofrece un enlace directo para simular su resultado.
 * Si la lista está vacía ([]), muestra un mensaje orientativo con enlace al catálogo.
 * La ruta es protegida y envía el access token.
 */
import { Link } from "react-router";
import { formatPen } from "../services/money";
import { useMyDonations } from "../services/useMyDonations";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("es-PE", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function MyDonationsPage() {
  const query = useMyDonations();

  return (
    <section aria-labelledby="titulo-mis-donaciones">
      <h1 id="titulo-mis-donaciones" className="text-2xl font-semibold">
        Mis donaciones
      </h1>
      <p className="mt-1 text-slate-700">
        Historial de donaciones simuladas asociadas a tu cuenta (sin cobro real).
      </p>

      {query.isPending && (
        <p role="status" className="mt-6 text-slate-700">
          Cargando donaciones…
        </p>
      )}

      {query.isError && (
        <div role="alert" className="mt-6 rounded border border-red-300 bg-red-50 p-4 text-red-900">
          <p>No se pudieron cargar tus donaciones. Inténtelo nuevamente.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className={`mt-3 rounded bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900 ${focusRing}`}
          >
            Reintentar
          </button>
        </div>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <div className="mt-6 rounded border border-slate-200 bg-slate-50 p-6 text-center">
          <p className="text-slate-800">Aún no has realizado ninguna donación.</p>
          <Link
            to="/"
            className={`mt-4 inline-block rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 ${focusRing}`}
          >
            Ver proyectos disponibles
          </Link>
        </div>
      )}

      {query.isSuccess && query.data.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-800 border-collapse border border-slate-200">
            <caption className="sr-only">Historial de donaciones simuladas</caption>
            <thead className="bg-slate-100 text-slate-900 border-b border-slate-200">
              <tr>
                <th scope="col" className="p-3">Fecha</th>
                <th scope="col" className="p-3">Proyecto</th>
                <th scope="col" className="p-3 text-right">Importe</th>
                <th scope="col" className="p-3">Estado</th>
                <th scope="col" className="p-3 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {query.data.map((item) => (
                <tr key={item.donationId} className="hover:bg-slate-50">
                  <td className="p-3 whitespace-nowrap">{formatDate(item.createdAt)}</td>
                  <td className="p-3">
                    <Link
                      to={`/projects/${item.projectId}`}
                      className={`text-blue-900 underline ${focusRing}`}
                    >
                      Ver proyecto
                    </Link>
                  </td>
                  <td className="p-3 text-right font-medium whitespace-nowrap">
                    {formatPen(item.amountCents)}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                        item.status === "CONFIRMADA_SIMULADA"
                          ? "bg-green-100 text-green-800"
                          : item.status === "RECHAZADA_SIMULADA"
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="p-3 text-center whitespace-nowrap">
                    {item.status === "PENDIENTE_SIMULACION" ? (
                      <Link
                        to={`/donations/${item.donationId}/simulate`}
                        className={`inline-block rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 ${focusRing}`}
                      >
                        Simular resultado
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
