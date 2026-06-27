import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateSigningKey,
  signManifest,
  writeOTAManifest,
} from "../esbuild/manifest.mjs";

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

  it("signs v1:<kid>:<version>:<bundle> and verifies with the public key", () => {
    dir = mkdtempSync(join(tmpdir(), "rnw-sign-"));
    writeFileSync(join(dir, "bundle.js"), "globalThis.__x=42;");
    writeOTAManifest({ distDir: dir, version: 7 });
    const { keyId, publicKeyBase64, privateKeySeedBase64 } =
      generateSigningKey();

    const result = signManifest({ distDir: dir, keyId, privateKeySeedBase64 });
    expect(result.version).toBe(7); // taken from the manifest, not a separate arg

    const manifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    );
    expect(manifest.keyId).toBe(keyId);
    expect(manifest.signature).toBe(result.signature);

    // The interop contract: the signature must verify over the EXACT bytes the
    // watch rebuilds in UpdatePlan.signedMessage (pinned by Swift's
    // OTASigningInteropTests). If this format drifts, OTA breaks silently.
    const message = Buffer.from(`v1:${keyId}:7:globalThis.__x=42;`, "utf8");
    expect(
      verify(
        null,
        message,
        publicKeyFromRaw(publicKeyBase64),
        Buffer.from(result.signature, "base64"),
      ),
    ).toBe(true);
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
    });

    const wrongVersion = Buffer.from(`v1:${keyId}:4:x`, "utf8");
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
