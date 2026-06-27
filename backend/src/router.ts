import type { Express } from "express";
import { trainsRouter } from "./endpoints/trains.routes";

export const registerRoutes = (app: Express): void => {
  app.use("/api/trains", trainsRouter);
};
