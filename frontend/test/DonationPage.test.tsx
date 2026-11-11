/**
 * T077 — DonationPage: validación del importe, conversión a céntimos enteros, `Idempotency-Key` UUID
 * (se reutiliza al reintentar y cambia con otro importe o tras el éxito), estados 201/400/401/403/404/409
 * y de red, y que el navegador jamás envíe rol, donorSub ni ids como verdad (CA-05.1–CA-05.5).
 * Usa un fetch simulado; nunca toca la red.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../src/auth/AuthProvider";
import { DonationPage } from "../src/pages/DonationPage";
import { fakeAuth, TOKEN } from "./helpers";

const BASE = "https://api.example.com/academic";
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const KEY_1 = "11111111-1111-4111-8111-111111111111";
const KEY_2 = "22222222-2222-4222-8222-222222222222";
const KEY_3 = "33333333-3333-4333-8333-333333333333";
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const project = (overrides: Record<string, unknown> = {}) => ({
  projectId: PROJECT_ID,
  title: "Biblioteca comunitaria",
  description: "Libros",
  goalAmountCents: 500_000,
  confirmedAmountCents: 10_000,
  currency: "PEN",
  ...overrides,
});
const donation = (overrides: Record<string, unknown> = {}) => ({
  donationId: "00000000-0000-4000-8000-0000000000d1",
  projectId: PROJECT_ID,
  amountCents: 2550,
  currency: "PEN",
  status: "PENDIENTE_SIMULACION",
  createdAt: "2026-11-11T12:00:00.000Z",
  updatedAt: "2026-11-11T12:00:00.000Z",
  ...overrides,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const envelope = (code: string, message = "msg") => ({ code, message, requestId: "r-1" });

let fetchMock: ReturnType<typeof vi.fn>;
let postHandler: (init: RequestInit) => Response | Promise<Response>;
let list: unknown[];

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", BASE);
  list = [project(), project({ projectId: OTHER_ID, title: "Otro" })];
  postHandler = () => json(201, donation());
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `${BASE}/v1/projects`) return json(200, list);
    if (url === `${BASE}/v1/donations`) return postHandler(init as RequestInit);
    return json(404, envelope("NOT_FOUND"));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const posts = () =>
  fetchMock.mock.calls.filter(([url]) => url === `${BASE}/v1/donations`) as [string, RequestInit][];

function renderPage(options: { projectId?: string; token?: string | null; keys?: string[] } = {}) {
  const { projectId = PROJECT_ID, token = TOKEN, keys } = options;
  const queue = keys ? [...keys] : undefined;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider
        value={fakeAuth({ status: "authenticated", getAccessToken: () => token })}
      >
        <MemoryRouter initialEntries={[`/donate/${projectId}`]}>
          <Routes>
            <Route
              path="/donate/:projectId"
              element={<DonationPage createKey={queue ? () => queue.shift()! : undefined} />}
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

const amountInput = () => screen.findByRole("textbox", { name: /Importe/ });
async function submit(amount: string) {
  const input = await amountInput();
  await userEvent.clear(input);
  if (amount !== "") await userEvent.type(input, amount);
  await userEvent.click(screen.getByRole("button", { name: /Donar/ }));
}

describe("formulario (CA-05.5: sin datos de pago)", () => {
  it("muestra el proyecto, un único campo de importe con etiqueta y ayuda, y el aviso académico", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Donar" })).toBeInTheDocument();
    expect(await screen.findByText("Biblioteca comunitaria")).toBeInTheDocument();
    const input = await amountInput();
    expect(input).toHaveAccessibleDescription(/1\.00.*1,000\.00/);
    expect(screen.getByText(/no se realiza ningún cobro/i)).toBeInTheDocument();
  });

  it("solo pide el importe: ningún campo de tarjeta, CVV, cuenta bancaria ni DNI", async () => {
    const { container } = renderPage();
    await amountInput();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const names = [...container.querySelectorAll("input, select, textarea")].map(
      (el) =>
        `${el.getAttribute("name")} ${el.getAttribute("id")} ${el.getAttribute("autocomplete")}`,
    );
    expect(names.join(" ")).not.toMatch(/card|cvv|cvc|dni|tarjeta|cuenta|iban|cc-/i);
    expect(container.textContent).toMatch(/no se solicitan ni se almacenan datos de tarjeta/i);
  });

  it("el campo no es numérico del navegador (type=text): el texto se convierte con enteros, no con float", async () => {
    renderPage();
    expect(await amountInput()).toHaveAttribute("type", "text");
    expect(await amountInput()).toHaveAttribute("inputmode", "decimal");
  });
});

describe("validación del importe (sin enviar nada)", () => {
  it.each([
    ["vacío", "", /Ingrese un importe/],
    ["texto", "abc", /formato/i],
    ["cero", "0", /entre S\/ 1\.00 y S\/ 1,000\.00/],
    ["99 céntimos", "0.99", /entre S\/ 1\.00 y S\/ 1,000\.00/],
    ["1000.01", "1000.01", /entre S\/ 1\.00 y S\/ 1,000\.00/],
    ["1001", "1001", /entre S\/ 1\.00 y S\/ 1,000\.00/],
    ["notación científica", "1e2", /formato/i],
    ["negativo", "-5", /formato/i],
    ["coma decimal", "25,50", /formato/i],
    ["3 decimales", "12.345", /formato/i],
    ["solo símbolo", "S/", /formato/i],
    ["punto final", "5.", /formato/i],
  ])("%s → mensaje accesible y ninguna petición", async (_label, text, message) => {
    renderPage();
    await submit(text);
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(message);
    expect(await amountInput()).toHaveAttribute("aria-invalid", "true");
    expect(posts()).toHaveLength(0);
  });

  it("al corregir el valor desaparece el error", async () => {
    renderPage();
    await submit("abc");
    await screen.findByRole("alert");
    await submit("10");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("conversión a céntimos enteros y forma de la solicitud (CA-05.1, CA-05.3)", () => {
  it.each([
    ["1", 100],
    ["1.00", 100],
    ["1.5", 150],
    ["25.50", 2550],
    ["19.99", 1999],
    ["S/ 25.50", 2550],
    ["1,000.00", 100_000],
    ["1000", 100_000],
    ["999.99", 99_999],
    ["  12.5  ", 1250],
  ])("%j se envía como amountCents = %i (entero)", async (text, cents) => {
    renderPage({ keys: [KEY_1] });
    await submit(text);
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(posts()[0]![1].body as string);
    expect(body.amountCents).toBe(cents);
    expect(Number.isInteger(body.amountCents)).toBe(true);
  });

  it("envía POST /v1/donations con Bearer, JSON, Idempotency-Key y SOLO { projectId, amountCents }", async () => {
    renderPage({ keys: [KEY_1] });
    await submit("25.50");
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [url, init] = posts()[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe(`${BASE}/v1/donations`);
    expect(init.method).toBe("POST");
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe(KEY_1);
    expect(JSON.parse(init.body as string)).toEqual({ projectId: PROJECT_ID, amountCents: 2550 });
  });

  it("el navegador no manda rol, grupos, donorSub, estado, ids ni acumulado", async () => {
    renderPage({ keys: [KEY_1] });
    await submit("25.50");
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [, init] = posts()[0]!;
    const text = `${init.body} ${JSON.stringify(init.headers)}`;
    expect(text).not.toMatch(
      /donorSub|roles|groups|role|status|donationId|confirmed|currency|x-user/i,
    );
    expect(
      Object.keys(init.headers as object)
        .map((h) => h.toLowerCase())
        .sort(),
    ).toEqual(["accept", "authorization", "content-type", "idempotency-key"]);
  });

  it("la clave por defecto es un UUID v4 generado en el navegador", async () => {
    renderPage();
    await submit("10");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0]![1].headers as Record<string, string>)["Idempotency-Key"]).toMatch(V4);
  });

  it("el projectId sale de la ruta, no de lo escrito por el usuario", async () => {
    renderPage({ projectId: OTHER_ID, keys: [KEY_1] });
    await submit("10");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0]![1].body as string).projectId).toBe(OTHER_ID);
  });
});

describe("Idempotency-Key al reintentar", () => {
  it("tras un fallo de red, reintentar el MISMO importe reutiliza la clave (no duplica la donación)", async () => {
    let calls = 0;
    postHandler = () =>
      ++calls === 1 ? Promise.reject(new TypeError("red caída")) : json(201, donation());
    renderPage({ keys: [KEY_1, KEY_2] });
    await submit("25.50");
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /Donar/ }));
    await screen.findByText(/Donación registrada/);
    const keys = posts().map(
      ([, init]) => (init.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys).toEqual([KEY_1, KEY_1]);
  });

  it("un 500 también conserva la clave", async () => {
    let calls = 0;
    postHandler = () =>
      ++calls === 1 ? json(500, envelope("INTERNAL_ERROR")) : json(201, donation());
    renderPage({ keys: [KEY_1, KEY_2] });
    await submit("25.50");
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /Donar/ }));
    await screen.findByText(/Donación registrada/);
    expect(
      posts().map(([, i]) => (i.headers as Record<string, string>)["Idempotency-Key"]),
    ).toEqual([KEY_1, KEY_1]);
  });

  it("cambiar el importe tras un fallo usa una clave NUEVA (otra carga ⇒ otra operación)", async () => {
    postHandler = () => Promise.reject(new TypeError("red caída"));
    renderPage({ keys: [KEY_1, KEY_2] });
    await submit("25.50");
    await screen.findByRole("alert");
    await submit("30");
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(
      posts().map(([, i]) => (i.headers as Record<string, string>)["Idempotency-Key"]),
    ).toEqual([KEY_1, KEY_2]);
  });

  it("tras el éxito, una nueva donación usa otra clave", async () => {
    renderPage({ keys: [KEY_1, KEY_2, KEY_3] });
    await submit("10");
    await screen.findByText(/Donación registrada/);
    await userEvent.click(screen.getByRole("button", { name: /Donar de nuevo/ }));
    await submit("10");
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(
      posts().map(([, i]) => (i.headers as Record<string, string>)["Idempotency-Key"]),
    ).toEqual([KEY_1, KEY_2]);
  });

  it("un doble clic envía una sola solicitud: el botón se deshabilita mientras se procesa", async () => {
    let release: (r: Response) => void = () => {};
    postHandler = () => new Promise<Response>((resolve) => (release = resolve));
    renderPage({ keys: [KEY_1, KEY_2] });
    const input = await amountInput();
    await userEvent.type(input, "10");
    const button = screen.getByRole("button", { name: /Donar/ });
    await userEvent.dblClick(button);
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Enviando/ })).toBeDisabled();
    release(json(201, donation()));
    await screen.findByText(/Donación registrada/);
    expect(posts()).toHaveLength(1);
  });
});

describe("doble envío simultáneo (antes de que React vuelva a renderizar)", () => {
  it("dos envíos del formulario en el mismo instante producen UNA sola solicitud", async () => {
    let release: (r: Response) => void = () => {};
    postHandler = () => new Promise<Response>((resolve) => (release = resolve));
    const { container } = renderPage({ keys: [KEY_1, KEY_2] });
    const input = await amountInput();
    await userEvent.type(input, "10");
    const form = container.querySelector("form")!;

    // Sin renderizar entre medias: el botón aún no está deshabilitado, solo el guard lo evita.
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    release(json(201, donation()));
    await screen.findByText(/Donación registrada/);
    expect(posts()).toHaveLength(1);
  });
});

describe("resultado exitoso (201)", () => {
  it("confirma la donación pendiente de simulación, sin cobro, y ofrece simular", async () => {
    renderPage({ keys: [KEY_1] });
    await submit("25.50");
    expect(await screen.findByText(/Donación registrada/)).toBeInTheDocument();
    expect(screen.getByText("S/ 25.50")).toBeInTheDocument();
    expect(screen.getByText(/Pendiente de simulación/)).toBeInTheDocument();
    expect(screen.getByText(/no se ha realizado ningún cobro/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Simular/ })).toHaveAttribute(
      "href",
      "/donations/00000000-0000-4000-8000-0000000000d1/simulate",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("muestra el importe que CONFIRMÓ el servidor, no el que tecleó el usuario", async () => {
    postHandler = () => json(201, donation({ amountCents: 1000 }));
    renderPage({ keys: [KEY_1] });
    await submit("25.50");
    expect(await screen.findByText("S/ 10.00")).toBeInTheDocument();
    expect(screen.queryByText("S/ 25.50")).not.toBeInTheDocument();
  });
});

describe("errores del servidor (mensajes seguros, sin detalles técnicos)", () => {
  const cases: [string, number, unknown, RegExp][] = [
    ["400 INVALID_AMOUNT", 400, envelope("INVALID_AMOUNT"), /importe no es válido/i],
    ["400 genérico", 400, envelope("INVALID_REQUEST"), /Revise los datos/i],
    ["401", 401, envelope("UNAUTHORIZED"), /sesión expiró/i],
    ["403", 403, envelope("FORBIDDEN"), /no tiene permiso/i],
    ["404", 404, envelope("NOT_FOUND"), /ya no existe/i],
    ["409", 409, envelope("CONFLICT"), /no está disponible para recibir donaciones/i],
    ["500", 500, envelope("INTERNAL_ERROR"), /No se pudo registrar la donación/i],
  ];

  it.each(cases)("%s", async (_label, status, payload, message) => {
    postHandler = () => json(status, payload);
    const { container } = renderPage({ keys: [KEY_1] });
    await submit("25.50");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(container.textContent).not.toMatch(
      /INVALID_|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|INTERNAL_ERROR|r-1|requestId/,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument(); // el formulario sigue disponible
  });

  it("un fallo de red muestra un mensaje genérico", async () => {
    postHandler = () => Promise.reject(new TypeError("ECONNREFUSED 10.0.0.5"));
    const { container } = renderPage({ keys: [KEY_1] });
    await submit("25.50");
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudo registrar la donación/i);
    expect(container.textContent).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  it("una respuesta 201 con forma inválida se trata como error y no se muestra", async () => {
    postHandler = () =>
      json(201, donation({ donorSub: "aaaaaaaa", status: "CONFIRMADA_SIMULADA" }));
    const { container } = renderPage({ keys: [KEY_1] });
    await submit("25.50");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Donación registrada/)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("aaaaaaaa");
  });

  it("sin sesión (sin access token) no se envía nada y se pide iniciar sesión", async () => {
    renderPage({ token: null, keys: [KEY_1] });
    await submit("25.50");
    expect(await screen.findByRole("alert")).toHaveTextContent(/sesión expiró/i);
    expect(posts()).toHaveLength(0);
  });

  it("el token de acceso no aparece nunca en el DOM", async () => {
    const { container } = renderPage({ keys: [KEY_1] });
    await submit("25.50");
    await screen.findByText(/Donación registrada/);
    expect(container.innerHTML).not.toContain(TOKEN);
  });
});

describe("proyecto no disponible", () => {
  it("un proyecto que no está en el catálogo público no ofrece el formulario", async () => {
    list = [project({ projectId: OTHER_ID })];
    renderPage();
    expect(await screen.findByText(/no está disponible/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each(["no-es-uuid", "..%2F..%2Fx", "%3Cscript%3E"])(
    "un id malformado (%s) no ofrece el formulario",
    async (id) => {
      renderPage({ projectId: id });
      expect(await screen.findByText(/no está disponible/i)).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(posts()).toHaveLength(0);
    },
  );

  it("si no se puede cargar el catálogo, avisa y permite reintentar", async () => {
    let fail = true;
    fetchMock.mockImplementation(async (url: string) =>
      url === `${BASE}/v1/projects`
        ? fail
          ? json(500, envelope("INTERNAL_ERROR"))
          : json(200, list)
        : json(404, envelope("NOT_FOUND")),
    );
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/No se pudo cargar el proyecto/i);
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await amountInput()).toBeInTheDocument();
  });

  it("el título del proyecto se muestra como texto, nunca como HTML", async () => {
    list = [project({ title: "Tom & \"Jerry\" 'x'" })];
    const { container } = renderPage();
    expect(await screen.findByText(`Tom & "Jerry" 'x'`)).toBeInTheDocument();
    expect(container.querySelector("script, img")).toBeNull();
  });
});
