import { User } from '@prisma/client';

export type { AuthenticatedRequest } from '../middleware/auth';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export type SafeUser = Omit<User, never>;
