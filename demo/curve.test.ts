import { describe, expect, it } from "vitest";
import { isDirty } from "./measure.js";

describe("isDirty with the ignored path (#50, D5)", () => {
  it("ignores the path it is given (I1)", () => {
    expect(isDirty(["docs/curva.md"], "docs/curva.md")).toBe(false);
  });

  it("replaces the default path instead of adding to it (I2)", () => {
    expect(
      isDirty(["docs/curva.md", "docs/resultados.md"], "docs/curva.md"),
    ).toBe(true);
  });
});
