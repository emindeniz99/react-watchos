import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.{ts,tsx}"] },
  resolve: { dedupe: ["react", "react-reconciler"] },
});
