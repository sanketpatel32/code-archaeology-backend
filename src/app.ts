import cors from "@fastify/cors";
import env from "@fastify/env";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { envSchema, parseCorsOrigins } from "./config/env.js";
import { registerRoutes } from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(env, {
    schema: envSchema,
    dotenv: true,
  });

  // Security: HTTP headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // Disable CSP for API-only server
  });

  // Security: Rate limiting (100 requests per minute per IP)
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  const corsOrigins = parseCorsOrigins(app.config.CORS_ORIGIN);
  await app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  });

  await app.register(sensible);
  await app.register(registerRoutes);

  return app;
}

