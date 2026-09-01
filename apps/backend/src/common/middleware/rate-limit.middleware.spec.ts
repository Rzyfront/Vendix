import type { NextFunction, Request, Response } from 'express';
import {
  LoginRateLimitMiddleware,
  RefreshRateLimitMiddleware,
} from './rate-limit.middleware';

/**
 * Redis de mentira con la superficie exacta que usa el middleware: MULTI con
 * INCR/EXPIRE encadenados y TTL suelto. Guarda los contadores en memoria para
 * que las aserciones puedan mirar QUÉ claves se tocaron — que es justo lo que
 * el apagón global demostró que nadie estaba mirando.
 */
class FakeRedis {
  readonly counts = new Map<string, number>();
  readonly ttls = new Map<string, number>();
  failNext = false;

  multi() {
    if (this.failNext) throw new Error('Redis caído');
    const ops: Array<() => [Error | null, unknown]> = [];
    const chain: any = {
      incr: (key: string) => {
        ops.push(() => {
          const next = (this.counts.get(key) ?? 0) + 1;
          this.counts.set(key, next);
          return [null, next];
        });
        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          this.ttls.set(key, seconds);
          return [null, 1];
        });
        return chain;
      },
      exec: async () => ops.map((op) => op()),
    };
    return chain;
  }

  async ttl(key: string) {
    return this.ttls.get(key) ?? -1;
  }
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as Response & { statusCode: number; body: any };
}

function makeReq(ip: string, body: Record<string, unknown> = {}) {
  return { ip, body, headers: {} } as unknown as Request;
}

const ENV_KEYS = [
  'LOGIN_RATE_LIMIT_MAX_ATTEMPTS',
  'LOGIN_RATE_LIMIT_MAX_PER_ACCOUNT',
  'REFRESH_RATE_LIMIT_MAX_ATTEMPTS',
  'REFRESH_RATE_LIMIT_MAX_PER_SESSION',
];

describe('rate limit por cubetas compuestas', () => {
  let redis: FakeRedis;
  let next: NextFunction & jest.Mock;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    redis = new FakeRedis();
    next = jest.fn() as any;
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  const login = () => new (LoginRateLimitMiddleware as any)(redis);
  const refresh = () => new (RefreshRateLimitMiddleware as any)(redis);

  describe('login', () => {
    it('consume una cubeta por IP y otra por cuenta, sin escribir el correo en claro', async () => {
      await login().use(
        makeReq('190.85.1.20', { email: 'rafael@vendix.com' }),
        makeRes(),
        next,
      );

      const keys = [...redis.counts.keys()];
      expect(keys).toHaveLength(2);
      expect(keys).toContain('rl:login:ip:190.85.1.20');
      expect(keys.some((k) => k.startsWith('rl:login:acct:'))).toBe(true);
      // Redis es texto plano: `KEYS rl:login:*` no debe ser un censo de correos.
      expect(keys.join('|')).not.toContain('rafael@vendix.com');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('bloquea por cuenta aunque la cubeta de IP tenga presupuesto de sobra', async () => {
      // Password spraying distribuido: mil IPs contra una cuenta. La cubeta de
      // IP nunca se llenaría; la de cuenta es la única que lo ve.
      process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = '1000';
      process.env.LOGIN_RATE_LIMIT_MAX_PER_ACCOUNT = '2';

      const attempt = (ip: string) =>
        login().use(makeReq(ip, { email: 'victima@vendix.com' }), makeRes(), next);

      await attempt('1.1.1.1');
      await attempt('2.2.2.2');
      const res = makeRes();
      await login().use(
        makeReq('3.3.3.3', { email: 'victima@vendix.com' }),
        res,
        next,
      );

      expect(res.statusCode).toBe(429);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('dos IPs distintas NO comparten cubeta', async () => {
      // Regresión directa del apagón: con `${prefix}:${req.ip}` y sin
      // `trust proxy`, estas dos peticiones caían en la misma clave.
      process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = '1';

      const first = makeRes();
      await login().use(makeReq('1.1.1.1', { email: 'a@b.com' }), first, next);
      const second = makeRes();
      await login().use(makeReq('2.2.2.2', { email: 'c@d.com' }), second, next);

      expect(first.statusCode).toBe(0);
      expect(second.statusCode).toBe(0);
      expect(next).toHaveBeenCalledTimes(2);
      expect(redis.counts.get('rl:login:ip:1.1.1.1')).toBe(1);
      expect(redis.counts.get('rl:login:ip:2.2.2.2')).toBe(1);
    });

    it('el cuerpo del 429 conserva el contrato que lee el modal del frontend', async () => {
      process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = '0';
      const res = makeRes();
      await login().use(makeReq('1.1.1.1', { email: 'a@b.com' }), res, next);

      expect(res.statusCode).toBe(429);
      expect(res.body).toEqual(
        expect.objectContaining({
          statusCode: 429,
          error: 'Too Many Login Attempts',
          retryAfter: 15 * 60,
        }),
      );
      expect(typeof res.body.message).toBe('string');
      expect(next).not.toHaveBeenCalled();
    });

    it('sólo cuenta la cubeta de IP cuando el body no trae correo', async () => {
      await login().use(makeReq('1.1.1.1', {}), makeRes(), next);
      expect([...redis.counts.keys()]).toEqual(['rl:login:ip:1.1.1.1']);
    });

    it('deja pasar si Redis falla (fail-open deliberado)', async () => {
      redis.failNext = true;
      const res = makeRes();
      await login().use(makeReq('1.1.1.1', { email: 'a@b.com' }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(0);
    });
  });

  describe('refresh', () => {
    it('dos sesiones distintas desde la MISMA IP no comparten presupuesto', async () => {
      // Ésta es la regresión exacta que apagaba la plataforma: diez
      // renovaciones legítimas agotaban la única cubeta y el frontend leía el
      // 429 como sesión muerta.
      process.env.REFRESH_RATE_LIMIT_MAX_PER_SESSION = '1';
      process.env.REFRESH_RATE_LIMIT_MAX_ATTEMPTS = '1000';

      const ip = '190.85.1.20';
      const a = makeRes();
      await refresh().use(makeReq(ip, { refresh_token: 'sesion-A' }), a, next);
      const b = makeRes();
      await refresh().use(makeReq(ip, { refresh_token: 'sesion-B' }), b, next);
      // La sesión A sí se frena a la segunda: su presupuesto es propio.
      const aAgain = makeRes();
      await refresh().use(
        makeReq(ip, { refresh_token: 'sesion-A' }),
        aAgain,
        next,
      );

      expect(a.statusCode).toBe(0);
      expect(b.statusCode).toBe(0);
      expect(aAgain.statusCode).toBe(429);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('la red por IP sigue frenando una inundación sin token', async () => {
      process.env.REFRESH_RATE_LIMIT_MAX_ATTEMPTS = '2';
      const ip = '9.9.9.9';
      await refresh().use(makeReq(ip, {}), makeRes(), next);
      await refresh().use(makeReq(ip, {}), makeRes(), next);
      const third = makeRes();
      await refresh().use(makeReq(ip, {}), third, next);

      expect(third.statusCode).toBe(429);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('fija el TTL sólo al crear la cubeta, no en cada petición', async () => {
      // Reponer el EXPIRE en cada petición convertiría la ventana fija en
      // deslizante y una cubeta bajo tráfico constante no vencería jamás.
      const ip = '8.8.8.8';
      await refresh().use(makeReq(ip, {}), makeRes(), next);
      expect(redis.ttls.get(`rl:refresh:ip:${ip}`)).toBe(5 * 60);

      redis.ttls.set(`rl:refresh:ip:${ip}`, 7);
      await refresh().use(makeReq(ip, {}), makeRes(), next);
      expect(redis.ttls.get(`rl:refresh:ip:${ip}`)).toBe(7);
    });
  });
});
