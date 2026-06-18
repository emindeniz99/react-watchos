import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.{ts,tsx}"] },
  // One React instance for the app, the renderer, and the tests. With the
  // package installed normally this is the only config a consumer needs.
  resolve: { dedupe: ["react", "react-reconciler"] },
});
