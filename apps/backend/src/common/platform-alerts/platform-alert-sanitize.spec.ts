import {
  fingerprintOf,
  normalizeUrlPath,
  routeKeyOf,
  sanitizeAlertDetails,
  sanitizeAlertText,
  summarizeError,
  tenantIdsOf,
} from './platform-alert-sanitize';

describe('platform-alert-sanitize (S7: sin contraseñas, tokens ni datos de clientes)', () => {
  it('oculta JWT, Bearer, credenciales clave=valor y JSON', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijklmnop';
    const text = sanitizeAlertText(
      `token ${jwt} Authorization: Bearer abc.def-123 password=Secreta1 {"api_key":"sk_live_1"} pin: 4455`,
    );
    expect(text).not.toContain(jwt);
    expect(text).not.toContain('abc.def-123');
    expect(text).not.toContain('Secreta1');
    expect(text).not.toContain('sk_live_1');
    expect(text).not.toContain('4455');
    expect(text).toContain('[token]');
    expect(text).toContain('[oculto]');
  });

  it('oculta correos, teléfonos, documentos y valores de query string', () => {
    const text = sanitizeAlertText(
      'cliente ana.perez@correo.com tel +57 300 123 4567 cc 1.020.304.050 url /x?doc=123&name=Ana',
    );
    expect(text).not.toMatch(/ana\.perez/);
    expect(text).not.toMatch(/300 123 4567/);
    expect(text).not.toMatch(/1\.020\.304\.050/);
    expect(text).not.toMatch(/doc=123|name=Ana/);
    expect(text).toContain('[correo]');
    expect(text).toContain('[número]');
  });

  it('deja números cortos (códigos HTTP, ids) y trunca al máximo', () => {
    expect(sanitizeAlertText('HTTP 503 en lote 12')).toBe('HTTP 503 en lote 12');
    const long = sanitizeAlertText('a'.repeat(900), 100);
    expect(long).toHaveLength(100);
    expect(long.endsWith('…')).toBe(true);
    expect(sanitizeAlertText(null)).toBe('');
  });

  it('summarizeError toma solo el motivo de los errores de Prisma (sin la consulta con valores)', () => {
    const error = new Error(
      'Invalid `prisma.orders.create()` invocation:\n{ data: { email: "x@y.com" } }\n\nUnique constraint failed on the fields: (`order_number`)',
    );
    const summary = summarizeError(error);
    expect(summary).toBe('Error: Unique constraint failed on the fields: (`order_number`)');
    expect(summarizeError(new TypeError('boom\nat stack'))).toBe('TypeError: boom');
  });

  it('details: saneados, sin vacíos, números y booleanos tal cual', () => {
    expect(
      sanitizeAlertDetails({ Correo: 'a@b.co', Intentos: 3, Pausa: false, Vacío: '', Nada: null }),
    ).toEqual({ Correo: '[correo]', Intentos: 3, Pausa: false });
  });

  it('tenantIdsOf solo toma ids numéricos positivos del data del job', () => {
    expect(tenantIdsOf({ store_id: '7', organizationId: 3, email: 'x@y.co' })).toEqual({
      organizationId: 3,
      storeId: 7,
    });
    expect(tenantIdsOf({ store_id: 'abc' })).toEqual({ organizationId: null, storeId: null });
    expect(tenantIdsOf(null)).toEqual({ organizationId: null, storeId: null });
  });

  it('routeKeyOf usa el patrón de Express; si no hay, normaliza ids, UUIDs y tokens', () => {
    expect(routeKeyOf({ baseUrl: '/api', route: { path: '/store/orders/:id' } })).toBe(
      '/api/store/orders/:id',
    );
    expect(
      normalizeUrlPath(
        '/api/store/orders/123/x/0b8e7b1c-1d2e-4f5a-9b8c-7d6e5f4a3b2c/abcdef1234567890abcdef12?email=a@b.co',
      ),
    ).toBe('/api/store/orders/:id/x/:uuid/:token');
  });

  it('fingerprintOf es estable y de 64 caracteres', () => {
    expect(fingerprintOf('http|GET /x|HTTP_500')).toHaveLength(64);
    expect(fingerprintOf('a')).toBe(fingerprintOf('a'));
    expect(fingerprintOf('a')).not.toBe(fingerprintOf('b'));
  });
});
