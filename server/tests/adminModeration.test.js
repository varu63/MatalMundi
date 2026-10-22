'use strict';

const request = require('supertest');
const app = require('../src/app');
const { createUser, createAdmin, createCategory, createPricing } = require('./utils');

async function loginAs(user) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  const cookies = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  return cookies;
}

/**
 * Regression coverage for the admin moderation endpoints. These routes used to
 * pass a plain object of Zod schemas to validate(), which blew up at request
 * time with "schema.safeParse is not a function" (HTTP 500).
 */
describe('Admin moderation endpoints', () => {
  test('admin can suspend a user and the user can no longer log in', async () => {
    const adminCookies = await loginAs(await createAdmin());
    const user = await createUser();

    const suspend = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/status`)
      .set('Cookie', adminCookies)
      .send({ status: 'SUSPENDED' });

    expect(suspend.status).toBe(200);
    expect(suspend.body.data.user.accountStatus).toBe('SUSPENDED');

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password123' });
    expect(login.status).toBe(403);
  });

  test('admin can reactivate a suspended user', async () => {
    const adminCookies = await loginAs(await createAdmin());
    const user = await createUser();

    await request(app)
      .patch(`/api/v1/admin/users/${user.id}/status`)
      .set('Cookie', adminCookies)
      .send({ status: 'SUSPENDED' });

    const reactivate = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/status`)
      .set('Cookie', adminCookies)
      .send({ status: 'ACTIVE' });

    expect(reactivate.status).toBe(200);
    expect(reactivate.body.data.user.accountStatus).toBe('ACTIVE');

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password123' });
    expect(login.status).toBe(200);
  });

  test('suspending a user rejects an unknown status with 400', async () => {
    const adminCookies = await loginAs(await createAdmin());
    const user = await createUser();

    const res = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/status`)
      .set('Cookie', adminCookies)
      .send({ status: 'BANISHED' });

    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  test('admin cannot suspend another admin account', async () => {
    const adminCookies = await loginAs(await createAdmin());
    const otherAdmin = await createAdmin();

    const res = await request(app)
      .patch(`/api/v1/admin/users/${otherAdmin.id}/status`)
      .set('Cookie', adminCookies)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(403);
  });

  test('admin can activate and deactivate a pricing rule', async () => {
    const adminCookies = await loginAs(await createAdmin());
    const category = await createCategory();
    const pricing = await createPricing(category);

    const deactivate = await request(app)
      .patch(`/api/v1/admin/pricing/${pricing.id}/status`)
      .set('Cookie', adminCookies)
      .send({ active: false });

    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.config.active).toBe(false);

    const activate = await request(app)
      .patch(`/api/v1/admin/pricing/${pricing.id}/status`)
      .set('Cookie', adminCookies)
      .send({ active: true });

    expect(activate.status).toBe(200);
    expect(activate.body.data.config.active).toBe(true);
  });

  test('pricing toggle accepts the string "false" as false', async () => {
    const adminCookies = await loginAs(await createAdmin());
    const category = await createCategory();
    const pricing = await createPricing(category);

    const res = await request(app)
      .patch(`/api/v1/admin/pricing/${pricing.id}/status`)
      .set('Cookie', adminCookies)
      .send({ active: 'false' });

    expect(res.status).toBe(200);
    expect(res.body.data.config.active).toBe(false);
  });

  test('ordinary users cannot reach the moderation endpoints', async () => {
    const userCookies = await loginAs(await createUser());
    const target = await createUser();

    const suspend = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set('Cookie', userCookies)
      .send({ status: 'SUSPENDED' });
    expect(suspend.status).toBe(403);

    const toggle = await request(app)
      .patch('/api/v1/admin/pricing/000000000000000000000000/status')
      .set('Cookie', userCookies)
      .send({ active: false });
    expect(toggle.status).toBe(403);
  });
});
