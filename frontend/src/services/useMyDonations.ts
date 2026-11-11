/**
 * Hook para consultar el historial propio de donaciones (T101; CA-07.1).
 * Ruta protegida: exige y envía el access token (`auth: true`).
 * Valida la respuesta con un array de `donationSchema`.
 */
import { donationSchema, type Donation } from "@donaciones/shared";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError } from "./apiClient";
import { useApiClient } from "./useApiClient";

const donationListSchema = z.array(donationSchema);

export function useMyDonations() {
  const api = useApiClient();
  return useQuery<Donation[], Error>({
    queryKey: ["my-donations"],
    queryFn: async ({ signal }) => {
      const payload = await api.get<unknown>("/v1/donations/me", { auth: true, signal });
      const parsed = donationListSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(502, "INVALID_RESPONSE", "La respuesta del servidor no es válida.");
      }
      return parsed.data;
    },
  });
}
