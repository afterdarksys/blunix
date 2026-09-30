import { describe, expect, it } from "vitest";
import { labelReserved, labelShape, parseVersion } from "../src/labels";

describe("labels", () => {
  it("accepts ordinary labels at both length limits", () => {
    for (const s of ["ada", "ab", "a1", "lab-3", "a".repeat(32), "x9-y"]) expect(labelShape(s), s).toBe(true);
  });

  it("refuses bad shapes", () => {
    const bad = [
      "a", // one character
      "a".repeat(33),
      "1ada", // leading digit
      "-ada",
      "ada-", // trailing hyphen
      "a--b", // double hyphen
      "xn--80ak6aa92e", // punycode
      "Ada", // upper case
      "ada.b",
      "ada_b",
      "",
      " ada",
      "адa",
    ];
    for (const s of bad) expect(labelShape(s), s).toBe(false);
    expect(labelShape(42)).toBe(false);
    expect(labelShape(null)).toBe(false);
  });

  it("reserves service names and every v{n}", () => {
    for (const s of ["www", "api", "updates", "log", "mail", "build", "portal", "admin", "root", "blunix", "proxy", "status"]) {
      expect(labelReserved(s), s).toBe(true);
    }
    for (const s of ["v1", "v0", "v01", "v999999", "v1234567"]) expect(labelReserved(s), s).toBe(true);
    for (const s of ["ada", "va", "v1a", "vv1"]) expect(labelReserved(s), s).toBe(false);
  });

  it("parses versions 1 to 999999 with no leading zero", () => {
    expect(parseVersion("1")).toBe(1);
    expect(parseVersion("999999")).toBe(999999);
    for (const s of ["0", "01", "1000000", "-1", "1.0", "", "one"]) expect(parseVersion(s), s).toBeNull();
  });
});
