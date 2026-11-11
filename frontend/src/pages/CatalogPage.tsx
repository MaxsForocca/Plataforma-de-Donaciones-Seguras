/**
 * Catálogo público (T043; CA-01.1, CA-01.3, CA-09.1, CA-09.2). Lista los proyectos PUBLICADO con su
 * nombre, finalidad, meta y suma confirmada simulada, y maneja los estados de carga, vacío y error.
 * La ruta es pública: no envía el access token. La respuesta se valida con el esquema compartido y
 * se rechaza completa si algún proyecto es inválido (importes no enteros, campos de donantes, etc.).
 */
import { projectSummarySchema } from "@donaciones/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { z } from "zod";
import { ApiError } from "../services/apiClient";
import { formatPen, percentOf } from "../services/money";
import { useApiClient } from "../services/useApiClient";

const projectListSchema = z.array(projectSummarySchema);

export function CatalogPage() {
  const api = useApiClient();
  const query = useQuery({
    queryKey: ["projects"],
    queryFn: async ({ signal }) => {
      const payload = await api.get<unknown>("/v1/projects", { signal });
      const parsed = projectListSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(502, "INVALID_RESPONSE", "La respuesta del servidor no es válida.");
      }
      return parsed.data;
    },
  });

  return (
    <section aria-labelledby="titulo-catalogo">
      <h1 id="titulo-catalogo" className="text-2xl font-semibold">
        Catálogo de proyectos
      </h1>
      <p className="mt-1 text-slate-700">
        Proyecto académico: los montos son simulados y no se realiza ningún cobro.
      </p>

      {query.isPending && (
        <p role="status" className="mt-6 text-slate-700">
          Cargando proyectos…
        </p>
      )}

      {query.isError && (
        <div role="alert" className="mt-6 rounded border border-red-300 bg-red-50 p-4 text-red-900">
          <p>No se pudieron cargar los proyectos. Inténtelo nuevamente.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-3 rounded bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
          >
            Reintentar
          </button>
        </div>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <p className="mt-6 text-slate-800">Aún no hay proyectos publicados. Vuelva pronto.</p>
      )}

      {query.isSuccess && query.data.length > 0 && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {query.data.map((project) => {
            const percent = percentOf(project.confirmedAmountCents, project.goalAmountCents);
            return (
              <li key={project.projectId} className="rounded border border-slate-300 p-4">
                <h2 className="text-lg font-semibold">
                  <Link
                    to={`/projects/${project.projectId}`}
                    className="text-blue-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  >
                    {project.title}
                  </Link>
                </h2>
                <p className="mt-1 text-slate-800">{project.description}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-slate-700">Meta</dt>
                  <dd className="font-medium">{formatPen(project.goalAmountCents)}</dd>
                  <dt className="text-slate-700">Recaudado (simulado)</dt>
                  <dd className="font-medium">{formatPen(project.confirmedAmountCents)}</dd>
                </dl>
                <progress
                  className="mt-3 h-2 w-full"
                  value={percent}
                  max={100}
                  aria-label={`Avance de ${project.title}`}
                />
                <p className="mt-1 text-sm text-slate-700">Avance: {percent} %</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
