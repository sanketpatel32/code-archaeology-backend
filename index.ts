import { buildApp } from "./src/app.js";

const start = async () => {
  const app = await buildApp();

  try {
    await app.listen({ port: app.config.PORT, host: "0.0.0.0" });
    app.log.info(`Server running on http://localhost:${app.config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
