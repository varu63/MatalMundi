import { describe, expect, it } from 'vitest';
import {
  paise,
  kg,
  titleCase,
  countdown,
  firstImage,
  imageUrl,
  statusTone,
  dateOnly,
} from './format';

describe('paise', () => {
  it('converts paise to rupees with Indian digit grouping', () => {
    expect(paise(1500)).toBe('₹15');
    expect(paise(123456)).toBe('₹1,234.56');
    expect(paise(100000)).toBe('₹1,000');
  });

  it('falls back to ₹0 for missing values', () => {
    expect(paise(null)).toBe('₹0');
    expect(paise(undefined)).toBe('₹0');
  });
});

describe('kg', () => {
  it('formats weights with Indian digit grouping', () => {
    expect(kg(500)).toBe('500 kg');
    expect(kg(123456)).toBe('1,23,456 kg');
  });

  it('falls back to 0 kg for missing values', () => {
    expect(kg(null)).toBe('0 kg');
  });
});

describe('titleCase', () => {
  it('converts SCREAMING_SNAKE_CASE to Title Case', () => {
    expect(titleCase('PENDING_APPROVAL')).toBe('Pending Approval');
    expect(titleCase('READY_FOR_DISPATCH')).toBe('Ready For Dispatch');
  });

  it('handles empty input', () => {
    expect(titleCase('')).toBe('');
    expect(titleCase(null)).toBe('');
  });
});

describe('countdown', () => {
  it('returns empty string for missing or past timestamps', () => {
    expect(countdown('')).toBe('');
    expect(countdown(new Date(Date.now() - 5000).toISOString())).toBe('');
  });

  it('renders mm:ss under an hour and h:mm:ss above it', () => {
    expect(countdown(new Date(Date.now() + 65_250).toISOString())).toBe('01:05');
    expect(countdown(new Date(Date.now() + 3_661_250).toISOString())).toBe('1:01:01');
  });
});

describe('images', () => {
  it('imageUrl picks the url field', () => {
    expect(imageUrl({ url: '/uploads/a.png' })).toBe('/uploads/a.png');
    expect(imageUrl({})).toBe('');
    expect(imageUrl(null)).toBe('');
  });

  it('firstImage handles arrays, single objects and junk', () => {
    expect(firstImage([{ url: 'a.png' }, { url: 'b.png' }])).toBe('a.png');
    expect(firstImage({ url: 'only.png' })).toBe('only.png');
    expect(firstImage([])).toBe('');
    expect(firstImage(null)).toBe('');
  });
});

describe('statusTone', () => {
  it('maps known statuses to colour classes', () => {
    expect(statusTone('APPROVED')).toContain('bg-emerald-100');
    expect(statusTone('REJECTED')).toContain('bg-red-100');
  });

  it('is case-insensitive and has a fallback', () => {
    expect(statusTone('approved')).toContain('bg-emerald-100');
    expect(statusTone('NOT_A_STATUS')).toBe('bg-gray-100 text-gray-700');
    expect(statusTone(undefined)).toBe('bg-gray-100 text-gray-700');
  });
});

describe('dateOnly', () => {
  it('renders a short human date containing the year', () => {
    expect(dateOnly('2026-03-05T10:00:00Z')).toMatch(/2026/);
    expect(typeof dateOnly('2026-03-05T10:00:00Z')).toBe('string');
  });
});
