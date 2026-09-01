import {
  bucketHash,
  extractClientIp,
  extractClientIpOptional,
  resolveTrustProxySetting,
  createTrustProxyPredicate,
} from './client-ip.util';

// Sin tipos publicados (no hay @types/proxy-addr); require evita el error de
// TS por declaraciones faltantes. Es la MISMA librería que usa Express
// internamente para resolver `req.ip` (node_modules/express/lib/request.js).
const proxyaddr = require('proxy-addr');

describe('extractClientIp', () => {
  it('devuelve req.ip tal cual cuando ya es una IPv4', () => {
    expect(extractClientIp({ ip: '190.85.1.20' } as any)).toBe('190.85.1.20');
  });

  it('desenvuelve la forma IPv4 mapeada a IPv6 del socket dual-stack', () => {
    // Sin esto, el mismo cliente ocuparía dos cubetas distintas según por dónde
    // entrase, y el límite efectivo sería el doble del declarado.
    expect(extractClientIp({ ip: '::ffff:190.85.1.20' } as any)).toBe(
      '190.85.1.20',
    );
  });

  it('IGNORA x-forwarded-for aunque venga en la petición', () => {
    // Ésta es la propiedad de seguridad del módulo: la cabecera la escribe el
    // cliente. Si se leyera, bastaría rotarla en cada petición para estrenar
    // cubeta de rate limit y evadir el límite por completo — y para envenenar
    // el registro de auditoría con IPs inventadas. Express ya deja el valor
    // confiable en `req.ip` según `trust proxy`.
    const ip = extractClientIp({
      ip: '190.85.1.20',
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    } as any);
    expect(ip).toBe('190.85.1.20');
    expect(ip).not.toBe('1.2.3.4');
  });

  it('cae al socket cuando no hay req.ip', () => {
    expect(
      extractClientIp({ socket: { remoteAddress: '10.0.0.7' } } as any),
    ).toBe('10.0.0.7');
  });

  it('recorta el puerto de una IPv4 pero respeta una IPv6', () => {
    expect(extractClientIp({ ip: '190.85.1.20:51314' } as any)).toBe(
      '190.85.1.20',
    );
    expect(extractClientIp({ ip: '2001:db8::1' } as any)).toBe('2001:db8::1');
  });

  it('devuelve "unknown" cuando no hay nada que leer', () => {
    expect(extractClientIp(undefined)).toBe('unknown');
    expect(extractClientIp({} as any)).toBe('unknown');
    expect(extractClientIp({ ip: '   ' } as any)).toBe('unknown');
  });

  it('extractClientIpOptional devuelve undefined en vez de "unknown"', () => {
    expect(extractClientIpOptional({} as any)).toBeUndefined();
    expect(extractClientIpOptional({ ip: '190.85.1.20' } as any)).toBe(
      '190.85.1.20',
    );
  });
});

describe('resolveTrustProxySetting', () => {
  it('vale 1 por defecto (navegador -> nginx -> backend)', () => {
    expect(resolveTrustProxySetting(undefined)).toBe(1);
    expect(resolveTrustProxySetting('')).toBe(1);
    expect(resolveTrustProxySetting('   ')).toBe(1);
  });

  it('acepta el número de saltos declarado', () => {
    expect(resolveTrustProxySetting('2')).toBe(2);
    expect(resolveTrustProxySetting('0')).toBe(0);
  });

  it('NUNCA devuelve true ni un valor no entero', () => {
    // `trust proxy: true` haría que Express tome el primer elemento de
    // X-Forwarded-For — el que escribe el cliente — y todos los límites por IP
    // pasarían a ser falsificables. Una variable de entorno mal escrita no
    // puede abrir ese agujero por accidente.
    for (const raw of ['true', 'yes', 'loopback', '-1', '1.5', 'abc']) {
      const value = resolveTrustProxySetting(raw);
      expect(typeof value).toBe('number');
      expect(value).toBe(1);
    }
  });
});

describe('bucketHash', () => {
  it('es estable y no filtra el valor original', () => {
    const email = 'rafael@vendix.com';
    const hash = bucketHash(email);
    expect(hash).toBe(bucketHash(email));
    expect(hash).not.toContain('rafael');
    expect(hash).not.toContain('@');
    expect(hash).toHaveLength(32);
  });

  it('normaliza mayúsculas y espacios para no partir la cubeta', () => {
    // Si `Rafael@Vendix.com` y `rafael@vendix.com` cayeran en cubetas
    // distintas, la fuerza bruta contra una cuenta tendría tantos presupuestos
    // como combinaciones de mayúsculas del correo.
    expect(bucketHash('  Rafael@Vendix.com ')).toBe(
      bucketHash('rafael@vendix.com'),
    );
  });

  it('separa valores distintos', () => {
    expect(bucketHash('a@b.com')).not.toBe(bucketHash('c@d.com'));
  });
});

describe('createTrustProxyPredicate', () => {
  /**
   * Arma la request mínima que `proxy-addr` necesita para reproducir EXACTAMENTE
   * lo que hace Express al resolver `req.ip`: lee `req.socket.remoteAddress`
   * (ver `node_modules/forwarded/index.js`, que `proxy-addr` usa por dentro) y
   * `req.headers['x-forwarded-for']`. `proxyaddr(req, trustFn)` es la MISMA
   * llamada que hace el getter `ip` de Express
   * (`node_modules/express/lib/request.js`), así que esto ejercita el
   * comportamiento real de resolución, no una reformulación de la fórmula del
   * predicado con otras palabras.
   */
  function resolveIp(peer: string, xff: string | undefined, hops: number): string {
    const req = {
      socket: { remoteAddress: peer },
      headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    };
    return proxyaddr(req as any, createTrustProxyPredicate(hops));
  }

  it('cadena legítima de producción (hops=2): resuelve al cliente detrás de nginx + CloudFront', () => {
    // Protege la topología real de prod: navegador -> CloudFront -> nginx -> backend.
    // Si esto se rompe, `req.ip` deja de ser el cliente y el rate-limit/auditoría
    // por IP colapsan a la IP de CloudFront para todo el tráfico.
    const ip = resolveIp('172.18.0.5', '190.85.1.20, 130.176.4.10', 2);
    expect(ip).toBe('190.85.1.20');
  });

  it('cadena legítima de dev (hops=1): resuelve al cliente detrás de nginx', () => {
    // Topología de dev: navegador -> nginx -> backend. hops=1 es el default de
    // `resolveTrustProxySetting`, así que este es el caso que corre sin .env.
    const ip = resolveIp('172.18.0.1', '190.85.1.20', 1);
    expect(ip).toBe('190.85.1.20');
  });

  it('golpe directo al puerto 3000 con X-Forwarded-For falsificado: ignora la cabecera y resuelve al atacante real', () => {
    // ESTE es el bug que este predicado cierra. El security group de EC2 abre
    // :3000 a 0.0.0.0/0, así que cualquiera le pega directo al backend
    // saltándose nginx/CloudFront. Con `trust proxy: N` pelado, esa conexión
    // directa cuenta como "salto de confianza" y Express se cree el XFF que
    // traiga: cualquiera estrena cubeta de rate limit en cada petición.
    // Reproducido en local: `curl -H 'X-Forwarded-For: 6.6.6.6'
    // http://localhost:3000/api/health` -> `client_ip: 6.6.6.6` antes del fix.
    const ip = resolveIp('45.33.100.7', '6.6.6.6', 2);
    expect(ip).toBe('45.33.100.7');
    expect(ip).not.toBe('6.6.6.6');
  });

  it('golpe directo sin X-Forwarded-For: resuelve al peer', () => {
    // Caso base sin cabecera: no hay nada que falsificar, así que debe resolver
    // siempre a la IP del socket que abrió la conexión.
    const ip = resolveIp('45.33.100.7', undefined, 2);
    expect(ip).toBe('45.33.100.7');
  });

  it.each([
    ['10.0.0.7', '10.0.0.0/8'],
    ['192.168.1.5', '192.168.0.0/16'],
    ['127.0.0.1', '127.0.0.0/8 (loopback IPv4)'],
    ['::1', 'loopback IPv6'],
  ])('trata %s (%s) como salto propio y camina la cadena hasta el XFF', (peer) => {
    // Estos son los rangos donde de verdad puede vivir nuestro nginx (red
    // Docker, LAN, loopback si comparte host). Si alguno dejara de reconocerse
    // como privado, la topología legítima de ese entorno quedaría bloqueada
    // como si fuera un ataque -- regresión de disponibilidad, no de seguridad.
    const ip = resolveIp(peer, '8.8.8.8', 1);
    expect(ip).toBe('8.8.8.8');
  });

  it('NO trata 172.32.0.1 como privado (fuera de 172.16.0.0/12) y bloquea la cadena', () => {
    // 172.16.0.0/12 cubre sólo 172.16.x - 172.31.x. Un desliz aquí (ej.
    // comparar sólo el primer octeto) reabriría el mismo agujero que el bug
    // original: una IP pública en ese rango vecino pasaría como si fuera la
    // red Docker y su X-Forwarded-For se creería a ciegas.
    const ip = resolveIp('172.32.0.1', '8.8.8.8', 1);
    expect(ip).toBe('172.32.0.1');
  });

  it('con hops=1 la cadena NO se camina más allá del conteo declarado: sólo se descarta un salto', () => {
    // Si la topología real tiene más saltos que los declarados en
    // TRUST_PROXY_HOPS, Express se detiene exactamente donde le dijimos y
    // `req.ip` cae en un proxy nuestro (degradado: varios clientes comparten
    // cubeta) en vez de en el cliente real -- nunca al revés. Es el corolario
    // del docblock de `createTrustProxyPredicate`: "si el número se queda
    // corto... nunca falsificable".
    const ip = resolveIp('172.18.0.1', '190.85.1.20, 130.176.4.10', 1);
    expect(ip).toBe('130.176.4.10');
    expect(ip).not.toBe('190.85.1.20');
  });
});
