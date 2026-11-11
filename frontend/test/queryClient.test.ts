import { describe, expect, it } from "vitest";
import { ApiError } from "../src/services/apiClient";
import { createQueryClient, shouldRetry } from "../src/services/queryClient";

describe("shouldRetry", () => {
  it.each([400, 401, 403, 404, 409, 422, 499])(
    "no reintenta el error determinista HTTP %i",
    (status) => {
      expect(shouldRetry(0, new ApiError(status, "X", "m"))).toBe(false);
    },
  );

  it.each([500, 502, 503])("reintenta HTTP %i hasta 2 veces", (status) => {
    const error = new ApiError(status, "X", "m");
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
  });

  it("reintenta fallos de red (estado 0) y errores desconocidos hasta 2 veces", () => {
    expect(shouldRetry(0, new ApiError(0, "NETWORK_ERROR", "m"))).toBe(true);
    expect(shouldRetry(1, new Error("x"))).toBe(true);
    expect(shouldRetry(2, new Error("x"))).toBe(false);
    expect(shouldRetry(0, undefined)).toBe(true);
  });
});

describe("createQueryClient", () => {
  it("usa valores por defecto seguros", () => {
    const options = createQueryClient().getDefaultOptions();
    expect(options.queries?.staleTime).toBe(30_000);
    expect(options.queries?.refetchOnWindowFocus).toBe(false);
    expect(options.queries?.retry).toBe(shouldRetry);
  });

  it("no reintenta mutaciones (donar/simular) automáticamente", () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("cada llamada crea un cliente independiente", () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
