import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // La raíz es scripts/ aunque vitest se invoque desde la raíz del repositorio.
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: { environment: "node", include: ["*.test.ts"] },
});
