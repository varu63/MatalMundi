'use strict';

process.env.ENFORCE_RATE_LIMIT = 'true';

const request = require('supertest');
const env = require('../src/config/env');
const app = require('../src/app');
const { createUser } = require('./utils');

// Tighten the per-account budget so the limiter can be exercised quickly. The
// limit is resolved per request, so mutating the loaded config is enough.
const ORIGINAL_ACCOUNT_MAX = env.rateLimits.authAccountMax;
env.rateLimits.authAccountMax = 3;

const WRONG_PASSWORD = 'WrongPassword123';

function login(email, password) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

/**
 * Regression coverage for the auth rate limiter.
 *
 * The limiter used to be a single 20-requests / 15-minute bucket keyed on the
 * client IP. On a shared network (CGNAT, campus, office) every user shares one
 * bucket, so 20 sign-ins from one gateway locked out everyone behind it.
 * The limiter is now split: a loose per-IP budget plus a tight per-account
 * budget keyed on (IP + e-mail).
 */
describe('Auth rate limiting', () => {
  afterAll(() => {
    delete process.env.ENFORCE_RATE_LIMIT;
    env.rateLimits.authAccountMax = ORIGINAL_ACCOUNT_MAX;
  });

  test('blocks repeated failed logins for one account', async () => {
    const email = 'sprayed@test.dev';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await login(email, WRONG_PASSWORD);
      expect(res.status).toBe(401);
    }

    const blocked = await login(email, WRONG_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });

  test('a different account from the same IP is not blocked', async () => {
    const sprayed = 'sprayed-a@test.dev';
    const neighbour = 'neighbour@test.dev';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await login(sprayed, WRONG_PASSWORD);
    }
    expect((await login(sprayed, WRONG_PASSWORD)).status).toBe(429);

    const res = await login(neighbour, WRONG_PASSWORD);
    expect(res.status).toBe(401);
  });

  test('a successful login is not charged to the account budget', async () => {
    const user = await createUser();

    expect((await login(user.email, WRONG_PASSWORD)).status).toBe(401);
    expect((await login(user.email, WRONG_PASSWORD)).status).toBe(401);

    const success = await login(user.email, 'Password123');
    expect(success.status).toBe(200);

    // The success restored one slot, so another failed attempt is still served
    // instead of being rejected with 429.
    expect((await login(user.email, WRONG_PASSWORD)).status).toBe(401);
    expect((await login(user.email, WRONG_PASSWORD)).status).toBe(429);
  });

  test('the per-IP budget tolerates many distinct accounts', async () => {
    const results = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await login(`nat-user-${i}@test.dev`, WRONG_PASSWORD);
      results.push(res.status);
    }

    // Distinct accounts on a shared IP must not be throttled by the IP budget.
    expect(results.every((status) => status === 401)).toBe(true);
  });
});
