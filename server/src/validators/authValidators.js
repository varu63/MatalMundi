'use strict';

const { z, addressSchema, phone } = require('./commonValidators');

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[a-zA-Z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    phone,
    password,
    confirmPassword: z.string().optional(),
    address: addressSchema.optional(),
  })
  .refine((d) => !d.confirmPassword || d.confirmPassword === d.password, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
});

const resetPasswordSchema = z
  .object({
    token: z.string().min(10, 'Invalid token'),
    password,
    confirmPassword: z.string().optional(),
  })
  .refine((d) => !d.confirmPassword || d.confirmPassword === d.password, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phone.optional(),
  address: addressSchema.partial().optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
};
