import {
  Inject,
  Injectable,
  NestMiddleware,
  Logger,
  Type,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

interface RateLimitConfig {
  prefix: string;
  windowSeconds: number;
  maxAttempts: number;
  message: string;
  errorLabel: string;
}

export function createRateLimitMiddleware(
  config: RateLimitConfig,
): Type<NestMiddleware> {
  @Injectable()
  class RedisRateLimitMiddleware implements NestMiddleware {
    private readonly logger = new Logger(`RateLimit:${config.prefix}`);

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    async use(req: Request, res: Response, next: NextFunction) {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${config.prefix}:${ip}`;

      try {
        const current = await this.redis.incr(key);
        if (current === 1) {
          await this.redis.expire(key, config.windowSeconds);
        }

        if (current > config.maxAttempts) {
          const ttl = await this.redis.ttl(key);
          return res.status(429).json({
            statusCode: 429,
            message: config.message,
            error: config.errorLabel,
            retryAfter: ttl > 0 ? ttl : config.windowSeconds,
          });
        }

        next();
      } catch (error) {
        this.logger.warn(`Redis rate limit error: ${error.message}`);
        next();
      }
    }
  }
  return RedisRateLimitMiddleware;
}

/**
 * Lee un límite de intentos del env aceptando 0 como valor válido (cerrar el
 * endpoint) y cayendo al default sólo si falta, no es número o es negativo.
 */
function resolveMaxAttempts(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const RateLimitMiddleware = createRateLimitMiddleware({
  prefix: 'rl:general',
  windowSeconds: 15 * 60, // 15 minutes
  maxAttempts: 10,
  message: 'Too many requests from this IP, please try again later.',
  errorLabel: 'Too Many Requests',
});

export const LoginRateLimitMiddleware = createRateLimitMiddleware({
  prefix: 'rl:login',
  windowSeconds: 15 * 60, // 15 minutes
  // QUI-489 refactor: lee del env. Default 10 (production-safe). En dev el
  // docker-compose.yml lo sube a 30 sin tocar producción.
  //
  // `Number(x) || 10` no sirve acá: con LOGIN_RATE_LIMIT_MAX_ATTEMPTS=0 —la
  // forma intuitiva de cerrar el login— Number da 0, que es falsy, y cae al
  // default de 10, o sea justo lo contrario de lo pedido. Igual con NaN.
  maxAttempts: resolveMaxAttempts(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 10),
  message: 'Too many login attempts from this IP, please try again later.',
  errorLabel: 'Too Many Login Attempts',
});

export const RefreshRateLimitMiddleware = createRateLimitMiddleware({
  prefix: 'rl:refresh',
  windowSeconds: 5 * 60, // 5 minutes
  maxAttempts: 10,
  message:
    'Demasiados intentos de actualización de sesión desde tu dirección. Por favor, espera unos minutos antes de intentar nuevamente.',
  errorLabel: 'Demasiados Intentos de Actualización',
});
