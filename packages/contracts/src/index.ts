import { z } from 'zod';

export const RoleEnum = z.enum(['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']);
export type Role = z.infer<typeof RoleEnum>;

export const JobStatusEnum = z.enum(['queued', 'processing', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatusEnum>;

// ── Auth Contracts ──────────────────────────

export const RegisterRequestSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string().datetime(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const AuthResponseSchema = z.object({
  user: UserResponseSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ── Job Contracts ───────────────────────────

export const CreateJobRequestSchema = z.object({
  type: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const JobResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type JobResponse = z.infer<typeof JobResponseSchema>;

// ── Error Contracts ─────────────────────────

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  message: z.string(),
  error: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ── Job Message Contract (RabbitMQ) ─────────

export const JobMessageSchema = z.object({
  jobId: z.string().uuid(),
  instituteId: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type JobMessage = z.infer<typeof JobMessageSchema>;
