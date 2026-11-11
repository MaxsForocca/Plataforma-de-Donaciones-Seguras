import { afterEach, describe, expect, it, vi } from "vitest";
import { generateUuid } from "../src/services/uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("generateUuid", () => {
  it("genera UUID v4 en minúsculas", () => {
    for (let i = 0; i < 50; i += 1) expect(generateUuid()).toMatch(V4);
  });

  it("no repite valores", () => {
    expect(new Set(Array.from({ length: 500 }, generateUuid)).size).toBe(500);
  });

  it("sin crypto.randomUUID usa crypto.getRandomValues y sigue siendo v4", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, i) => (bytes[i] = (i * 37 + 11) % 256));
        return bytes;
      },
    });
    expect(generateUuid()).toMatch(V4);
  });

  it("sin ninguna fuente criptográfica falla en voz alta (no cae a Math.random)", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => generateUuid()).toThrow();
  });
});
