'use strict';

const request = require('supertest');
const app = require('../src/app');
const { User } = require('./utils');

async function makeUser(email) {
  const user = new User({
    name: 'Local User',
    email,
    phone: '9811111111',
    accountStatus: 'ACTIVE',
    emailVerification: { verified: true },
  });
  await user.setPassword('Password123');
  await user.save();
  return user;
}

describe('Authentication & password hashing', () => {
  test('registers a user, returns an HTTP-only cookie, role is USER', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Ravi Kumar',
      email: 'ravi@example.com',
      phone: '9811111111',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('USER');
    expect(res.body.data.user.password).toBeUndefined();

    const cookies = (res.headers['set-cookie'] || []).join('');
    expect(cookies).toContain('mm.token');
    expect(cookies).toContain('HttpOnly');
  });

  test('rejects duplicate email', async () => {
    const body = {
      name: 'Same Guy',
      email: 'dup@example.com',
      phone: '9811111112',
      password: 'Password123',
    };
    const first = await request(app).post('/api/v1/auth/register').send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/v1/auth/register').send(body);
    expect(second.status).toBe(409);
  });

  test('rejects weak password', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Weak Pass',
      email: 'weak@example.com',
      phone: '9811111113',
      password: 'abc',
    });
    expect(res.status).toBe(422);
  });

  test('a client cannot grant itself the admin role', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Hacker',
      email: 'hacker@example.com',
      phone: '9811111114',
      password: 'Password123',
      role: 'ADMIN',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('USER');
  });

  test('login with wrong password is rejected', async () => {
    await makeUser('wrongpw@example.com');
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'wrongpw@example.com',
      password: 'WrongPassword',
    });
    expect(res.status).toBe(401);
  });

  test('login with correct password works and /auth/me returns the user', async () => {
    await makeUser('works@example.com');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'works@example.com',
      password: 'Password123',
    });
    expect(login.status).toBe(200);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', login.headers['set-cookie']);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('works@example.com');
  });

  test('passwords are stored hashed (bcrypt), never plaintext', async () => {
    const created = await makeUser('hash@example.com');
    const fresh = await User.findById(created._id).select('+passwordHash');
    expect(fresh.passwordHash).not.toBe('Password123');
    expect(fresh.passwordHash).toMatch(/^\$2[aby]\$/);
    await expect(fresh.comparePassword('Password123')).resolves.toBe(true);
    await expect(fresh.comparePassword('WrongPass')).resolves.toBe(false);
  });

  test('forgot + reset password flow works', async () => {
    await makeUser('reset@example.com');
    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'reset@example.com' });
    expect(forgot.status).toBe(200);
    const token = forgot.body.data.resetToken;
    expect(token).toBeTruthy();

    const reset = await request(app).post('/api/v1/auth/reset-password').send({
      token,
      password: 'NewPassword456',
    });
    expect(reset.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'reset@example.com', password: 'Password123' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'reset@example.com', password: 'NewPassword456' });
    expect(newLogin.status).toBe(200);
  });

  test('unknown email on forgot-password does not reveal existence', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.resetToken).toBeUndefined();
  });
});