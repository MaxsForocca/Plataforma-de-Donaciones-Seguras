import { describe, expect, it } from "vitest";
import { createLogger, type LogEntry, type LogFields } from "../../../src/shared/logger";

const FIXED = new Date("2026-11-11T12:00:00.000Z");

function setup(requestId = "req-1") {
  const lines: string[] = [];
  const logger = createLogger(requestId, { sink: (line) => lines.push(line), now: () => FIXED });
  return { lines, logger };
}

describe("createLogger", () => {
  it("emite una línea JSON con nivel, hora, requestId y los campos permitidos", () => {
    const { lines, logger } = setup();
    logger.info({ action: "listProjects", result: "success", statusCode: 200, durationMs: 12 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      level: "info",
      timestamp: "2026-11-11T12:00:00.000Z",
      requestId: "req-1",
      action: "listProjects",
      result: "success",
      statusCode: 200,
      durationMs: 12,
    });
  });

  it.each(["info", "warn", "error"] as const)("el nivel %s se refleja en la entrada", (level) => {
    const { lines, logger } = setup();
    logger[level]({ action: "x", result: "error" });
    expect(JSON.parse(lines[0] as string).level).toBe(level);
  });

  it("devuelve la entrada escrita", () => {
    const { logger } = setup();
    const entry: LogEntry = logger.warn({
      action: "createDonation",
      result: "denied",
      errorCode: "FORBIDDEN",
    });
    expect(entry).toMatchObject({ level: "warn", errorCode: "FORBIDDEN", requestId: "req-1" });
  });

  describe("no registra secretos ni datos personales (lista blanca)", () => {
    const toxic = {
      action: "createDonation",
      result: "success",
      statusCode: 201,
      donorSub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sub: "aaaaaaaa",
      token: "eyJhbGciOi.secreto",
      accessToken: "eyJ.secreto",
      authorization: "Bearer eyJ.secreto",
      headers: { authorization: "Bearer x" },
      body: { amountCents: 500, cardNumber: "4111111111111111" },
      idempotencyKey: "3b241101-e2bb-4255-8caf-4136c566a962",
      email: "persona@example.com",
      cvv: "123",
      dni: "12345678",
    } as unknown as LogFields;

    it("descarta cualquier campo fuera de la lista blanca", () => {
      const { lines, logger } = setup();
      logger.info(toxic);
      const entry = JSON.parse(lines[0] as string);
      expect(Object.keys(entry).sort()).toEqual(
        ["action", "level", "requestId", "result", "statusCode", "timestamp"].sort(),
      );
    });

    it("el texto de la línea no contiene ninguno de los valores sensibles", () => {
      const { lines, logger } = setup();
      logger.error(toxic);
      for (const secret of [
        "secreto",
        "4111111111111111",
        "persona@example.com",
        "12345678",
        "3b241101",
        "aaaaaaaa",
      ]) {
        expect(lines[0]).not.toContain(secret);
      }
    });

    it("no emite claves con valor undefined", () => {
      const { lines, logger } = setup();
      logger.info({ action: "a", result: "success", statusCode: undefined });
      expect(lines[0]).not.toContain("statusCode");
    });
  });

  describe("cronómetro", () => {
    it("mide la duración en milisegundos enteros", () => {
      let now = 1_000;
      const logger = createLogger("r", { sink: () => {}, clock: () => now });
      const elapsed = logger.startTimer();
      now = 1_042.6;
      expect(elapsed()).toBe(43);
    });

    it("cada cronómetro es independiente", () => {
      let now = 0;
      const logger = createLogger("r", { sink: () => {}, clock: () => now });
      const first = logger.startTimer();
      now = 10;
      const second = logger.startTimer();
      now = 25;
      expect(first()).toBe(25);
      expect(second()).toBe(15);
    });
  });

  it("usa console.log por defecto sin lanzar errores", () => {
    const logger = createLogger("r");
    expect(() => logger.info({ action: "noop", result: "success" })).not.toThrow();
  });
});
