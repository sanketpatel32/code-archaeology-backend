import type { FastifyInstance } from "fastify";
import { analysisRoutes } from "./analysis.js";
import { healthRoutes } from "./health.js";
import { repositoryRoutes } from "./repositories.js";

export async function registerRoutes(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(analysisRoutes);
  await app.register(repositoryRoutes);
}
