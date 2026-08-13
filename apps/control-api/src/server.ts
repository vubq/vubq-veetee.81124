import { buildApp } from './app.js';

const app = buildApp();
const host = process.env.CONTROL_API_HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.CONTROL_API_PORT ?? '3000', 10);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
