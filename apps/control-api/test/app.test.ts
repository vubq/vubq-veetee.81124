import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('control API smoke endpoint', () => {
  it('reports that the service is ready', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: 'control-api', status: 'ok' });
  });
});
