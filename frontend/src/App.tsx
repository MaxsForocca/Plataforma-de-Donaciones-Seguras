/**
 * Shell de la aplicación (T032): rutas públicas y protegidas. El guard `ProtectedRoute` es solo UX
 * (oculta pantallas a quien no inició sesión); la autorización la decide siempre el backend.
 * Las páginas reales se incorporan en las fases de cada historia de usuario.
 */
import { Link, Route, Routes } from "react-router";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { CatalogPage } from "./pages/CatalogPage";
import { DonationPage } from "./pages/DonationPage";
import { LoginCallbackPage } from "./pages/LoginCallbackPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { SimulationPage } from "./pages/SimulationPage";

function PagePlaceholder({ title }: { title: string }) {
  return (
    <section aria-labelledby="titulo-pagina">
      <h1 id="titulo-pagina" className="text-2xl font-semibold">
        {title}
      </h1>
      <p className="mt-2 text-slate-700">Esta sección se habilitará en una fase posterior.</p>
    </section>
  );
}

function NotFoundPage() {
  return (
    <section aria-labelledby="titulo-404">
      <h1 id="titulo-404" className="text-2xl font-semibold">
        Página no encontrada
      </h1>
      <p className="mt-2">
        <Link to="/" className="text-blue-800 underline">
          Volver al catálogo
        </Link>
      </p>
    </section>
  );
}

/** Rutas de la aplicación; el enrutador (BrowserRouter) lo provee `main.tsx`. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CatalogPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="callback" element={<LoginCallbackPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="donate/:projectId" element={<DonationPage />} />
          <Route path="donations/:donationId/simulate" element={<SimulationPage />} />
          <Route path="me/donations" element={<PagePlaceholder title="Mis donaciones" />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
