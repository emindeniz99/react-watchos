import { afterEach, describe, expect, it } from "vitest";
import { generateText, isOnDeviceAIAvailable } from "../src/index";
import { installMockHost } from "./helpers";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__host;
});

describe("on-device AI (generateText)", () => {
  it("sends the prompt + options and resolves with generated text", async () => {
    const host = installMockHost();
    const promise = generateText("Summarize my day", {
      temperature: 0.7,
      maxTokens: 128,
      instructions: "Be terse.",
    });
    expect(host.generate).toHaveBeenCalledTimes(1);
    const [id, reqJson] = host.generate.mock.calls[0];
    // maxTokens must reach the request JSON so the native side can cap the
    // response (GenerationOptions.maximumResponseTokens) — CX-002.
    expect(JSON.parse(reqJson)).toMatchObject({
      prompt: "Summarize my day",
      temperature: 0.7,
      maxTokens: 128,
      instructions: "Be terse.",
    });

    (g.__resolveGenerate as (i: number, t: string) => void)(
      id,
      "Busy but good.",
    );
    expect(await promise).toBe("Busy but good.");
  });

  it("rejects via __rejectGenerate", async () => {
    const host = installMockHost();
    const promise = generateText("hi");
    const [id] = host.generate.mock.calls[0];
    (g.__rejectGenerate as (i: number, m: string) => void)(id, "model busy");
    await expect(promise).rejects.toThrow("model busy");
  });

  it("rejects when on-device AI is unavailable", async () => {
    await expect(generateText("hi")).rejects.toThrow(/unavailable/);
  });

  // CX-002 capability query: a runtime availability check (distinct from the
  // build-time `ai` feature) so UIs can show/hide AI without a throwaway call.
  it("isOnDeviceAIAvailable resolves false without an AI-capable host", async () => {
    expect(await isOnDeviceAIAvailable()).toBe(false);
  });

  it("isOnDeviceAIAvailable resolves the host's answer", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      const g = globalThis as {
        __resolveInvoke?: (id: number, resultJson: string) => void;
      };
      if (method === "aiAvailability") g.__resolveInvoke?.(id, "true");
    });
    expect(await isOnDeviceAIAvailable()).toBe(true);
  });
});
