import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/", async () => ({ message: "Code Archaeology API" }));

  app.get("/api/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));
}
