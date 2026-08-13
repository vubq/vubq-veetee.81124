import { describe, expect, it } from 'vitest';

import integrationConfig from '../vitest.integration.config.js';

describe('PostgreSQL integration Vitest configuration', () => {
  it('selects only the PostgreSQL integration contract and fails when no test is found', () => {
    expect(integrationConfig.test?.include).toEqual(['test/postgres.integration.test.ts']);
    expect(integrationConfig.test?.passWithNoTests).toBe(false);
    expect(integrationConfig.test?.testTimeout).toBe(30_000);
  });
});
