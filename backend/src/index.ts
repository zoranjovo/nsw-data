import "dotenv/config";
import compression from "compression";
import cors from "cors";
import express from "express";
import { registerRoutes } from "./router";
import { appState, initialiseApp, wakeUpApp } from "./state/appState";

const app = express();

app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(express.json());

app.get("/health", (_req, res) => {
  const buildHash = process.env.BUILD_HASH ?? "local";
  if (!appState.isReady) {
    return res.status(503).json({ status: "starting", buildHash });
  }
  return res.json({ status: "ok", buildHash });
});

app.use((_req, res, next) => {
  if (!appState.isReady) {
    return res.status(503).json({ error: "Service is not ready" });
  }
  if (!appState.isActive) {
    void wakeUpApp();
  }
  next();
});
registerRoutes(app);

const PORT = parseInt(process.env.PORT ?? "3000", 10);
app.listen(PORT, async () => {
  await initialiseApp();
  console.log(`Backend running at http://localhost:${PORT}`);
});
