import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../src/auth/AuthProvider";
import { LoginCallbackPage } from "../src/pages/LoginCallbackPage";
import { fakeAuth } from "./helpers";

function renderCallback(
  auth: AuthContextValue,
  url = "/callback?code=abc&state=xyz",
  strict = false,
) {
  const tree = (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/callback" element={<LoginCallbackPage />} />
          <Route path="/" element={<p>CATALOGO</p>} />
          <Route path="/me/donations" element={<p>MIS DONACIONES</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe("LoginCallbackPage", () => {
  it("muestra un estado accesible mientras completa el inicio de sesión", () => {
    renderCallback(fakeAuth({ completeLogin: vi.fn(() => new Promise<string | null>(() => {})) }));
    expect(screen.getByRole("status")).toHaveTextContent("Procesando inicio de sesión");
  });

  it("al completar el login navega a la ruta de retorno (reemplazando el historial)", async () => {
    renderCallback(fakeAuth({ completeLogin: vi.fn(async () => "/me/donations") }));
    expect(await screen.findByText("MIS DONACIONES")).toBeInTheDocument();
  });

  it("completa el login una sola vez aunque React ejecute el efecto dos veces (StrictMode)", async () => {
    const completeLogin = vi.fn(async () => "/");
    renderCallback(fakeAuth({ completeLogin }), "/callback?code=abc&state=xyz", true);
    await screen.findByText("CATALOGO");
    expect(completeLogin).toHaveBeenCalledTimes(1);
  });

  describe("si el inicio de sesión falla", () => {
    const failing = (extra: Partial<AuthContextValue> = {}) =>
      fakeAuth({
        completeLogin: vi.fn(async () => null),
        error: "No se pudo completar el inicio de sesión. Inténtelo nuevamente.",
        ...extra,
      });

    it("permanece en la página y explica el problema (no redirige en silencio)", async () => {
      renderCallback(failing());
      expect(
        await screen.findByRole("heading", { name: "No se pudo iniciar sesión" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/No se pudo completar el inicio de sesión/)).toBeInTheDocument();
      expect(screen.queryByText("CATALOGO")).not.toBeInTheDocument();
    });

    it("ofrece reintentar y volver al catálogo", async () => {
      const login = vi.fn(async () => undefined);
      renderCallback(failing({ login }));
      await userEvent.click(await screen.findByRole("button", { name: "Intentar de nuevo" }));
      expect(login).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("link", { name: "Volver al catálogo" })).toHaveAttribute("href", "/");
    });

    it("el mensaje de un login sin segundo factor se muestra tal cual lo entrega el proveedor de sesión", async () => {
      renderCallback(
        failing({
          error:
            "No se completó la verificación de identidad (segundo factor). Inicie sesión nuevamente.",
        }),
      );
      expect(await screen.findByText(/segundo factor/)).toBeInTheDocument();
    });

    it("jamás muestra los parámetros de la URL (error_description puede traer texto del atacante)", async () => {
      const { container } = renderCallback(
        failing(),
        `/callback?error=access_denied&error_description=${encodeURIComponent("<script>alert(1)</script> hola")}`,
      );
      await screen.findByRole("heading", { name: "No se pudo iniciar sesión" });
      expect(container.textContent).not.toMatch(/script|alert\(1\)|hola|access_denied/);
      expect(container.querySelector("script")).toBeNull();
    });

    it("no muestra ningún token ni código de autorización", async () => {
      const { container } = renderCallback(
        failing(),
        "/callback?code=CODIGO-SECRETO&state=STATE-SECRETO",
      );
      await screen.findByRole("heading", { name: "No se pudo iniciar sesión" });
      expect(container.textContent).not.toMatch(/SECRETO/);
    });

    it("sin mensaje del proveedor usa un texto genérico", async () => {
      renderCallback(failing({ error: null }));
      expect(await screen.findByText(/Inténtelo nuevamente/)).toBeInTheDocument();
    });
  });

  it("un retorno sin parámetros (se abrió /callback a mano) termina en el estado de fallo, no en un bucle", async () => {
    const completeLogin = vi.fn(async () => null);
    renderCallback(fakeAuth({ completeLogin }), "/callback");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "No se pudo iniciar sesión" }),
      ).toBeInTheDocument(),
    );
    expect(completeLogin).toHaveBeenCalledTimes(1);
  });
});
