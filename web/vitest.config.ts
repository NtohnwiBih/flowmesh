import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Logic tests run in node. Component tests opt in to a browser-like DOM with
  // "// @vitest-environment jsdom" at the top of the file.
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
