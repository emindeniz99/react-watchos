import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateSigningKey,
  MAX_SEQUENCE,
  signManifest,
  writeOTAManifest,
} from "../esbuild/manifest.mts";

// Wrap a raw 32-byte Ed25519 public key in its X.509 SPKI prefix so node:crypto
// can verify with it — the mirror of how Swift's OTAConfig stores the trusted
// key and CryptoKit verifies on the watch.
function publicKeyFromRaw(base64: string) {
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(base64, "base64"),
  ]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

describe("OTA signing (consumer-facing API)", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("generateSigningKey returns a 32-byte seed and a usable keypair", () => {
    const key = generateSigningKey();
    expect(Buffer.from(key.privateKeySeedBase64, "base64")).toHaveLength(32);
    expect(Buffer.from(key.publicKeyBase64, "base64")).toHaveLength(32);
    expect(key.keyId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("signs v3:<kid>:<version>:<sequence>:<expiresAt>:<bundle> and verifies with the public key", () => {
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "globalThis.__x=42;");
    writeOTAManifest({ distDir: dir, version: 7 });
    const { keyId, publicKeyBase64, privateKeySeedBase64 } =
      generateSigningKey();

    const result = signManifest({
      distDir: dir,
      keyId,
      privateKeySeedBase64,
      sequence: 1_700_000_000,
    });
    expect(result.version).toBe(7); // taken from the manifest, not a separate arg

    const manifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    );
    expect(manifest.keyId).toBe(keyId);
    expect(manifest.signature).toBe(result.signature);

    // The interop contract: the signature must verify over the EXACT bytes the
    // watch rebuilds in UpdatePlan.signedMessage (pinned by Swift's
    // OTASigningInteropTests). If this format drifts, OTA breaks silently.
    const message = Buffer.from(
      `v3:${keyId}:7:1700000000:0:globalThis.__x=42;`,
      "utf8",
    );
    expect(
      verify(
        null,
        message,
        publicKeyFromRaw(publicKeyBase64),
        Buffer.from(result.signature, "base64"),
      ),
    ).toBe(true);
  });

  it("binds the sequence — a re-sequenced message does not verify", () => {
    // The same-version replay bound: the watch compares the SIGNED sequence
    // to its mark, so an attacker re-serving an old build can't relabel it
    // with a higher one, and a lower one is refused at save.
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "x");
    writeOTAManifest({ distDir: dir, version: 3 });
    const { keyId, publicKeyBase64, privateKeySeedBase64 } =
      generateSigningKey();
    const { signature } = signManifest({
      distDir: dir,
      keyId,
      privateKeySeedBase64,
      sequence: 50,
    });
    const key = publicKeyFromRaw(publicKeyBase64);
    const sig = Buffer.from(signature, "base64");
    expect(verify(null, Buffer.from(`v3:${keyId}:3:50:0:x`), key, sig)).toBe(
      true,
    );
    expect(verify(null, Buffer.from(`v3:${keyId}:3:49:0:x`), key, sig)).toBe(
      false,
    );
    expect(verify(null, Buffer.from(`v3:${keyId}:3:51:0:x`), key, sig)).toBe(
      false,
    );
  });

  it("writes the sequence back into manifest.json and returns it", () => {
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "x");
    // A freshly built manifest carries no sequence: it exists only once signed.
    expect(writeOTAManifest({ distDir: dir, version: 3 })).not.toHaveProperty(
      "sequence",
    );
    const { keyId, privateKeySeedBase64 } = generateSigningKey();
    const result = signManifest({
      distDir: dir,
      keyId,
      privateKeySeedBase64,
      sequence: 42,
    });
    expect(result.sequence).toBe(42);
    const manifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    );
    expect(manifest.sequence).toBe(42);
  });

  it("defaults the sequence to the signing time in epoch seconds", () => {
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "x");
    writeOTAManifest({ distDir: dir, version: 3 });
    const { keyId, privateKeySeedBase64 } = generateSigningKey();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_700_000_000_500)); // fractional second → trunc
      const result = signManifest({
        distDir: dir,
        keyId,
        privateKeySeedBase64,
      });
      expect(result.sequence).toBe(1_700_000_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an explicit sequence beats the default, and re-signing ignores the manifest's own", () => {
    // Re-signing is a new publish: `?? now`, never `?? manifest.sequence`, so
    // an older bundle re-signed today takes a fresh place in the order (the
    // rollback story) instead of inheriting the value it was refused with.
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "x");
    writeOTAManifest({ distDir: dir, version: 3 });
    const { keyId, privateKeySeedBase64 } = generateSigningKey();
    expect(
      signManifest({ distDir: dir, keyId, privateKeySeedBase64, sequence: 7 })
        .sequence,
    ).toBe(7);
    const resigned = signManifest({
      distDir: dir,
      keyId,
      privateKeySeedBase64,
    });
    expect(resigned.sequence).not.toBe(7);
    expect(resigned.sequence).toBeGreaterThan(1_700_000_000);
  });

  it("rejects a sequence outside 1..Int32.max", () => {
    // Bound as a decimal literal into a `:`-delimited message, and decoded as
    // a Swift Int on the watch — 32-bit on arm64_32 (every watch before S9),
    // where a larger value fails the whole payload decode. Fractional, zero,
    // negative, NaN, or above 2^31-1 must not be minted.
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "x");
    writeOTAManifest({ distDir: dir, version: 1 });
    const { keyId, privateKeySeedBase64 } = generateSigningKey();
    expect(MAX_SEQUENCE).toBe(2 ** 31 - 1);
    for (const bad of [1.5, 0, -1, Number.NaN, 2 ** 31, 2 ** 53]) {
      expect(() =>
        signManifest({
          distDir: dir,
          keyId,
          privateKeySeedBase64,
          sequence: bad,
        }),
      ).toThrow(/sequence must be an integer in 1\.\.2147483647/);
    }
    expect(
      signManifest({
        distDir: dir,
        keyId,
        privateKeySeedBase64,
        sequence: MAX_SEQUENCE,
      }).sequence,
    ).toBe(MAX_SEQUENCE);
  });

  it("binds an expiry into the signature and writes it back (revocation lever)", () => {
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "x");
    writeOTAManifest({ distDir: dir, version: 3 });
    const { keyId, publicKeyBase64, privateKeySeedBase64 } =
      generateSigningKey();
    const expiresAt = 4102444800; // 2100-01-01
    const result = signManifest({
      distDir: dir,
      keyId,
      privateKeySeedBase64,
      expiresAt,
      sequence: 5,
    });
    expect(result.expiresAt).toBe(expiresAt);
    const manifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    );
    expect(manifest.expiresAt).toBe(expiresAt);
    // Signed over the expiry — the watch's UpdatePlan rebuilds this exact
    // string, so a stripped or altered expiry fails verification.
    const withExpiry = Buffer.from(`v3:${keyId}:3:5:${expiresAt}:x`, "utf8");
    const stripped = Buffer.from(`v3:${keyId}:3:5:0:x`, "utf8");
    const key = publicKeyFromRaw(publicKeyBase64);
    const sig = Buffer.from(result.signature, "base64");
    expect(verify(null, withExpiry, key, sig)).toBe(true);
    expect(verify(null, stripped, key, sig)).toBe(false);
  });

  it("binds the version into the signature — a re-versioned manifest won't verify", () => {
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "x");
    writeOTAManifest({ distDir: dir, version: 3 });
    const { keyId, publicKeyBase64, privateKeySeedBase64 } =
      generateSigningKey();
    const { signature } = signManifest({
      distDir: dir,
      keyId,
      privateKeySeedBase64,
      sequence: 5,
    });

    const wrongVersion = Buffer.from(`v3:${keyId}:4:5:0:x`, "utf8");
    expect(
      verify(
        null,
        wrongVersion,
        publicKeyFromRaw(publicKeyBase64),
        Buffer.from(signature, "base64"),
      ),
    ).toBe(false);
  });

  it("rejects a malformed keyId and a wrong-length seed", () => {
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "x");
    writeOTAManifest({ distDir: dir, version: 1 });
    const { privateKeySeedBase64 } = generateSigningKey();
    expect(() =>
      signManifest({ distDir: dir, keyId: "bad:id", privateKeySeedBase64 }),
    ).toThrow();
    expect(() =>
      signManifest({ distDir: dir, keyId: "ok", privateKeySeedBase64: "AAAA" }),
    ).toThrow();
  });
});
