/**
 * Detalle público de un proyecto (T094; CA-02.1, CA-02.2).
 * Muestra título, descripción, meta y recaudado simulado en PEN, con barra de avance accesible.
 * Estados: cargando, 404 (inexistente o no publicado), error técnico (con reintentar) y éxito.
 * Nunca expone datos de donantes ni del creador del proyecto.
 */
import { Link, useParams } from "react-router";
import { ApiError } from "../services/apiClient";
import { formatPen, percentOf } from "../services/money";
import { useProject } from "../services/useProject";

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const query = useProject(projectId);

  const header = (
    <header>
      <h1 id="titulo-detalle" className="text-2xl font-semibold">
        Detalle del proyecto
      </h1>
      <p className="mt-1 text-slate-700">
        Proyecto académico: los montos son simulados y no se realiza ningún cobro.
      </p>
    </header>
  );

  if (query.isPending) {
    return (
      <section aria-labelledby="titulo-detalle">
        {header}
        <p role="status" className="mt-6 text-slate-700">
          Cargando detalle del proyecto…
        </p>
      </section>
    );
  }

  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <section aria-labelledby="titulo-no-encontrado">
          {header}
          <h2 id="titulo-no-encontrado" className="mt-6 text-xl font-semibold">
            Proyecto no encontrado
          </h2>
          <p className="mt-2 text-slate-700">
            El proyecto solicitado no existe o no se encuentra publicado.
          </p>
          <p className="mt-4">
            <Link
              to="/"
              className="text-blue-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Volver al catálogo
            </Link>
          </p>
        </section>
      );
    }

    return (
      <section aria-labelledby="titulo-detalle">
        {header}
        <div role="alert" className="mt-6 rounded border border-red-300 bg-red-50 p-4 text-red-900">
          <p>No se pudo cargar el detalle del proyecto. Inténtelo nuevamente.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-3 rounded bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const project = query.data;
  const percent = percentOf(project.confirmedAmountCents, project.goalAmountCents);

  return (
    <article aria-labelledby="titulo-detalle">
      {header}

      <div className="mt-6 rounded border border-slate-300 p-6">
        <h2 id="titulo-proyecto" className="text-xl font-semibold">
          {project.title}
        </h2>
        <p className="mt-2 text-slate-800 whitespace-pre-line">{project.description}</p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-700">Meta</dt>
            <dd className="text-lg font-semibold">{formatPen(project.goalAmountCents)}</dd>
          </div>
          <div>
            <dt className="text-slate-700">Recaudado (simulado)</dt>
            <dd className="text-lg font-semibold">{formatPen(project.confirmedAmountCents)}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <progress
            className="h-3 w-full"
            value={percent}
            max={100}
            aria-label={`Avance de ${project.title}`}
          />
          <p className="mt-1 text-sm text-slate-700">Avance: {percent} %</p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link
            to={`/donate/${project.projectId}`}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Donar
          </Link>
          <Link
            to="/"
            className="text-sm text-blue-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Volver al catálogo
          </Link>
        </div>
      </div>
    </article>
  );
}
