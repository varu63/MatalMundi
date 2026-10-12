'use strict';

const request = require('supertest');
const app = require('../src/app');
const { createUser, createAdmin, submitWaste } = require('./utils');

class CookieUser {
  constructor(cookieString) {
    this.cookieString = cookieString;
  }

  async get(path) {
    return request(app).get(`/api/v1${path}`).set('Cookie', this.cookieString);
  }

  async post(path, body) {
    return request(app).post(`/api/v1${path}`).send(body).set('Cookie', this.cookieString);
  }

  async patch(path, body) {
    return request(app).patch(`/api/v1${path}`).send(body).set('Cookie', this.cookieString);
  }
}

async function loginAs(user) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  const cookies = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  return new CookieUser(cookies);
}

describe('Role-based access control', () => {
  test('unauthenticated users cannot access the admin dashboard', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard');
    expect(res.status).toBe(401);
  });

  test('ordinary users cannot access the admin dashboard (403)', async () => {
    const userAgent = await loginAs(await createUser());
    const res = await userAgent.get('/admin/dashboard');
    expect(res.status).toBe(403);
  });

  test('ordinary users cannot approve waste submissions (403)', async () => {
    const userAgent = await loginAs(await createUser());
    const res = await userAgent.post('/admin/waste-submissions/000000000000000000000000/approve', {});
    expect(res.status).toBe(403);
  });

  test('users cannot access admin pricing and audit endpoints', async () => {
    const userAgent = await loginAs(await createUser());
    const pricing = await userAgent.get('/admin/pricing');
    expect(pricing.status).toBe(403);
    const audit = await userAgent.get('/admin/audit-logs');
    expect(audit.status).toBe(403);
  });

  test('admins can access the admin dashboard (200)', async () => {
    const adminAgent = await loginAs(await createAdmin());
    const res = await adminAgent.get('/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.stats).toBeDefined();
  });

  test('users cannot view another users submission (403)', async () => {
    const userAgent = await loginAs(await createUser());
    const other = await createUser();
    const otherAgent = await loginAs(other);

    const submit = await submitWaste(otherAgent);
    expect(submit.status).toBe(201);
    const submissionId = submit.body.data.submission.id;

    const res = await userAgent.get(`/waste-submissions/${submissionId}`);
    expect(res.status).toBe(403);
  });

  test('users can view their own submission (200)', async () => {
    const userAgent = await loginAs(await createUser());
    const submit = await submitWaste(userAgent);
    expect(submit.status).toBe(201);
    const id = submit.body.data.submission.id;

    const res = await userAgent.get(`/waste-submissions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.submission.id).toBe(id);
  });
});

module.exports = { CookieUser };