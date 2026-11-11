/**
 * Simulación académica de una donación (T087; CA-06.1, CA-06.4). El donante confirma o rechaza SU
 * donación pendiente; la SPA envía únicamente `{ outcome }`: el importe, el propietario y el estado los
 * decide el servidor. El aviso «Simulación académica: no se ha realizado ningún cobro» es obligatorio y
 * siempre visible. La autorización real es del backend; esta página es solo UX.
 */
import { donationSchema, uuidSchema, type DonationOutcome } from "@donaciones/shared";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../services/apiClient";
import { formatPen } from "../services/money";
import { useApiClient } from "../services/useApiClient";

const DISCLAIMER = "Simulación académica: no se ha realizado ningún cobro";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

/** Mensajes seguros por estado: nunca se muestra el texto ni el código del servidor. */
function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return "Esta donación ya fue procesada; no se puede simular de nuevo.";
    }
    if (error.status === 404) return "La donación no existe o no le pertenece.";
    if (error.status === 403) return "Su cuenta no tiene permiso para simular donaciones.";
    if (error.status === 401) return "Su sesión expiró. Inicie sesión nuevamente.";
    if (error.status === 400) return "Revise los datos e inténtelo nuevamente.";
  }
  return "No se pudo completar la simulación. Inténtelo nuevamente.";
}

export function SimulationPage() {
  const { donationId = "" } = useParams();
  const api = useApiClient();
  const inFlight = useRef(false);
  const idIsValid = uuidSchema.safeParse(donationId).success;

  const mutation = useMutation({
    mutationFn: async (outcome: DonationOutcome) => {
      const payload = await api.post<unknown>(
        `/v1/donations/${donationId}/simulate`,
        { outcome },
        { auth: true },
      );
      const parsed = donationSchema.safeParse(payload);
      // La respuesta debe ser una donación en el estado terminal que se pidió.
      if (!parsed.success || parsed.data.status !== outcome) {
        throw new ApiError(502, "INVALID_RESPONSE", "La respuesta del servidor no es válida.");
      }
      return parsed.data;
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const run = (outcome: DonationOutcome) => {
    if (inFlight.current) return; // evita el doble envío (confirmar y rechazar a la vez)
    inFlight.current = true;
    mutation.reset();
    mutation.mutate(outcome);
  };

  const header = (
    <>
      <h1 className="text-2xl font-semibold">Simulación de donación</h1>
      <p className="mt-1 font-medium text-slate-800">{DISCLAIMER}</p>
    </>
  );

  if (!idIsValid) {
    return (
      <section>
        {header}
        <p className="mt-6 text-slate-800">Donación no encontrada.</p>
        <Link to="/" className={`mt-3 inline-block text-blue-900 underline ${focusRing}`}>
          Volver al catálogo
        </Link>
      </section>
    );
  }

  if (mutation.isSuccess) {
    const donation = mutation.data;
    const confirmed = donation.status === "CONFIRMADA_SIMULADA";
    return (
      <section>
        {header}
        <div className="mt-6 rounded border border-green-300 bg-green-50 p-4 text-green-950">
          <h2 className="text-lg font-semibold">
            {confirmed ? "Donación confirmada (simulada)" : "Donación rechazada (simulada)"}
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <dt>Importe</dt>
            <dd>{formatPen(donation.amountCents)}</dd>
          </dl>
          {!confirmed && (
            <p className="mt-2">Una donación rechazada no suma al total del proyecto.</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Link to="/me/donations" className={`text-blue-900 underline ${focusRing}`}>
              Mis donaciones
            </Link>
            <Link to="/" className={`text-blue-900 underline ${focusRing}`}>
              Volver al catálogo
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // Un 409 indica que la donación ya es terminal: no se ofrecen más transiciones.
  const terminal = mutation.error instanceof ApiError && mutation.error.status === 409;
  const disabled = mutation.isPending || terminal;

  return (
    <section aria-labelledby="titulo-simulacion">
      {header}
      <p className="mt-4 text-slate-800">
        Elija el resultado de esta donación. No se solicita ningún dato de pago.
      </p>

      {mutation.isError && (
        <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-red-900">
          {messageFor(mutation.error)}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={disabled}
          aria-busy={mutation.isPending}
          onClick={() => run("CONFIRMADA_SIMULADA")}
          className={`rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60 ${focusRing}`}
        >
          {mutation.isPending ? "Procesando…" : "Confirmar donación (simulada)"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => run("RECHAZADA_SIMULADA")}
          className={`rounded border border-slate-400 px-4 py-2 font-medium hover:bg-slate-100 disabled:opacity-60 ${focusRing}`}
        >
          Rechazar donación (simulada)
        </button>
      </div>

      {terminal && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Link to="/me/donations" className={`text-blue-900 underline ${focusRing}`}>
            Mis donaciones
          </Link>
          <Link to="/" className={`text-blue-900 underline ${focusRing}`}>
            Volver al catálogo
          </Link>
        </div>
      )}
    </section>
  );
}
