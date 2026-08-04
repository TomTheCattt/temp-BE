import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from '../utils/errors';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new AppError(422, 'VALIDATION_ERROR', result.error.errors[0]?.message ?? 'Invalid input'));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new AppError(422, 'VALIDATION_ERROR', result.error.errors[0]?.message ?? 'Invalid query'));
      return;
    }
    req.query = result.data as typeof req.query;
    next();
  };
}
