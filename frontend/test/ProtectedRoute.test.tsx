import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../src/auth/AuthProvider";
import { ProtectedRoute } from "../src/auth/ProtectedRoute";
import { fakeAuth } from "./helpers";

function renderAt(path: string, auth: AuthContextValue) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/secreto" element={<p>CONTENIDO PROTEGIDO</p>} />
          </Route>
          <Route path="/publico" element={<p>PÚBLICO</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("ProtectedRoute (solo UX: la autorización real es del backend)", () => {
  it("sin sesión oculta el contenido y ofrece iniciar sesión", () => {
    renderAt("/secreto", fakeAuth());
    expect(screen.queryByText("CONTENIDO PROTEGIDO")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Inicia sesión para continuar" }),
    ).toBeInTheDocument();
  });

  it("el botón inicia sesión y recuerda la ruta completa, con su query", async () => {
    const login = vi.fn(async () => undefined);
    renderAt("/secreto?tab=2", fakeAuth({ login }));
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(login).toHaveBeenCalledWith("/secreto?tab=2");
  });

  it("con sesión muestra el contenido", () => {
    renderAt("/secreto", fakeAuth({ status: "authenticated", getAccessToken: () => "t" }));
    expect(screen.getByText("CONTENIDO PROTEGIDO")).toBeInTheDocument();
  });

  it("mientras se verifica la sesión no muestra el contenido ni el botón de inicio", () => {
    renderAt("/secreto", fakeAuth({ status: "loading" }));
    expect(screen.getByRole("status")).toHaveTextContent("Verificando sesión");
    expect(screen.queryByText("CONTENIDO PROTEGIDO")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).not.toBeInTheDocument();
  });

  it.each([["GESTOR"], ["AUDITOR"], ["DONANTE"], ["ADMIN"]])(
    "los grupos (%s) no sustituyen a la sesión: sin sesión sigue oculto",
    (group) => {
      renderAt("/secreto", fakeAuth({ status: "unauthenticated", groups: [group] }));
      expect(screen.queryByText("CONTENIDO PROTEGIDO")).not.toBeInTheDocument();
    },
  );

  it("una sesión sin token utilizable no muestra contenido si el estado no es autenticado", () => {
    renderAt("/secreto", fakeAuth({ status: "unauthenticated", getAccessToken: () => "token" }));
    expect(screen.queryByText("CONTENIDO PROTEGIDO")).not.toBeInTheDocument();
  });

  it("no protege las rutas públicas", () => {
    renderAt("/publico", fakeAuth());
    expect(screen.getByText("PÚBLICO")).toBeInTheDocument();
  });
});
