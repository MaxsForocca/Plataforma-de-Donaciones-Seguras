/**
 * T068 — El importe (`amountCents`) de una donación: entero entre 100 y 100000; se rechazan 0, 99,
 * 100001, negativos, decimales, strings numéricos y notación científica en string, siempre con 400
 * INVALID_AMOUNT, sin consultar la base de datos y sin tocar el acumulado (CA-05.1, CA-05.2).
 *
 * Los esquemas Zod ya se prueban a fondo en packages/shared/test/schemas.test.ts; aquí se comprueba
 * el comportamiento del HANDLER real ante cuerpos JSON crudos (incluida la limitación documentada de
 * que un literal numérico `1e2` equivale a 100 tras `JSON.parse`).
 */
import { AMOUNT_MAX_CENTS, AMOUNT_MIN_CENTS } from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { PUBLISHED_PROJECT, PUBLISHED_PROJECT_ID } from "../../helpers/fixtures";
import { donationEvent, makeMemoryWorld } from "../../helpers/world";

const pid = PUBLISHED_PROJECT_ID;
const raw = (amount: string) => `{"projectId":"${pid}","amountCents":${amount}}`;
const world = () => makeMemoryWorld({ projects: [{ ...PUBLISHED_PROJECT }] });
const parsed = (r: { body?: string }) => JSON.parse(r.body as string);

describe("importes rechazados → 400 INVALID_AMOUNT, sin consultar la base de datos", () => {
  const rejected: [string, string][] = [
    ["cero", raw("0")],
    ["un céntimo", raw("1")],
    ["99 (uno por debajo del mínimo)", raw("99")],
    ["100001 (uno por encima del máximo)", raw("100001")],
    ["un millón", raw("1000000")],
    ["negativo", raw("-100")],
    ["menos cero", raw("-0")],
    ["decimal", raw("100.5")],
    ["decimal sobre el máximo", raw("100000.01")],
    ["decimal bajo el mínimo", raw("99.99")],
    ["notación científica decimal (1.005e2 = 100.5)", raw("1.005e2")],
    ["exponente enorme (1e21)", raw("1e21")],
    ["infinito (1e309)", raw("1e309")],
    ["entero no seguro (2^53)", raw("9007199254740993")],
    ["string numérico", raw('"500"')],
    ["string con decimales", raw('"100.00"')],
    ["string en notación científica", raw('"1e2"')],
    ["string vacío", raw('""')],
    ["string con espacios", raw('" 500 "')],
    ["null", raw("null")],
    ["verdadero", raw("true")],
    ["arreglo", raw("[500]")],
    ["objeto", raw('{"cents":500}')],
  ];

  it.each(rejected)("%s", async (_label, body) => {
    const w = world();
    const before = await w.dump("projects");
    const response = await w.createDonation(donationEvent(body));
    expect(response.statusCode).toBe(400);
    expect(parsed(response)).toMatchObject({ code: "INVALID_AMOUNT", requestId: "req-d" });
    expect(w.calls()).toHaveLength(0);
    expect(await w.dump("projects")).toEqual(before);
    expect(await w.dump("donations")).toHaveLength(0);
  });

  it("falta amountCents", async () => {
    const response = await world().createDonation(donationEvent(`{"projectId":"${pid}"}`));
    expect(response.statusCode).toBe(400);
    expect(parsed(response).code).toBe("INVALID_AMOUNT");
  });

  it("el mensaje no revela el valor rechazado ni el nombre interno de la validación", async () => {
    const response = await world().createDonation(donationEvent(raw("-777")));
    expect(response.body).not.toMatch(/-777|too_small|invalid_type|int/);
  });
});

describe("importes aceptados → 201", () => {
  const accepted: [string, string, number][] = [
    ["el mínimo (100)", raw("100"), 100],
    ["el máximo (100000)", raw("100000"), 100_000],
    ["un importe intermedio", raw("2550"), 2550],
    ["99999", raw("99999"), 99_999],
    ["101", raw("101"), 101],
    // Limitación documentada: tras JSON.parse estos literales son el entero 100 / 150, no un string.
    ["literal 1e2 (= 100 tras JSON.parse)", raw("1e2"), 100],
    ["literal 100.0 (= 100 tras JSON.parse)", raw("100.0"), 100],
    ["literal 1.5e2 (= 150 tras JSON.parse)", raw("1.5e2"), 150],
  ];

  it.each(accepted)("%s", async (_label, body, cents) => {
    const w = world();
    const response = await w.createDonation(donationEvent(body));
    expect(response.statusCode).toBe(201);
    expect(parsed(response).amountCents).toBe(cents);
    expect(Number.isInteger(parsed(response).amountCents)).toBe(true);
  });

  it("las constantes de límites son S/ 1.00 y S/ 1,000.00 en céntimos", () => {
    expect(AMOUNT_MIN_CENTS).toBe(100);
    expect(AMOUNT_MAX_CENTS).toBe(100_000);
  });

  it("claves duplicadas en el JSON: gana la última (JSON.parse) y se valida ese valor", async () => {
    const w = world();
    const bad = await w.createDonation(
      donationEvent(`{"projectId":"${pid}","amountCents":500,"amountCents":99}`),
    );
    expect(bad.statusCode).toBe(400);
    const good = await world().createDonation(
      donationEvent(`{"projectId":"${pid}","amountCents":99,"amountCents":500}`, {
        key: "9b2f6c1e-5d0a-4c58-9d3e-0f1d2c3b4a59",
      }),
    );
    expect(good.statusCode).toBe(201);
    expect(parsed(good).amountCents).toBe(500);
  });
});

describe("el importe que manda el navegador no es la verdad financiera", () => {
  it("lo almacenado es exactamente el importe validado, en céntimos enteros", async () => {
    const w = world();
    await w.createDonation(donationEvent(raw("2550")));
    const [stored] = await w.dump("donations");
    expect(stored!.amountCents).toBe(2550);
    expect(stored!.currency).toBe("PEN");
  });

  it("campos de importe adicionales (amount, total, confirmedAmountCents) no sustituyen a amountCents", async () => {
    const w = world();
    const response = await w.createDonation(
      donationEvent({
        projectId: pid,
        amountCents: 500,
        amount: 99_999,
        total: 1,
        confirmedAmountCents: 1_000_000,
        currency: "USD",
      }),
    );
    expect(response.statusCode).toBe(201);
    const [stored] = await w.dump("donations");
    expect(stored).toMatchObject({ amountCents: 500, currency: "PEN" });
    expect(stored).not.toHaveProperty("amount");
    expect(stored).not.toHaveProperty("total");
    // el acumulado del proyecto no cambia al registrar una intención (solo la confirmación lo incrementa)
    expect((await w.dump("projects"))[0]!.confirmedAmountCents).toBe(
      PUBLISHED_PROJECT.confirmedAmountCents,
    );
  });
});
