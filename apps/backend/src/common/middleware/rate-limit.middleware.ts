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
import { bucketHash, extractClientIp } from '../utils/client-ip.util';

/**
 * Una cubeta independiente de conteo. Cada petición puede consumir varias a la
 * vez (p. ej. login consume la de su IP y la de su cuenta) y basta que UNA se
 * pase para responder 429.
 */
interface RateLimitBucket {
  /** Clave completa en Redis, discriminante incluido. */
  key: string;
  maxAttempts: number;
  windowSeconds: number;
}

interface RateLimitConfig {
  prefix: string;
  message: string;
  errorLabel: string;
  /**
   * Deriva las cubetas que consume esta petición. Devolver `[]` deja pasar sin
   * contar (caso legítimo: no hay con qué discriminar).
   */
  buckets: (req: Request) => RateLimitBucket[];
}

/**
 * Rate limit por cubetas compuestas sobre Redis.
 *
 * ## El fallo que corrige
 *
 * La versión anterior llaveaba `${prefix}:${req.ip}`. Como Express no tenía
 * `trust proxy`, `req.ip` era la IP de nginx / la gateway de Docker para TODAS
 * las peticiones del planeta, así que existía UNA sola cubeta por endpoint y
 * el límite era global, no por cliente. El desenlace en producción era un
 * apagón en cadena: diez renovaciones de sesión legítimas agotaban
 * `rl:refresh`, el interceptor del frontend leía el 429 como sesión muerta y
 * echaba a todo el mundo, la avalancha de logins agotaba `rl:login`, y la
 * plataforma entera quedaba con el modal de bloqueo por quince minutos.
 *
 * El arreglo son dos piezas inseparables: `trust proxy` en `main.ts` (para que
 * `req.ip` sea real) y las cubetas compuestas de acá.
 *
 * ## Por qué varias cubetas y no una
 *
 * Una sola clave obliga a elegir entre dos objetivos incompatibles. Llavear
 * sólo por IP castiga a la oficina con NAT —veinte personas tras una IP
 * pública comparten el presupuesto de una— y no frena el password spraying,
 * que prueba una contraseña contra mil cuentas desde mil IPs. Llavear sólo por
 * cuenta deja la puerta abierta a barrer cuentas a ciegas.
 *
 * Así que se llavean ambos ejes con umbrales distintos: la cubeta de cuenta es
 * estrecha y hace el trabajo de seguridad (frenar fuerza bruta contra un
 * usuario), la de IP es ancha y sólo actúa como red anti-inundación.
 */
export function createRateLimitMiddleware(
  config: RateLimitConfig,
): Type<NestMiddleware> {
  @Injectable()
  class RedisRateLimitMiddleware implements NestMiddleware {
    private readonly logger = new Logger(`RateLimit:${config.prefix}`);

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    async use(req: Request, res: Response, next: NextFunction) {
      const buckets = config.buckets(req);
      if (buckets.length === 0) return next();

      try {
        // Un solo round trip para los N INCR. El EXPIRE va aparte porque sólo
        // corresponde a las cubetas recién creadas: reponerlo en cada petición
        // convertiría la ventana fija en deslizante y una cubeta bajo tráfico
        // constante no vencería nunca.
        const pipeline = this.redis.multi();
        for (const bucket of buckets) pipeline.incr(bucket.key);
        const results = await pipeline.exec();

        let blocked: RateLimitBucket | undefined;
        const expires = this.redis.multi();
        let hasExpires = false;

        for (let index = 0; index < buckets.length; index++) {
          const entry = results?.[index];
          // `entry[0]` es el error de ESE comando dentro del MULTI. Un fallo
          // suelto (p. ej. la clave quedó con un tipo raro) no debe bloquear:
          // se ignora esa cubeta y se sigue con las demás.
          if (!entry || entry[0]) continue;
          const bucket = buckets[index];
          const current = Number(entry[1]);
          if (current === 1) {
            expires.expire(bucket.key, bucket.windowSeconds);
            hasExpires = true;
          }
          if (current > bucket.maxAttempts && !blocked) {
            blocked = bucket;
          }
        }

        if (hasExpires) await expires.exec();
        if (!blocked) return next();

        const ttl = await this.redis.ttl(blocked.key);
        this.logger.warn(
          `Límite superado en la cubeta ${blocked.key} (max ${blocked.maxAttempts}/${blocked.windowSeconds}s)`,
        );

        // Forma del cuerpo congelada por contrato con el frontend: el modal
        // `rate-limit-lock-modal` cuenta atrás con `retryAfter` y
        // `normalizeApiPayload` (core/utils/api-error-handler.ts) sólo lo
        // propaga si viene como número en la raíz.
        return res.status(429).json({
          statusCode: 429,
          message: config.message,
          error: config.errorLabel,
          retryAfter: ttl > 0 ? ttl : blocked.windowSeconds,
        });
      } catch (error) {
        // Fail-open deliberado: Redis caído no debe tumbar el login.
        this.logger.warn(`Redis rate limit error: ${error.message}`);
        return next();
      }
    }
  }
  return RedisRateLimitMiddleware;
}

/**
 * Lee un límite de intentos del env aceptando 0 como valor válido (cerrar el
 * endpoint) y cayendo al default sólo si falta, no es número o es negativo.
 */
function resolveMaxAttempts(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const FIFTEEN_MINUTES = 15 * 60;
const FIVE_MINUTES = 5 * 60;

/** Lee un campo de texto del body sin confiar en que el body exista o sea objeto. */
function readBodyField(req: Request, field: string): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  const value = body?.[field];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export const RateLimitMiddleware = createRateLimitMiddleware({
  prefix: 'rl:general',
  message: 'Too many requests from this IP, please try again later.',
  errorLabel: 'Too Many Requests',
  buckets: (req) => [
    {
      key: `rl:general:ip:${extractClientIp(req)}`,
      // Cubre registro y recuperación de contraseña. El 10 anterior era el
      // presupuesto de TODA la plataforma; ahora es por IP real, y 10 se queda
      // corto para una oficina con NAT registrando clientes.
      maxAttempts: resolveMaxAttempts(
        process.env.GENERAL_RATE_LIMIT_MAX_ATTEMPTS,
        20,
      ),
      windowSeconds: FIFTEEN_MINUTES,
    },
  ],
});

export const LoginRateLimitMiddleware = createRateLimitMiddleware({
  prefix: 'rl:login',
  message: 'Too many login attempts from this IP, please try again later.',
  errorLabel: 'Too Many Login Attempts',
  buckets: (req) => {
    const list: RateLimitBucket[] = [
      {
        key: `rl:login:ip:${extractClientIp(req)}`,
        // QUI-489 fijó este env en 10 cuando la cubeta era global. Ahora es
        // por IP real y cumple otro papel —red anti-inundación de red, no
        // freno de fuerza bruta contra una cuenta— así que el default sube: 10
        // por IP echaría a la calle a cualquier oficina con NAT. El freno de
        // fuerza bruta lo hace la cubeta por cuenta de abajo.
        maxAttempts: resolveMaxAttempts(
          process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
          50,
        ),
        windowSeconds: FIFTEEN_MINUTES,
      },
    ];

    const email = readBodyField(req, 'email');
    if (email) {
      list.push({
        // Hash: el correo es PII y Redis es texto plano para cualquiera con
        // acceso al contenedor. `KEYS rl:login:*` no debe ser un censo de
        // usuarios.
        key: `rl:login:acct:${bucketHash(email)}`,
        // Ésta es la cubeta que de verdad frena la fuerza bruta, y la única
        // que sigue el password spraying distribuido: mil IPs contra una
        // cuenta comparten esta clave.
        maxAttempts: resolveMaxAttempts(
          process.env.LOGIN_RATE_LIMIT_MAX_PER_ACCOUNT,
          10,
        ),
        windowSeconds: FIFTEEN_MINUTES,
      });
    }

    return list;
  },
});

export const RefreshRateLimitMiddleware = createRateLimitMiddleware({
  prefix: 'rl:refresh',
  message:
    'Demasiados intentos de actualización de sesión desde tu dirección. Por favor, espera unos minutos antes de intentar nuevamente.',
  errorLabel: 'Demasiados Intentos de Actualización',
  buckets: (req) => {
    const list: RateLimitBucket[] = [
      {
        key: `rl:refresh:ip:${extractClientIp(req)}`,
        // Red ancha: una IP corporativa puede tener cien pestañas abiertas
        // renovando en paralelo de forma perfectamente legítima.
        maxAttempts: resolveMaxAttempts(
          process.env.REFRESH_RATE_LIMIT_MAX_ATTEMPTS,
          300,
        ),
        windowSeconds: FIVE_MINUTES,
      },
    ];

    const refreshToken = readBodyField(req, 'refresh_token');
    if (refreshToken) {
      list.push({
        // Presupuesto propio por sesión: es la unidad correcta, porque el
        // abuso que este endpoint teme es una sesión girando en bucle, no un
        // conjunto de sesiones sanas coincidiendo en el tiempo.
        key: `rl:refresh:sess:${bucketHash(refreshToken)}`,
        maxAttempts: resolveMaxAttempts(
          process.env.REFRESH_RATE_LIMIT_MAX_PER_SESSION,
          60,
        ),
        windowSeconds: FIVE_MINUTES,
      });
    }

    return list;
  },
});
