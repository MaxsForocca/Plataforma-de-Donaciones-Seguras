import { describe, expect, it } from "vitest";
import {
  cancellationCodes,
  createDocumentClient,
  failedConditionAt,
  resolveTableNames,
} from "../../../src/shared/dynamodb";
import { testConfig } from "../../helpers/setup";

const canceled = (codes: (string | undefined)[]) => ({
  name: "TransactionCanceledException",
  CancellationReasons: codes.map((Code) => (Code === undefined ? {} : { Code })),
});

describe("cancellationCodes / failedConditionAt", () => {
  it("devuelve los códigos en el orden de los items de la transacción", () => {
    expect(cancellationCodes(canceled(["None", "ConditionalCheckFailed", "None"]))).toEqual([
      "None",
      "ConditionalCheckFailed",
      "None",
    ]);
  });

  it("una razón sin Code se trata como None", () => {
    expect(cancellationCodes(canceled([undefined, "ConditionalCheckFailed"]))).toEqual([
      "None",
      "ConditionalCheckFailed",
    ]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["texto", "TransactionCanceledException"],
    ["número", 7],
    ["otro error", new Error("x")],
    ["nombre correcto sin razones", { name: "TransactionCanceledException" }],
    [
      "razones que no son arreglo",
      { name: "TransactionCanceledException", CancellationReasons: {} },
    ],
    [
      "otro nombre",
      { name: "ConditionalCheckFailedException", CancellationReasons: [{ Code: "X" }] },
    ],
  ])("no es una cancelación de transacción: %s → []", (_label, error) => {
    expect(cancellationCodes(error)).toEqual([]);
  });

  it("razones nulas dentro del arreglo no rompen el análisis", () => {
    expect(
      cancellationCodes({
        name: "TransactionCanceledException",
        CancellationReasons: [null, { Code: 5 }],
      }),
    ).toEqual(["None", "None"]);
  });

  it("failedConditionAt identifica qué item falló su condición", () => {
    const error = canceled(["ConditionalCheckFailed", "None", "None"]);
    expect(failedConditionAt(error, 0)).toBe(true);
    expect(failedConditionAt(error, 1)).toBe(false);
    expect(failedConditionAt(error, 99)).toBe(false);
  });

  it("distingue ConditionalCheckFailed de otras causas (p. ej. conflicto de transacción)", () => {
    const error = canceled(["TransactionConflict", "None"]);
    expect(failedConditionAt(error, 0)).toBe(false);
  });
});

describe("createDocumentClient y resolveTableNames", () => {
  it("crea un cliente sin red ni credenciales explícitas", () => {
    const client = createDocumentClient(testConfig());
    expect(typeof client.send).toBe("function");
  });

  it("acepta un endpoint local configurado", () => {
    const client = createDocumentClient(testConfig({ DYNAMODB_ENDPOINT: "http://localhost:8000" }));
    expect(typeof client.send).toBe("function");
  });

  it("resuelve los nombres de tabla desde la configuración", () => {
    expect(resolveTableNames(testConfig())).toEqual({
      projects: "testProjects",
      donations: "testDonations",
      idempotency: "testIdempotency",
      audit: "testAuditEvents",
    });
  });
});
