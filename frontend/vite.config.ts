/// <reference types="vitest/config" />
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// Serves /train-models/<set>-<variant>.glb from <TRAIN_MODELS_DIR>/<set>/export/ while developing
const trainModelsDevServer = (modelsDir: string | undefined): Plugin => ({
  name: "train-models-dev-server",
  apply: "serve",
  configureServer(server) {
    if (!modelsDir) return;
    server.middlewares.use("/train-models", (req, res, next) => {
      const fileName = path.basename(decodeURIComponent((req.url ?? "").split("?")[0]));
      const set = fileName.match(/^([a-z0-9]+-set)-[a-z0-9-]+\.glb$/)?.[1];
      if (!set) return next();

      const filePath = path.join(modelsDir, set, "export", fileName);
      if (!existsSync(filePath)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Cache-Control", "no-cache");
      createReadStream(filePath).pipe(res);
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss(), trainModelsDevServer(env.TRAIN_MODELS_DIR)],
    optimizeDeps: {
      include: ["maplibre-gl"],
      esbuildOptions: {
        target: "es2022",
      },
    },
    build: {
      target: "es2022",
      rollupOptions: {
        output: {
          manualChunks: {
            maplibre: ["maplibre-gl"],
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
