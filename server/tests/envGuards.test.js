'use strict';

/**
 * Boot-time configuration guards. `src/config/env.js` is a singleton that reads
 * server/.env at import time, so each case runs in its own process with an
 * explicit environment instead of mutating this test runner's env.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const ENV_MODULE = path.resolve(__dirname, '../src/config/env.js');

function loadEnv(vars) {
  const script = `
    try { require(${JSON.stringify(ENV_MODULE)}); process.stdout.write('STARTED'); }
    catch (err) { process.stdout.write('REFUSED:' + err.message); }
  `;
  return execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ...vars },
  });
}

describe('Configuration guards', () => {
  test('production refuses the development JWT and cookie secrets', () => {
    const out = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/metalmundi',
      JWT_SECRET: '',
      COOKIE_SECRET: '',
    });
    expect(out).toMatch(/^REFUSED:Refusing to start in production with development secrets/);
  });

  test('production refuses to fall back to the development database URL', () => {
    const out = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: '',
      JWT_SECRET: 'a-real-production-secret-value',
      COOKIE_SECRET: 'another-real-production-secret-value',
    });
    expect(out).toMatch(/^REFUSED:Refusing to start in production without DATABASE_URL/);
  });

  test('production starts when every secret is supplied', () => {
    const out = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/metalmundi',
      JWT_SECRET: 'a-real-production-secret-value',
      COOKIE_SECRET: 'another-real-production-secret-value',
    });
    expect(out).toBe('STARTED');
  });

  test('development keeps its offline-friendly defaults', () => {
    const out = loadEnv({
      NODE_ENV: 'development',
      DATABASE_URL: '',
      JWT_SECRET: '',
      COOKIE_SECRET: '',
    });
    expect(out).toBe('STARTED');
  });
});
