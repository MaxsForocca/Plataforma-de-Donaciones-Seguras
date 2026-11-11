/**
 * T039 — CatalogPage: estados de carga, vacío y error, y visualización de los indicadores agregados
 * (CA-01.1, CA-01.3, CA-09.1, CA-09.2). Usa un fetch simulado; nunca toca la red.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../src/auth/AuthProvider";
import { CatalogPage } from "../src/pages/CatalogPage";
import { fakeAuth, TOKEN } from "./helpers";

const BASE = "https://api.example.com/academic";
const ID_1 = "00000000-0000-4000-8000-000000000001";
const ID_2 = "00000000-0000-4000-8000-000000000002";

const project = (overrides: Record<string, unknown> = {}) => ({
  projectId: ID_1,
  title: "Biblioteca comunitaria",
  description: "Libros para el barrio",
  goalAmountCents: 500_000,
  confirmedAmountCents: 10_000,
  currency: "PEN",
  ...overrides,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errorEnvelope = {
  code: "INTERNAL_ERROR",
  message: "Ocurrió un error interno.",
  requestId: "r-1",
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

function renderPage(authToken: string | null = null) {
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
          <CatalogPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("carga", () => {
  it("muestra un estado de carga accesible mientras llegan los datos", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "Catálogo de proyectos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando proyectos");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("pide GET /v1/projects sin Authorization, aunque haya una sesión (es público)", async () => {
    fetchMock.mockResolvedValue(json(200, []));
    renderPage(TOKEN);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/projects`);
    expect(init.method).toBe("GET");
    expect(Object.keys(init.headers as object).map((h) => h.toLowerCase())).not.toContain(
      "authorization",
    );
  });

  it("no envía parámetros de consulta (la API rechaza los de paginación)", async () => {
    fetchMock.mockResolvedValue(json(200, []));
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as [string])[0]).not.toContain("?");
  });
});

describe("lista de proyectos (CA-01.1, CA-09.1)", () => {
  it("muestra nombre, finalidad, meta y suma confirmada simulada en PEN", async () => {
    fetchMock.mockResolvedValue(json(200, [project()]));
    renderPage();

    const item = await screen.findByRole("listitem");
    expect(
      within(item).getByRole("heading", { level: 2, name: "Biblioteca comunitaria" }),
    ).toBeInTheDocument();
    expect(within(item).getByText("Libros para el barrio")).toBeInTheDocument();
    expect(within(item).getByText("S/ 5,000.00")).toBeInTheDocument();
    expect(within(item).getByText("S/ 100.00")).toBeInTheDocument();
  });

  it("indica que los montos son simulados (sin cobro real)", async () => {
    fetchMock.mockResolvedValue(json(200, [project()]));
    renderPage();
    await screen.findByRole("listitem");
    expect(screen.getAllByText(/simulad/i).length).toBeGreaterThan(0);
  });

  it("enlaza cada proyecto con su detalle", async () => {
    fetchMock.mockResolvedValue(json(200, [project()]));
    renderPage();
    const link = await screen.findByRole("link", { name: /Biblioteca comunitaria/ });
    expect(link).toHaveAttribute("href", `/projects/${ID_1}`);
  });

  it("conserva el orden recibido y muestra varios proyectos", async () => {
    fetchMock.mockResolvedValue(
      json(200, [project({ projectId: ID_2, title: "Segundo" }), project({ title: "Primero" })]),
    );
    renderPage();
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("heading", { level: 2 })).toHaveTextContent("Segundo");
    expect(within(items[1]!).getByRole("heading", { level: 2 })).toHaveTextContent("Primero");
  });

  it.each([
    [0, 0],
    [10_000, 2],
    [250_000, 50],
    [499_999, 99],
    [500_000, 100],
    [900_000, 100],
  ])("el avance de %i céntimos sobre la meta de 500000 es %i %%", async (confirmed, percent) => {
    fetchMock.mockResolvedValue(json(200, [project({ confirmedAmountCents: confirmed })]));
    renderPage();
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("value", String(percent));
    expect(bar).toHaveAttribute("max", "100");
    expect(screen.getByText(`${percent} %`, { exact: false })).toBeInTheDocument();
  });

  it("la barra de avance tiene un nombre accesible con el proyecto", async () => {
    fetchMock.mockResolvedValue(json(200, [project()]));
    renderPage();
    expect(
      await screen.findByRole("progressbar", { name: /Biblioteca comunitaria/ }),
    ).toBeInTheDocument();
  });

  it("no muestra identificadores de donantes ni registros individuales (CA-09.2)", async () => {
    fetchMock.mockResolvedValue(json(200, [project()]));
    const { container } = renderPage();
    await screen.findByRole("listitem");
    expect(container.textContent).not.toMatch(/donor|donante|donationId/i);
  });

  it("los caracteres especiales (&, comillas) se muestran como texto, nunca como HTML", async () => {
    fetchMock.mockResolvedValue(
      json(200, [project({ title: `Tom & "Jerry" 'x'`, description: "a &lt;b&gt; &amp; c" })]),
    );
    const { container } = renderPage();
    await screen.findByRole("listitem");
    expect(container.textContent).toContain(`Tom & "Jerry" 'x'`);
    expect(container.textContent).toContain("a &lt;b&gt; &amp; c"); // sin interpretar entidades
  });

  it("un título o descripción con etiquetas HTML no se muestra: el catálogo cae al estado de error (sin XSS)", async () => {
    fetchMock.mockResolvedValue(
      json(200, [
        project({
          title: "<img src=x onerror=alert(1)>",
          description: "<script>alert(1)</script>",
        }),
      ]),
    );
    const { container } = renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("onerror");
  });
});

describe("estado vacío (CA-01.3)", () => {
  it("sin proyectos publicados muestra un mensaje comprensible, sin errores técnicos", async () => {
    fetchMock.mockResolvedValue(json(200, []));
    const { container } = renderPage();
    expect(await screen.findByText(/Aún no hay proyectos publicados/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/error|undefined|null|\[\]|500|exception/i);
  });
});

describe("estado de error", () => {
  it("un 500 muestra una alerta genérica, sin códigos ni detalles técnicos", async () => {
    fetchMock.mockResolvedValue(json(500, errorEnvelope));
    const { container } = renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/No se pudieron cargar los proyectos/i);
    expect(container.textContent).not.toMatch(/INTERNAL_ERROR|500|r-1|stack|exception/);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("un fallo de red muestra la misma alerta", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No se pudieron cargar los proyectos/i,
    );
  });

  it("un 400 (parámetros inválidos) también se presenta de forma genérica", async () => {
    fetchMock.mockResolvedValue(
      json(400, { code: "INVALID_REQUEST", message: "La solicitud no es válida.", requestId: "r" }),
    );
    const { container } = renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/INVALID_REQUEST/);
  });

  it("permite reintentar y recupera la lista", async () => {
    fetchMock
      .mockResolvedValueOnce(json(500, errorEnvelope))
      .mockResolvedValueOnce(json(200, [project()]));
    renderPage();
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("listitem")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("validación de la respuesta (los datos del servidor no se confían a ciegas)", () => {
  it.each([
    ["meta decimal", { goalAmountCents: 100.5 }],
    ["acumulado decimal", { confirmedAmountCents: 1.5 }],
    ["acumulado negativo", { confirmedAmountCents: -1 }],
    ["importe como texto", { goalAmountCents: "500000" }],
    ["moneda distinta", { currency: "USD" }],
    ["id inválido", { projectId: "no-es-uuid" }],
    ["campo de donante inesperado", { donorSub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    ["estado interno expuesto", { status: "BORRADOR" }],
  ])("una respuesta con %s se trata como error y no se muestra", async (_label, patch) => {
    fetchMock.mockResolvedValue(json(200, [project(patch)]));
    const { container } = renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("aaaaaaaa");
  });

  it("una respuesta que no es un arreglo se trata como error", async () => {
    fetchMock.mockResolvedValue(json(200, { projects: [] }));
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("un solo proyecto inválido invalida todo el catálogo (no se muestra uno parcial)", async () => {
    fetchMock.mockResolvedValue(
      json(200, [project(), project({ projectId: ID_2, goalAmountCents: 1.5 })]),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Biblioteca comunitaria")).not.toBeInTheDocument();
  });
});
