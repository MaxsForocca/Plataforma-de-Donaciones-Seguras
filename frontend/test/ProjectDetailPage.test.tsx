/**
 * T091 — ProjectDetailPage: estados 200, 404, carga y error; indicadores agregados y ausencia de
 * datos de donantes (CA-02.1, CA-02.2). Usa un fetch simulado; nunca toca la red.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../src/auth/AuthProvider";
import { ProjectDetailPage } from "../src/pages/ProjectDetailPage";
import { fakeAuth, TOKEN } from "./helpers";

const BASE = "https://api.example.com/academic";
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";

const sampleProject = (overrides: Record<string, unknown> = {}) => ({
  projectId: PROJECT_ID,
  title: "Biblioteca comunitaria",
  description: "Espacio cultural y educativo para el barrio.",
  goalAmountCents: 500_000,
  confirmedAmountCents: 10_000,
  currency: "PEN",
  status: "PUBLICADO",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const errorEnvelope = (code = "NOT_FOUND", message = "No encontrado.") => ({
  code,
  message,
  requestId: "r-detail-1",
});

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

function renderPage(projectId: string = PROJECT_ID, authToken: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider
        value={fakeAuth({
          status: authToken ? "authenticated" : "unauthenticated",
          getAccessToken: () => authToken,
        })}
      >
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <Routes>
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("carga", () => {
  it("muestra estado de carga accesible", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(/Cargando detalle del proyecto/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("es público: pide GET /v1/projects/{projectId} sin header Authorization aunque haya sesión", async () => {
    fetchMock.mockResolvedValue(json(200, sampleProject()));
    renderPage(PROJECT_ID, TOKEN);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/projects/${PROJECT_ID}`);
    expect(init.method).toBe("GET");
    expect(Object.keys(init.headers as object).map((h) => h.toLowerCase())).not.toContain(
      "authorization",
    );
  });
});

describe("detalle de proyecto (200 OK — CA-02.1)", () => {
  it("muestra título, descripción, meta y recaudado simulado en PEN", async () => {
    fetchMock.mockResolvedValue(json(200, sampleProject()));
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Biblioteca comunitaria" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Espacio cultural y educativo para el barrio."),
    ).toBeInTheDocument();
    expect(screen.getByText("S/ 5,000.00")).toBeInTheDocument();
    expect(screen.getByText("S/ 100.00")).toBeInTheDocument();
  });

  it("indica advertencia de montos simulados (sin pagos reales)", async () => {
    fetchMock.mockResolvedValue(json(200, sampleProject()));
    renderPage();
    await screen.findByRole("heading", { name: "Biblioteca comunitaria" });
    expect(screen.getAllByText(/simulad/i).length).toBeGreaterThan(0);
  });

  it("muestra barra de progreso accesible con porcentaje de avance", async () => {
    fetchMock.mockResolvedValue(json(200, sampleProject()));
    renderPage();
    const progress = await screen.findByRole("progressbar");
    expect(progress).toHaveAttribute("value", "2");
    expect(progress).toHaveAttribute("max", "100");
    expect(screen.getByText(/Avance: 2 %/i)).toBeInTheDocument();
  });

  it("incluye enlace para donar al proyecto y enlace para volver al catálogo", async () => {
    fetchMock.mockResolvedValue(json(200, sampleProject()));
    renderPage();
    const donateLink = await screen.findByRole("link", { name: /Donar/i });
    expect(donateLink).toHaveAttribute("href", `/donate/${PROJECT_ID}`);
    const backLink = screen.getByRole("link", { name: /Volver al catálogo/i });
    expect(backLink).toHaveAttribute("href", "/");
  });

  it("nunca muestra datos de donantes ni identificadores internos", async () => {
    fetchMock.mockResolvedValue(json(200, sampleProject()));
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Biblioteca comunitaria" });
    expect(container.textContent).not.toMatch(/donor|createdBySub|donationId|idempotency/i);
  });
});

describe("proyecto no encontrado o no publicado (404 Not Found — CA-02.2)", () => {
  it("muestra mensaje de no encontrado sin detalles técnicos ante 404", async () => {
    fetchMock.mockResolvedValue(json(404, errorEnvelope("NOT_FOUND", "No encontrado.")));
    const { container } = renderPage(MISSING_ID);

    expect(
      await screen.findByRole("heading", { name: /Proyecto no encontrado/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/El proyecto solicitado no existe o no se encuentra publicado/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver al catálogo/i })).toHaveAttribute("href", "/");
    expect(container.textContent).not.toMatch(/NOT_FOUND|r-detail-1|stack|exception|500/);
  });

  it("un proyecto en borrador responde 404 y muestra la misma pantalla", async () => {
    fetchMock.mockResolvedValue(json(404, errorEnvelope("NOT_FOUND", "No encontrado.")));
    renderPage(DRAFT_ID);

    expect(
      await screen.findByRole("heading", { name: /Proyecto no encontrado/i }),
    ).toBeInTheDocument();
  });
});

describe("estado de error técnico (500 / red)", () => {
  it("un 500 muestra una alerta genérica con botón de reintentar", async () => {
    fetchMock.mockResolvedValue(json(500, errorEnvelope("INTERNAL_ERROR", "Error de base de datos.")));
    const { container } = renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/No se pudo cargar el detalle del proyecto/i);
    expect(container.textContent).not.toMatch(/INTERNAL_ERROR|Error de base de datos/);

    const retryButton = screen.getByRole("button", { name: /Reintentar/i });
    expect(retryButton).toBeInTheDocument();
  });

  it("permite reintentar tras un error técnico y recupera los datos", async () => {
    fetchMock
      .mockResolvedValueOnce(json(500, errorEnvelope("INTERNAL_ERROR", "Error.")))
      .mockResolvedValueOnce(json(200, sampleProject()));

    renderPage();
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(
      await screen.findByRole("heading", { name: "Biblioteca comunitaria" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("validación estricta de la respuesta", () => {
  it.each([
    ["meta decimal", { goalAmountCents: 100.5 }],
    ["acumulado decimal", { confirmedAmountCents: 1.5 }],
    ["acumulado negativo", { confirmedAmountCents: -10 }],
    ["moneda distinta a PEN", { currency: "USD" }],
    ["título con HTML", { title: "<script>alert(1)</script>" }],
    ["campo de donante expuesto", { donorSub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
  ])("una respuesta con %s se rechaza y cae al estado de error", async (_label, patch) => {
    fetchMock.mockResolvedValue(json(200, sampleProject(patch)));
    const { container } = renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Biblioteca comunitaria" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("aaaaaaaa");
  });
});
