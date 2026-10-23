'use strict';

/**
 * Error-normalisation unit tests: these cover the paths a live outage would hit
 * (database unreachable, migrations pending) without stopping anyone's Postgres.
 */
const env = require('../src/config/env');
const { errorHandler } = require('../src/middleware/error');

function run(err) {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  errorHandler(err, { method: 'GET', originalUrl: '/api/v1/x' }, res, () => {});
  return res;
}

function prismaKnown(code, meta) {
  const err = new Error(`prisma ${code}`);
  err.name = 'PrismaClientKnownRequestError';
  err.code = code;
  if (meta) err.meta = meta;
  return err;
}

describe('Error normalisation — database availability', () => {
  test('an unreachable database answers 503 DB_UNAVAILABLE, not 500', () => {
    const res = run(prismaKnown('P1001'));
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('DB_UNAVAILABLE');
    expect(res.body.message).toBe('Database unavailable');
  });

  test('a pool timeout and a connection-init failure map to the same 503', () => {
    for (const err of [
      prismaKnown('P1008'),
      Object.assign(new Error('Can\'t reach database server'), {
        name: 'PrismaClientInitializationError',
      }),
    ]) {
      const res = run(err);
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('DB_UNAVAILABLE');
    }
  });

  test('a missing table reports DB_SCHEMA without exposing internals', () => {
    const err = prismaKnown('P2021');
    err.meta = { table: '"SecretTable"' };
    const dev = run(err);
    expect(dev.statusCode).toBe(503);
    expect(dev.body.code).toBe('DB_SCHEMA');
    expect(dev.body.message).not.toMatch(/SecretTable|migration not applied/i);

    const previous = env.isProd;
    env.isProd = true;
    try {
      const prod = run(err);
      expect(JSON.stringify(prod.body)).not.toMatch(/SecretTable|stack/);
    } finally {
      env.isProd = previous;
    }
  });
});

describe('Error normalisation — request bodies and known conflicts', () => {
  test('malformed JSON never echoes the parser message', () => {
    const err = Object.assign(new Error('Unexpected token < in JSON at position 0'), {
      type: 'entity.parse.failed',
      status: 400,
      expose: true,
    });
    const res = run(err);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Malformed JSON body', code: 'INVALID_JSON' });
  });

  test('an oversized body is refused with 413', () => {
    const err = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
      expose: true,
    });
    const res = run(err);
    expect(res.statusCode).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('a body-parser rejection that is not exposed to the client is sanitised', () => {
    const err = Object.assign(new Error('correct-header: UTF-8 is required'), {
      status: 415,
      statusCode: undefined,
      expose: false,
    });
    const res = run(err);
    expect(res.statusCode).toBe(415);
    expect(res.body.message).toBe('Request rejected');
  });

  test('unique, missing-record and relation violations become 409 / 404 / 400', () => {
    expect(run(prismaKnown('P2002', { target: ['email'] })).statusCode).toBe(409);
    expect(run(prismaKnown('P2025')).statusCode).toBe(404);
    expect(run(prismaKnown('P2003')).statusCode).toBe(400);
    const validation = Object.assign(new Error('Prisma validation'), {
      name: 'PrismaClientValidationError',
    });
    expect(run(validation).statusCode).toBe(400);
  });

  test('a rejected upload is reported as a client error', () => {
    const err = Object.assign(new Error('File too large'), { name: 'MulterError' });
    const res = run(err);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Upload error/);
  });
});

describe('Error normalisation — information leakage', () => {
  test('an unexpected failure keeps the stack in development only', () => {
    const dev = run(new Error('boom'));
    expect(dev.statusCode).toBe(500);
    expect(dev.body.code).toBe('INTERNAL');
    expect(dev.body.stack).toBeDefined();

    const previous = env.isProd;
    env.isProd = true;
    try {
      const prod = run(new Error('boom with /home/deploy/secret path'));
      expect(prod.statusCode).toBe(500);
      expect(prod.body.message).toBe('Internal Server Error');
      expect(prod.body.stack).toBeUndefined();
      expect(JSON.stringify(prod.body)).not.toMatch(/boom|\/home\/deploy/);
    } finally {
      env.isProd = previous;
    }
  });
});
