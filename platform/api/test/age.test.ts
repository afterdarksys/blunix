import { armor } from "age-encryption";
import { describe, expect, it } from "vitest";
import { acceptCiphertext, UPLOAD_LIMIT } from "../src/age";
import { b64url } from "../src/crypto";
import { ageScrypt, ageX25519 } from "./helpers";

const enc = new TextEncoder();
const acceptableCiphertext = (b: Uint8Array) => acceptCiphertext(b) !== null;

function raw(n: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n))).replace(/-/g, "+").replace(/_/g, "/");
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// A hand-built header. Useful for shapes the reference encrypter will not produce.
function built(stanzas: string[], opts: { payload?: number; mac?: string } = {}): Uint8Array {
  const header = ["age-encryption.org/v1", ...stanzas, `--- ${opts.mac ?? raw(32)}`].join("\n") + "\n";
  return concat(enc.encode(header), crypto.getRandomValues(new Uint8Array(opts.payload ?? 48)));
}

const SCRYPT = () => `-> scrypt ${raw(16)} 18\n${raw(32)}`;

describe("age upload validation", () => {
  it("accepts real scrypt age, binary and armored", async () => {
    expect(acceptableCiphertext(await ageScrypt())).toBe(true);
    expect(acceptableCiphertext(await ageScrypt({ armored: true }))).toBe(true);
  });

  it("unwraps armor to the same binary file", async () => {
    const bin = await ageScrypt();
    expect(acceptCiphertext(bin)).toEqual(bin);
    expect(acceptCiphertext(enc.encode(armor.encode(bin)))).toEqual(bin);
  });

  it("accepts armor with CRLF line endings and a trailing newline", async () => {
    const text = armor.encode(await ageScrypt()).replace(/\n/g, "\r\n") + "\r\n";
    expect(acceptableCiphertext(enc.encode(text))).toBe(true);
  });

  it("accepts a well-formed hand-built scrypt header", () => {
    expect(acceptableCiphertext(built([SCRYPT()]))).toBe(true);
  });

  it("refuses an X25519 recipient file", async () => {
    expect(acceptableCiphertext(await ageX25519())).toBe(false);
    expect(acceptableCiphertext(enc.encode(armor.encode(await ageX25519())))).toBe(false);
  });

  it("refuses two stanzas, even two scrypt stanzas", () => {
    expect(acceptableCiphertext(built([SCRYPT(), SCRYPT()]))).toBe(false);
    expect(acceptableCiphertext(built([`-> X25519 ${raw(32)}\n${raw(32)}`, SCRYPT()]))).toBe(false);
  });

  it("refuses a header with no stanza", () => {
    expect(acceptableCiphertext(built([]))).toBe(false);
  });

  it("refuses plaintext, a shell script, YAML, and an empty body", () => {
    for (const s of ["hello\n", "#!/bin/sh\nrm -rf /\n", "hostname: ada-1\nnetwork: dhcp\n", ""]) {
      expect(acceptableCiphertext(enc.encode(s))).toBe(false);
    }
  });

  it("refuses the magic line alone, and a header with no payload", () => {
    expect(acceptableCiphertext(enc.encode("age-encryption.org/v1\n"))).toBe(false);
    expect(acceptableCiphertext(built([SCRYPT()], { payload: 0 }))).toBe(false);
    expect(acceptableCiphertext(built([SCRYPT()], { payload: 31 }))).toBe(false);
  });

  it("refuses malformed scrypt stanzas", () => {
    const cases = [
      `-> scrypt ${raw(15)} 18\n${raw(32)}`, // short salt
      `-> scrypt ${raw(16)} 018\n${raw(32)}`, // leading zero
      `-> scrypt ${raw(16)} 23\n${raw(32)}`, // work factor past what age accepts
      `-> scrypt ${raw(16)}\n${raw(32)}`, // missing work factor
      `-> scrypt ${raw(16)} 18 extra\n${raw(32)}`, // extra argument
      `-> scrypt ${raw(16)} 18\n${raw(31)}`, // short wrapped key
      `-> scrypt  ${raw(16)} 18\n${raw(32)}`, // empty argument
      `-> scrypt ${raw(16)}= 18\n${raw(32)}`, // padded base64
    ];
    for (const s of cases) expect(acceptableCiphertext(built([s])), s).toBe(false);
  });

  it("refuses a bad MAC line", () => {
    expect(acceptableCiphertext(built([SCRYPT()], { mac: raw(31) }))).toBe(false);
    expect(acceptableCiphertext(built([SCRYPT()], { mac: "!".repeat(43) }))).toBe(false);
  });

  it("refuses armor garbage", () => {
    const begin = "-----BEGIN AGE ENCRYPTED FILE-----";
    const end = "-----END AGE ENCRYPTED FILE-----";
    const cases = [
      `${begin}\n${end}\n`,
      `${begin}\nnot base64 at all!\n${end}\n`,
      `${begin}\n${btoa("hostname: ada-1\n")}\n${end}\n`,
      `${begin}\n${btoa("age-encryption.org/v1\n-> scrypt x 18\n")}\n`,
      `${begin}\n${btoa("x".repeat(200))}\n${end}\n`,
    ];
    for (const s of cases) expect(acceptableCiphertext(enc.encode(s))).toBe(false);
  });

  it("refuses armor with text after the end line, or wrong column width", async () => {
    const good = armor.encode(await ageScrypt());
    expect(acceptableCiphertext(enc.encode(good + "echo pwned\n"))).toBe(false);
    const lines = good.trimEnd().split("\n");
    const body = lines.slice(1, -1).join("");
    const narrow = [lines[0], ...(body.match(/.{1,60}/g) ?? []), lines[lines.length - 1]].join("\n") + "\n";
    expect(acceptableCiphertext(enc.encode(narrow))).toBe(false);
  });

  it("refuses an armored X25519 file whose armor is otherwise perfect", async () => {
    expect(acceptableCiphertext(enc.encode(armor.encode(await ageX25519())))).toBe(false);
  });

  it("refuses anything over 256 KiB", async () => {
    const big = new Uint8Array(UPLOAD_LIMIT + 1);
    big.set(await ageScrypt());
    expect(acceptableCiphertext(big)).toBe(false);
  });
});
