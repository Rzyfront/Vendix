import {
  bucketHash,
  extractClientIp,
  extractClientIpOptional,
  resolveTrustProxySetting,
} from './client-ip.util';

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
