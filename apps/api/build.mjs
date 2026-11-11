// Bundles our own code (including @studio/shared) into dist/, leaving npm packages as normal imports.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts", "src/jobs/worker.ts", "src/scripts/migrate.ts"],
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  plugins: [
    {
      name: "external-npm-packages",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith("@studio/") ? undefined : { path: args.path, external: true }));
      },
    },
  ],
});
console.log("Built dist/");
