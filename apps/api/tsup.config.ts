import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/app.ts"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: ["@pos/domain", "@pos/contracts"],
});
