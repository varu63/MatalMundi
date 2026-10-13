'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  createUser,
  createCategory,
  createPricing,
  submitWaste,
  attachImages,
  categories,
} = require('./utils');

async function freshSellerCookie() {
  const user = await createUser();
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

async function multipartSubmission(cookie, body) {
  let req = request(app).post('/api/v1/waste-submissions').set('Cookie', cookie);
  for (const [k, v] of Object.entries(body)) {
    if (v === null || v === undefined) continue;
    if (k === 'pickup') req = req.field('pickup', JSON.stringify(v));
    else if (typeof v === 'object') req = req.field(k, JSON.stringify(v));
    else req = req.field(k, String(v));
  }
  req = await attachImages(req);
  return req;
}

describe('Waste submission rules', () => {
  test('submissions below 100 kg are rejected', async () => {
    const cookie = await freshSellerCookie();
    const res = await submitWaste({ cookie, quantityKg: 99.9 });
    expect(res.status).toBe(400);
  });

  test('submissions of exactly 100 kg are accepted', async () => {
    const cookie = await freshSellerCookie();
    const res = await submitWaste({ cookie, quantityKg: 100 });
    expect(res.status).toBe(201);
    expect(res.body.data.submission.status).toBe('PENDING_APPROVAL');
    expect(res.body.data.submission.quantityKg).toBe(100);
  });

  test('all four side photographs are required', async () => {
    const cookie = await freshSellerCookie();
    const category = await createCategory('Non-Ferrous');
    await createPricing(category);

    let req = request(app).post('/api/v1/waste-submissions').set('Cookie', cookie);
    req = req
      .field('materialCategory', String(category.id))
      .field('materialType', 'Aluminium')
      .field('quantityKg', '120')
      .field('condition', 'BALED')
      .field('qualityGrade', 'A')
      .field('description', 'Clean baled aluminium scrap.')
      .field('demandBasis', 'TOTAL')
      .field('demandedPrice', '5000')
      .field(
        'pickup',
        JSON.stringify({
          address: '5 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
          contactName: 'Asha',
          contactPhone: '9876543210',
        })
      );
    req = await req
      .attach('front', Buffer.from('x'), 'front.png')
      .attach('back', Buffer.from('x'), 'back.png')
      .attach('left', Buffer.from('x'), 'left.png');
    // missing 'right'
    const res = await req;
    expect(res.status).toBe(400);
  });

  test('invalid image types are rejected', async () => {
    const cookie = await freshSellerCookie();
    const category = await createCategory('Plastics');
    await createPricing(category, { materialType: 'Plastics' });

    let req = request(app).post('/api/v1/waste-submissions').set('Cookie', cookie);
    req = req
      .field('materialCategory', String(category.id))
      .field('materialType', 'HDPE')
      .field('quantityKg', '150')
      .field('condition', 'LOOSE')
      .field('qualityGrade', 'B')
      .field('description', 'Baled HDPE scrap for recycling.')
      .field('demandBasis', 'TOTAL')
      .field('demandedPrice', '3000')
      .field(
        'pickup',
        JSON.stringify({
          address: '7 Link Road',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          contactName: 'Dev',
          contactPhone: '9876543211',
        })
      );
    for (const side of ['front', 'back', 'left', 'right']) {
      req = req.attach(side, Buffer.from('not-an-image'), `${side}.txt`);
    }
    const res = await req;
    expect(res.status).toBe(400);
  });

  test('submitted material is not visible on the public marketplace', async () => {
    const cookie = await freshSellerCookie();
    const res = await submitWaste({ cookie, quantityKg: 200 });
    expect(res.status).toBe(201);

    const listing = await request(app).get('/api/v1/marketplace');
    expect(listing.status).toBe(200);
    expect(listing.body.data).toHaveLength(0);

    const detail = await request(app).get(`/api/v1/marketplace/${res.body.data.submission.id}`);
    expect(detail.status).toBe(404);
  });

  test('a duplicate identical submission within a few seconds is blocked', async () => {
    const cookie = await freshSellerCookie();
    const first = await submitWaste({ cookie, quantityKg: 130 });
    expect(first.status).toBe(201);
    const second = await submitWaste({ cookie, quantityKg: 130 });
    expect(second.status).toBe(409);
  });

  test('unsupported/inactive categories are rejected', async () => {
    const cookie = await freshSellerCookie();
    const inactive = await createCategory('Inactive');
    await categories.updateById(inactive.id, { active: false });

    const res = await multipartSubmission(cookie, {
      materialCategory: inactive.id,
      materialType: 'Anything',
      quantityKg: 300,
      condition: 'LOOSE',
      qualityGrade: 'B',
      description: 'Description of the material for review.',
      pickup: {
        address: '9 Station Road',
        city: 'Noida',
        state: 'UP',
        postalCode: '201301',
        contactName: 'Nitin',
        contactPhone: '9876543212',
      },
      demandBasis: 'TOTAL',
      demandedPrice: 1000,
    });
    expect(res.status).toBe(400);
  });

  test('valuation estimate endpoint returns a snapshot', async () => {
    const cookie = await freshSellerCookie();
    const category = await createCategory('Copper');
    await createPricing(category, { materialType: 'Copper', ratePerKgPaise: 43000 });
    const res = await request(app)
      .post('/api/v1/waste-submissions/estimate')
      .set('Cookie', cookie)
      .send({
        materialCategory: category.id,
        materialType: 'Copper',
        quantityKg: 200,
        qualityGrade: 'A',
        pickup: { city: 'Mumbai', state: 'Maharashtra' },
      });
    expect(res.status).toBe(200);
    const v = res.body.data.valuation;
    expect(v.materialValuePaise).toBe(Math.round(200 * 43000 * 1.1));
    expect(v.estimatedPayoutPaise).toBeLessThan(v.materialValuePaise); // fees subtracted
    expect(v.currency).toBe('INR');
  });

  test('client-supplied totals do not affect the server valuation', async () => {
    const cookie = await freshSellerCookie();
    const category = await createCategory('Brass');
    await createPricing(category, { materialType: 'Brass', ratePerKgPaise: 25000 });
    const res = await request(app)
      .post('/api/v1/waste-submissions/estimate')
      .set('Cookie', cookie)
      .send({
        materialCategory: category.id,
        materialType: 'Brass',
        quantityKg: 100,
        qualityGrade: 'B',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.valuation.materialValuePaise).toBe(100 * 25000 * 1.0);
  });
});
