import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    coverage: { provider: "v8", reporter: ["text", "json", "html"] },
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
  },
});
