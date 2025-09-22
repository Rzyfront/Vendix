import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private attempts = new Map<string, RateLimitRecord>();

  use(req: Request, res: Response, next: NextFunction) {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutos
    const maxAttempts = 10;

    const record = this.attempts.get(key);

    if (!record || now > record.resetTime) {
      // Primera request o ventana expirada
      this.attempts.set(key, { count: 1, resetTime: now + windowMs });
      next();
    } else if (record.count < maxAttempts) {
      // Incrementar contador
      record.count++;
      next();
    } else {
      // Rate limit excedido
      res.status(429).json({
        statusCode: 429,
        message: 'Too many requests from this IP, please try again later.',
        error: 'Too Many Requests',
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      });
    }
  }
}

@Injectable()
export class LoginRateLimitMiddleware implements NestMiddleware {
  private attempts = new Map<string, RateLimitRecord>();

  use(req: Request, res: Response, next: NextFunction) {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutos
    const maxAttempts = 10;

    const record = this.attempts.get(key);

    if (!record || now > record.resetTime) {
      this.attempts.set(key, { count: 1, resetTime: now + windowMs });
      next();
    } else if (record.count < maxAttempts) {
      record.count++;
      next();
    } else {
      res.status(429).json({
        statusCode: 429,
        message: 'Too many login attempts from this IP, please try again later.',
        error: 'Too Many Login Attempts',
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      });
    }
  }
}

@Injectable()
export class RefreshRateLimitMiddleware implements NestMiddleware {
  private attempts = new Map<string, RateLimitRecord>();

  use(req: Request, res: Response, next: NextFunction) {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 5 * 60 * 1000; // 5 minutos
    const maxAttempts = 10;

    const record = this.attempts.get(key);

    if (!record || now > record.resetTime) {
      this.attempts.set(key, { count: 1, resetTime: now + windowMs });
      next();
    } else if (record.count < maxAttempts) {
      record.count++;
      next();
    } else {
      res.status(429).json({
        statusCode: 429,
        message: 'Too many refresh attempts from this IP, please try again later.',
        error: 'Too Many Refresh Attempts',
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      });
    }
  }
}
