/**
 * T083 — SimulationPage: muestra el texto exacto «Simulación académica: no se ha realizado ningún
 * cobro» (CA-06.4), permite confirmar o rechazar, envía solo `{ outcome }` y maneja 400/401/403/404/409
 * y fallos de red con mensajes seguros. Usa un fetch simulado; nunca toca la red.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../src/auth/AuthProvider";
import { SimulationPage } from "../src/pages/SimulationPage";
import { fakeAuth, TOKEN } from "./helpers";

const BASE = "https://api.example.com/academic";
const DONATION_ID = "00000000-0000-4000-8000-0000000000d1";
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const DISCLAIMER = "Simulación académica: no se ha realizado ningún cobro";

const donation = (overrides: Record<string, unknown> = {}) => ({
  donationId: DONATION_ID,
  projectId: PROJECT_ID,
  amountCents: 2550,
  currency: "PEN",
  status: "CONFIRMADA_SIMULADA",
  createdAt: "2026-11-11T12:00:00.000Z",
  updatedAt: "2026-11-11T12:05:00.000Z",
  ...overrides,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const envelope = (code: string) => ({ code, message: "msg", requestId: "r-1" });

let fetchMock: ReturnType<typeof vi.fn>;
let handler: (init: RequestInit) => Response | Promise<Response>;

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", BASE);
  handler = (init) => json(200, donation({ status: JSON.parse(init.body as string).outcome }));
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => handler(init as RequestInit));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const posts = () => fetchMock.mock.calls as [string, RequestInit][];

function renderPage(options: { donationId?: string; token?: string | null } = {}) {
  const { donationId = DONATION_ID, token = TOKEN } = options;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider
        value={fakeAuth({ status: "authenticated", getAccessToken: () => token })}
      >
        <MemoryRouter initialEntries={[`/donations/${donationId}/simulate`]}>
          <Routes>
            <Route path="/donations/:donationId/simulate" element={<SimulationPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}
const confirmButton = () => screen.getByRole("button", { name: /Confirmar donación/ });
const rejectButton = () => screen.getByRole("button", { name: /Rechazar donación/ });

describe("aviso académico (CA-06.4)", () => {
  it("muestra el texto EXACTO «Simulación académica: no se ha realizado ningún cobro»", () => {
    renderPage();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("el aviso sigue visible tras confirmar, tras rechazar y tras un error", async () => {
    renderPage();
    await userEvent.click(confirmButton());
    await screen.findByText(/Donación confirmada/);
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("el aviso sigue visible tras un rechazo del servidor", async () => {
    handler = () => json(409, envelope("CONFLICT"));
    renderPage();
    await userEvent.click(confirmButton());
    await screen.findByRole("alert");
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("tiene un encabezado principal y dos acciones claramente nombradas", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "Simulación de donación" }),
    ).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
    expect(rejectButton()).toBeEnabled();
  });
});

describe("solicitud (CA-06.1, CA-06.2)", () => {
  it.each([
    ["confirmar", () => confirmButton(), "CONFIRMADA_SIMULADA"],
    ["rechazar", () => rejectButton(), "RECHAZADA_SIMULADA"],
  ])(
    "%s envía POST con el resultado elegido y SOLO { outcome }",
    async (_label, button, outcome) => {
      renderPage();
      await userEvent.click(button());
      await waitFor(() => expect(posts()).toHaveLength(1));
      const [url, init] = posts()[0]!;
      const headers = init.headers as Record<string, string>;
      expect(url).toBe(`${BASE}/v1/donations/${DONATION_ID}/simulate`);
      expect(init.method).toBe("POST");
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.parse(init.body as string)).toEqual({ outcome });
    },
  );

  it("no manda importe, donorSub, rol, estado ni ids de proyecto: la verdad es del servidor", async () => {
    renderPage();
    await userEvent.click(confirmButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    const text = `${posts()[0]![1].body} ${JSON.stringify(posts()[0]![1].headers)}`;
    expect(text).not.toMatch(
      /amount|donorSub|roles|groups|role|status|projectId|confirmed|x-user/i,
    );
  });

  it("el id sale de la ruta de la URL", async () => {
    const other = "00000000-0000-4000-8000-0000000000d9";
    renderPage({ donationId: other });
    await userEvent.click(confirmButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe(`${BASE}/v1/donations/${other}/simulate`);
  });
});

describe("resultado exitoso (200)", () => {
  it("confirmar muestra la donación confirmada (simulada) con el importe que devolvió el servidor", async () => {
    renderPage();
    await userEvent.click(confirmButton());
    expect(await screen.findByText(/Donación confirmada \(simulada\)/)).toBeInTheDocument();
    expect(screen.getByText("S/ 25.50")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirmar donación/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rechazar donación/ })).not.toBeInTheDocument();
  });

  it("rechazar muestra la donación rechazada (simulada) y aclara que no suma al total", async () => {
    renderPage();
    await userEvent.click(rejectButton());
    expect(await screen.findByText(/Donación rechazada \(simulada\)/)).toBeInTheDocument();
    expect(screen.getByText(/no suma al total/i)).toBeInTheDocument();
  });

  it("ofrece ir a «Mis donaciones» y volver al catálogo", async () => {
    renderPage();
    await userEvent.click(confirmButton());
    await screen.findByText(/Donación confirmada/);
    expect(screen.getByRole("link", { name: "Mis donaciones" })).toHaveAttribute(
      "href",
      "/me/donations",
    );
    expect(screen.getByRole("link", { name: "Volver al catálogo" })).toHaveAttribute("href", "/");
  });

  it("muestra el importe del servidor, no uno calculado en el navegador", async () => {
    handler = () => json(200, donation({ amountCents: 100_000 }));
    renderPage();
    await userEvent.click(confirmButton());
    expect(await screen.findByText("S/ 1,000.00")).toBeInTheDocument();
  });
});

describe("errores del servidor (mensajes seguros)", () => {
  const cases: [string, number, unknown, RegExp][] = [
    [
      "409 estado terminal",
      409,
      envelope("CONFLICT"),
      /ya fue procesada; no se puede simular de nuevo/i,
    ],
    ["404", 404, envelope("NOT_FOUND"), /no existe o no le pertenece/i],
    ["403", 403, envelope("FORBIDDEN"), /no tiene permiso para simular/i],
    ["401", 401, envelope("UNAUTHORIZED"), /sesión expiró/i],
    ["400", 400, envelope("INVALID_REQUEST"), /Revise los datos/i],
    ["500", 500, envelope("INTERNAL_ERROR"), /No se pudo completar la simulación/i],
  ];

  it.each(cases)("%s", async (_label, status, payload, message) => {
    handler = () => json(status, payload);
    const { container } = renderPage();
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(container.textContent).not.toMatch(
      /CONFLICT|NOT_FOUND|FORBIDDEN|UNAUTHORIZED|INVALID_REQUEST|INTERNAL_ERROR|r-1|requestId/,
    );
  });

  it("tras un 409 no se ofrecen más transiciones (la donación ya es terminal)", async () => {
    handler = () => json(409, envelope("CONFLICT"));
    renderPage();
    await userEvent.click(confirmButton());
    await screen.findByRole("alert");
    expect(confirmButton()).toBeDisabled();
    expect(rejectButton()).toBeDisabled();
    expect(screen.getByRole("link", { name: "Mis donaciones" })).toBeInTheDocument();
  });

  it("tras un error transitorio (500 o red) se puede reintentar", async () => {
    let calls = 0;
    handler = () =>
      ++calls === 1
        ? Promise.reject(new TypeError("ECONNREFUSED 10.0.0.5"))
        : json(200, donation());
    const { container } = renderPage();
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No se pudo completar la simulación/,
    );
    expect(container.textContent).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    await userEvent.click(confirmButton());
    expect(await screen.findByText(/Donación confirmada/)).toBeInTheDocument();
  });

  it("una respuesta 200 con forma inválida (donorSub o estado pendiente) se trata como error", async () => {
    handler = () => json(200, donation({ donorSub: "aaaaaaaa", status: "PENDIENTE_SIMULACION" }));
    const { container } = renderPage();
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Donación confirmada/)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("aaaaaaaa");
  });

  it("si el servidor responde un estado distinto del solicitado, no se muestra como éxito", async () => {
    handler = () => json(200, donation({ status: "RECHAZADA_SIMULADA" }));
    renderPage();
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Donación rechazada/)).not.toBeInTheDocument();
  });

  it("sin sesión (sin access token) no se envía nada y se pide iniciar sesión", async () => {
    renderPage({ token: null });
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/sesión expiró/i);
    expect(posts()).toHaveLength(0);
  });

  it("el access token no aparece nunca en el DOM", async () => {
    const { container } = renderPage();
    await userEvent.click(confirmButton());
    await screen.findByText(/Donación confirmada/);
    expect(container.innerHTML).not.toContain(TOKEN);
  });
});

describe("doble envío", () => {
  it("un doble clic envía una sola solicitud y deshabilita las acciones mientras procesa", async () => {
    let release: (r: Response) => void = () => {};
    handler = () => new Promise<Response>((resolve) => (release = resolve));
    renderPage();
    await userEvent.dblClick(confirmButton());
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Procesando/ })).toBeDisabled();
    expect(rejectButton()).toBeDisabled();
    release(json(200, donation()));
    await screen.findByText(/Donación confirmada/);
    expect(posts()).toHaveLength(1);
  });

  it("confirmar y rechazar en el mismo instante produce UNA sola solicitud", async () => {
    let release: (r: Response) => void = () => {};
    handler = () => new Promise<Response>((resolve) => (release = resolve));
    renderPage();
    const [confirm, reject] = [confirmButton(), rejectButton()];
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(reject);
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    release(json(200, donation()));
    await screen.findByText(/Donación confirmada/);
    expect(posts()).toHaveLength(1);
  });
});

describe("id inválido", () => {
  it.each(["no-es-uuid", "..%2F..%2Fx", "%3Cscript%3E"])(
    "%s → no se ofrecen acciones ni se envía nada",
    async (id) => {
      renderPage({ donationId: id });
      expect(screen.getByText(/no encontrada|no existe/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Confirmar donación/ })).not.toBeInTheDocument();
      expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
      expect(posts()).toHaveLength(0);
    },
  );
});
