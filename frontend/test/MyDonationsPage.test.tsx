/**
 * T098 — MyDonationsPage: estados de lista, vacío y error; visualización de campos públicos y
 * enlace a la simulación para donaciones pendientes (CA-07.1, CA-07.2).
 * Usa un fetch simulado; nunca toca la red.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../src/auth/AuthProvider";
import { MyDonationsPage } from "../src/pages/MyDonationsPage";
import { fakeAuth, TOKEN } from "./helpers";

const BASE = "https://api.example.com/academic";
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const DONATION_ID_1 = "00000000-0000-4000-8000-0000000000d1";
const DONATION_ID_2 = "00000000-0000-4000-8000-0000000000d2";

const donation = (overrides: Record<string, unknown> = {}) => ({
  donationId: DONATION_ID_1,
  projectId: PROJECT_ID,
  amountCents: 2500,
  currency: "PEN",
  status: "PENDIENTE_SIMULACION",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const errorEnvelope = {
  code: "INTERNAL_ERROR",
  message: "Error al consultar donaciones.",
  requestId: "r-hist-1",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", BASE);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function renderPage(authToken: string | null = TOKEN) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider
        value={fakeAuth({
          status: authToken ? "authenticated" : "unauthenticated",
          getAccessToken: () => authToken,
        })}
      >
        <MemoryRouter>
          <MyDonationsPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("carga y autenticación", () => {
  it("muestra estado de carga accesible", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(/Cargando donaciones…/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adjunta el Bearer access token en la cabecera Authorization", async () => {
    fetchMock.mockResolvedValue(json(200, []));
    renderPage(TOKEN);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/donations/me`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${TOKEN}`);
  });
});

describe("listado de donaciones propias (CA-07.1)", () => {
  it("muestra fecha, importe en PEN, estado y enlace de simulación para donaciones pendientes", async () => {
    fetchMock.mockResolvedValue(
      json(200, [
        donation(),
        donation({
          donationId: DONATION_ID_2,
          amountCents: 10_000,
          status: "CONFIRMADA_SIMULADA",
        }),
      ]),
    );
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: /Mis donaciones/i })).toBeInTheDocument();
    expect(await screen.findByText("S/ 25.00")).toBeInTheDocument();
    expect(screen.getByText("S/ 100.00")).toBeInTheDocument();
    expect(screen.getByText(/PENDIENTE_SIMULACION/i)).toBeInTheDocument();
    expect(screen.getByText(/CONFIRMADA_SIMULADA/i)).toBeInTheDocument();

    const simulateLink = screen.getByRole("link", { name: /Simular resultado/i });
    expect(simulateLink).toHaveAttribute("href", `/donations/${DONATION_ID_1}/simulate`);
  });

  it("nunca expone identificadores de donantes ni atributos ajenos", async () => {
    fetchMock.mockResolvedValue(json(200, [donation()]));
    const { container } = renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(container.textContent).not.toMatch(/donorSub|sub|password|secret/i);
  });
});

describe("estado vacío (CA-07.1)", () => {
  it("cuando la lista está vacía ([]), muestra mensaje amigable con enlace al catálogo", async () => {
    fetchMock.mockResolvedValue(json(200, []));
    renderPage();

    expect(await screen.findByText(/Aún no has realizado ninguna donación/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Ver proyectos disponibles/i });
    expect(link).toHaveAttribute("href", "/");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("estado de error técnico", () => {
  it("muestra alerta genérica con botón de reintentar ante fallo", async () => {
    fetchMock.mockResolvedValue(json(500, errorEnvelope));
    const { container } = renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/No se pudieron cargar tus donaciones/i);
    expect(container.textContent).not.toMatch(/INTERNAL_ERROR|r-hist-1/);

    const retry = screen.getByRole("button", { name: /Reintentar/i });
    expect(retry).toBeInTheDocument();
  });

  it("permite reintentar tras error y recupera la lista", async () => {
    fetchMock
      .mockResolvedValueOnce(json(500, errorEnvelope))
      .mockResolvedValueOnce(json(200, [donation()]));
    renderPage();

    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("S/ 25.00")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("validación estricta de la respuesta", () => {
  it.each([
    ["importe decimal", { amountCents: 100.5 }],
    ["importe negativo", { amountCents: -50 }],
    ["moneda distinta", { currency: "USD" }],
    ["campo de donorSub expuesto", { donorSub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
  ])("una respuesta con %s se rechaza y cae a alerta de error", async (_label, patch) => {
    fetchMock.mockResolvedValue(json(200, [donation(patch)]));
    const { container } = renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(container.textContent).not.toContain("aaaaaaaa");
  });
});
