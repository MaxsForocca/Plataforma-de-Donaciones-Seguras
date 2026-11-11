import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { createUserManager, readOidcConfig, type OidcEnv } from "./auth/oidcConfig";
import "./index.css";
import { createQueryClient } from "./services/queryClient";

const container = document.getElementById("root");
if (!container) throw new Error("No se encontró el elemento #root");
const root = createRoot(container);

const oidc = readOidcConfig(import.meta.env as OidcEnv);
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const apiBaseUrlValid = (() => {
  try {
    return !!apiBaseUrl && ["http:", "https:"].includes(new URL(apiBaseUrl).protocol);
  } catch {
    return false;
  }
})();

if (!oidc.ok || !apiBaseUrlValid) {
  const invalid = [
    ...(oidc.ok ? [] : oidc.invalid),
    ...(apiBaseUrlValid ? [] : ["VITE_API_BASE_URL"]),
  ];
  // Falta configuración (ver .env.example): se informa sin mostrar valores.
  root.render(
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Configuración incompleta</h1>
      <p className="mt-2">
        Faltan o son inválidas estas variables de entorno: {invalid.join(", ")}.
      </p>
    </main>,
  );
} else {
  const manager = createUserManager(oidc.config);
  const queryClient = createQueryClient();
  const logout = { clientId: oidc.config.clientId, logoutUri: oidc.config.logoutUri };
  const identity = { clientId: oidc.config.clientId, issuer: oidc.config.authority };

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider manager={manager} logout={logout} identity={identity}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
