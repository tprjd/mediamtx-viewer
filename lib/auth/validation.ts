import { z } from 'zod'

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Enter your username.')
    .max(30)
    .regex(/^[a-zA-Z0-9_.]+$/, 'Enter your username.'),
  password: z.string().min(1, 'Enter your password.').max(128),
})

export const registrationSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(80),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(30, 'Username must be at most 30 characters.')
    .regex(
      /^[a-zA-Z0-9_.]+$/,
      'Use only letters, numbers, dots, and underscores.',
    ),
  email: z.email('Enter a valid email address.').trim().max(254),
  password: z
    .string()
    .min(15, 'Password must be at least 15 characters.')
    .max(128, 'Password must be at most 128 characters.'),
})

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20),
    password: z.string().min(15).max(128),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

