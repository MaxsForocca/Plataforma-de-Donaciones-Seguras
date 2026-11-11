import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../src/App";
import { AuthContext, type AuthContextValue } from "../src/auth/AuthProvider";
import { fakeAuth } from "./helpers";

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/academic");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function renderApp(path: string, auth: AuthContextValue = fakeAuth(), strict = false) {
  const tree = (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const protectedPaths = [
  ["/me/donations", "Mis donaciones"],
  ["/donate/abc", "Donar"],
  ["/donations/abc/simulate", "Simulación de donación"],
] as const;

describe("rutas públicas", () => {
  it("el catálogo es accesible sin sesión", () => {
    renderApp("/");
    expect(
      screen.getByRole("heading", { level: 1, name: "Catálogo de proyectos" }),
    ).toBeInTheDocument();
  });

  it("el detalle de un proyecto es accesible sin sesión", () => {
    renderApp("/projects/00000000-0000-4000-8000-000000000001");
    expect(
      screen.getByRole("heading", { level: 1, name: "Detalle del proyecto" }),
    ).toBeInTheDocument();
  });

  it("una ruta desconocida muestra la página 404 con un enlace al catálogo", () => {
    renderApp("/no-existe");
    expect(screen.getByRole("heading", { name: "Página no encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al catálogo" })).toHaveAttribute("href", "/");
  });
});

describe("guard de rutas protegidas (solo UX)", () => {
  it.each(protectedPaths)("%s no muestra su contenido sin sesión", (path, title) => {
    renderApp(path);
    expect(
      screen.getByRole("heading", { name: "Inicia sesión para continuar" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: title })).not.toBeInTheDocument();
  });

  it("el botón del guard inicia sesión y recuerda la ruta solicitada", async () => {
    const login = vi.fn(async () => undefined);
    renderApp("/me/donations", fakeAuth({ login }));
    await userEvent.click(
      within(screen.getByRole("main")).getByRole("button", { name: "Iniciar sesión" }),
    );
    expect(login).toHaveBeenCalledWith("/me/donations");
  });

  it.each(protectedPaths)("%s muestra su contenido con sesión", (path, title) => {
    renderApp(path, fakeAuth({ status: "authenticated", getAccessToken: () => "t" }));
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.queryByText("Inicia sesión para continuar")).not.toBeInTheDocument();
  });

  it("mientras se verifica la sesión no muestra el contenido ni pide iniciar sesión", () => {
    renderApp("/me/donations", fakeAuth({ status: "loading" }));
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent(
      "Verificando sesión",
    );
    expect(
      screen.queryByRole("heading", { name: "Inicia sesión para continuar" }),
    ).not.toBeInTheDocument();
  });

  it("el guard no confía en grupos del cliente: solo la sesión decide la UX", () => {
    renderApp("/me/donations", fakeAuth({ status: "unauthenticated", groups: ["GESTOR"] }));
    expect(
      screen.getByRole("heading", { name: "Inicia sesión para continuar" }),
    ).toBeInTheDocument();
  });
});

describe("Layout", () => {
  it("tiene enlace de salto, landmarks y el aviso académico", () => {
    renderApp("/");
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveAttribute(
      "href",
      "#contenido",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "contenido");
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      "las donaciones son simuladas y no se realiza ningún cobro",
    );
  });

  it("sin sesión ofrece iniciar sesión y oculta «Mis donaciones»", async () => {
    const login = vi.fn(async () => undefined);
    renderApp("/", fakeAuth({ login }));
    expect(screen.queryByRole("link", { name: "Mis donaciones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("con sesión muestra «Mis donaciones» y permite cerrar sesión", async () => {
    const logout = vi.fn(async () => undefined);
    renderApp("/", fakeAuth({ status: "authenticated", logout }));
    expect(screen.getByRole("link", { name: "Mis donaciones" })).toHaveAttribute(
      "href",
      "/me/donations",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("mientras carga la sesión el botón de inicio está deshabilitado", () => {
    renderApp("/", fakeAuth({ status: "loading" }));
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeDisabled();
  });

  it("muestra los errores de autenticación como alerta accesible", () => {
    renderApp("/", fakeAuth({ error: "No se pudo completar el inicio de sesión." }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo completar el inicio de sesión.",
    );
  });

  it("sin error no hay alerta", () => {
    renderApp("/");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("callback de inicio de sesión", () => {
  it("completa el login una sola vez (incluso bajo StrictMode) y navega a la ruta de retorno", async () => {
    const completeLogin = vi.fn(async () => "/me/donations");
    renderApp(
      "/callback?code=abc&state=xyz",
      fakeAuth({ status: "authenticated", completeLogin }),
      true,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Mis donaciones" })).toBeInTheDocument(),
    );
    expect(completeLogin).toHaveBeenCalledTimes(1);
  });

  it("si el login falla vuelve al catálogo", async () => {
    const completeLogin = vi.fn(async () => null);
    renderApp("/callback?code=abc", fakeAuth({ completeLogin }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Catálogo de proyectos" }),
      ).toBeInTheDocument(),
    );
    expect(completeLogin).toHaveBeenCalledTimes(1);
  });

  it("muestra un estado accesible mientras procesa", () => {
    const completeLogin = vi.fn(() => new Promise<string | null>(() => {}));
    renderApp("/callback", fakeAuth({ completeLogin }));
    expect(screen.getByRole("status")).toHaveTextContent("Procesando inicio de sesión");
  });
});
