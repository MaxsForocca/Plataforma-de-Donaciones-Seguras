/**
 * Registro de una intención de donación simulada (T076; CA-05.1–CA-05.5). El importe se escribe en
 * soles y se convierte a céntimos ENTEROS con aritmética de texto (nunca punto flotante). Solo se
 * envía `{ projectId, amountCents }` con una `Idempotency-Key` UUID v4: el rol, el `donorSub`, los ids
 * y el estado los decide siempre el servidor. La clave se reutiliza al reintentar el MISMO importe tras
 * un fallo (no se duplica la donación) y cambia con otro importe o tras un éxito. No se pide ningún
 * dato de pago. La autorización real es del backend; esta página es solo UX.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { AMOUNT_MAX_CENTS, AMOUNT_MIN_CENTS, donationSchema, uuidSchema } from "@donaciones/shared";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router";
import { z } from "zod";
import { ApiError } from "../services/apiClient";
import { formatPen, parsePenToCents } from "../services/money";
import { generateUuid } from "../services/uuid";
import { useApiClient } from "../services/useApiClient";
import { useProjects } from "../services/useProjects";

const RANGE_MESSAGE = `El importe debe estar entre ${formatPen(AMOUNT_MIN_CENTS)} y ${formatPen(AMOUNT_MAX_CENTS)}.`;

const formSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Ingrese un importe.")
    .superRefine((value, context) => {
      const cents = parsePenToCents(value);
      if (cents === null) {
        context.addIssue({
          code: "custom",
          message: "Use el formato 25.50: solo números y hasta 2 decimales.",
        });
      } else if (cents < AMOUNT_MIN_CENTS || cents > AMOUNT_MAX_CENTS) {
        context.addIssue({ code: "custom", message: RANGE_MESSAGE });
      }
    }),
});
type FormValues = z.infer<typeof formSchema>;

/** Mensajes seguros por estado: nunca se muestra el texto ni el código del servidor. */
function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400 && error.code === "INVALID_AMOUNT") {
      return `El importe no es válido. Debe estar entre ${formatPen(AMOUNT_MIN_CENTS)} y ${formatPen(AMOUNT_MAX_CENTS)}.`;
    }
    if (error.status === 400) return "Revise los datos e inténtelo nuevamente.";
    if (error.status === 401) return "Su sesión expiró. Inicie sesión nuevamente.";
    if (error.status === 403) return "Su cuenta no tiene permiso para registrar donaciones.";
    if (error.status === 404) return "El proyecto ya no existe.";
    if (error.status === 409) return "Este proyecto no está disponible para recibir donaciones.";
  }
  return "No se pudo registrar la donación. Inténtelo nuevamente: no se duplicará aunque repita el envío.";
}

export interface DonationPageProps {
  /** Generador de `Idempotency-Key` (inyectable en pruebas). */
  createKey?: () => string;
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

export function DonationPage({ createKey = generateUuid }: DonationPageProps) {
  const { projectId = "" } = useParams();
  const api = useApiClient();
  const projects = useProjects();
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { amount: "" },
  });

  const mutation = useMutation({
    mutationFn: async ({ cents, key }: { cents: number; key: string }) => {
      const payload = await api.post<unknown>(
        "/v1/donations",
        { projectId, amountCents: cents },
        { auth: true, headers: { "Idempotency-Key": key } },
      );
      const parsed = donationSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(502, "INVALID_RESPONSE", "La respuesta del servidor no es válida.");
      }
      return parsed.data;
    },
  });

  const onSubmit = form.handleSubmit(({ amount }) => {
    if (inFlight.current) return; // evita el doble envío
    const cents = parsePenToCents(amount);
    if (cents === null) return;

    // Misma carga ⇒ misma clave (reintento seguro); otra carga ⇒ otra operación y otra clave.
    const signature = `${projectId}:${cents}`;
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: createKey() };
    }

    inFlight.current = true;
    mutation.reset();
    mutation.mutate(
      { cents, key: attempt.current.key },
      {
        onSuccess: () => {
          attempt.current = null;
        },
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  });

  const project = projects.data?.find((candidate) => candidate.projectId === projectId);
  const idIsValid = uuidSchema.safeParse(projectId).success;
  const amountError = form.formState.errors.amount?.message;

  const header = (
    <>
      <h1 className="text-2xl font-semibold">Donar</h1>
      <p className="mt-1 text-slate-700">
        Simulación académica: no se solicitan ni se almacenan datos de tarjeta, cuenta bancaria ni
        DNI, y no se realiza ningún cobro.
      </p>
    </>
  );

  if (!idIsValid || (projects.isSuccess && !project)) {
    return (
      <section aria-labelledby="titulo-donar">
        {header}
        <p className="mt-6 text-slate-800">
          Este proyecto no está disponible para recibir donaciones.
        </p>
        <Link to="/" className={`mt-3 inline-block text-blue-900 underline ${focusRing}`}>
          Volver al catálogo
        </Link>
      </section>
    );
  }

  if (projects.isPending) {
    return (
      <section>
        {header}
        <p role="status" className="mt-6 text-slate-700">
          Cargando proyecto…
        </p>
      </section>
    );
  }

  if (projects.isError || !project) {
    return (
      <section>
        {header}
        <div role="alert" className="mt-6 rounded border border-red-300 bg-red-50 p-4 text-red-900">
          <p>No se pudo cargar el proyecto. Inténtelo nuevamente.</p>
          <button
            type="button"
            onClick={() => void projects.refetch()}
            className={`mt-3 rounded bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900 ${focusRing}`}
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  if (mutation.isSuccess) {
    const donation = mutation.data;
    return (
      <section>
        {header}
        <div className="mt-6 rounded border border-green-300 bg-green-50 p-4 text-green-950">
          <h2 className="text-lg font-semibold">Donación registrada</h2>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <dt>Proyecto</dt>
            <dd>{project.title}</dd>
            <dt>Importe</dt>
            <dd>{formatPen(donation.amountCents)}</dd>
            <dt>Estado</dt>
            <dd>Pendiente de simulación</dd>
          </dl>
          <p className="mt-2">Simulación académica: no se ha realizado ningún cobro.</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Link
              to={`/donations/${donation.donationId}/simulate`}
              className={`rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 ${focusRing}`}
            >
              Simular confirmación
            </Link>
            <button
              type="button"
              onClick={() => {
                mutation.reset();
                form.reset();
              }}
              className={`rounded border border-slate-400 px-4 py-2 font-medium hover:bg-slate-100 ${focusRing}`}
            >
              Donar de nuevo
            </button>
            <Link to="/" className={`text-blue-900 underline ${focusRing}`}>
              Volver al catálogo
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="titulo-donar">
      {header}
      <p className="mt-4 text-lg">
        Proyecto: <strong>{project.title}</strong>
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-4 max-w-sm">
        <label htmlFor="amount" className="block font-medium">
          Importe en soles (S/)
        </label>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={amountError ? "true" : "false"}
          aria-describedby={amountError ? "amount-hint amount-error" : "amount-hint"}
          className={`mt-1 w-full rounded border border-slate-400 px-3 py-2 ${focusRing}`}
          {...form.register("amount")}
        />
        <p id="amount-hint" className="mt-1 text-sm text-slate-700">
          Entre {formatPen(AMOUNT_MIN_CENTS)} y {formatPen(AMOUNT_MAX_CENTS)}, hasta 2 decimales.
        </p>
        {amountError && (
          <p id="amount-error" role="alert" className="mt-1 text-sm text-red-800">
            {amountError}
          </p>
        )}

        {mutation.isError && (
          <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-red-900">
            {messageFor(mutation.error)}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          aria-busy={mutation.isPending}
          className={`mt-4 rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60 ${focusRing}`}
        >
          {mutation.isPending ? "Enviando…" : "Donar"}
        </button>
      </form>
    </section>
  );
}
