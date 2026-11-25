import {
  fingerprintOf,
  normalizeUrlPath,
  routeKeyOf,
  alertIdentityFromRequest,
  safeRouteParams,
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

  it('details: un UUID (id de petición) se conserva para buscarlo en los logs', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const out = sanitizeAlertDetails({ 'Petición (id)': id, Otro: 'tel 3001234567' });
    expect(out['Petición (id)']).toBe(id);
    expect(out.Otro).toBe('tel [número]');
  });

  it('safeRouteParams solo deja ids, slugs y paginación con valor numérico o UUID', () => {
    expect(
      safeRouteParams({ orderId: '987', invoiceId: 45, file: 'abc123.ics', code: 'PROMO1', handle: 'h_x' }),
    ).toEqual({ orderId: '987', invoiceId: '45' });
    expect(safeRouteParams({ page: '2', limit: 20, slug: 'mi-tienda' })).toEqual({
      page: '2',
      limit: '20',
      slug: 'mi-tienda',
    });
    // Claves que suenan a secreto o llevan token con forma de slug: fuera.
    expect(safeRouteParams({ file: 'abc123.ics', code: 'PROMO1', handle: 'h_x' })).toBeNull();
    expect(safeRouteParams({})).toBeNull();
    expect(safeRouteParams(null)).toBeNull();
  });

  it('acepta claves en camelCase terminadas en Id', () => {
    expect(safeRouteParams({ shippingMethodId: 12, mappingId: '9' })).toEqual({
      shippingMethodId: '12',
      mappingId: '9',
    });
  });

  it('safeRouteParams descarta ids que son credenciales de sesión o acceso', () => {
    expect(safeRouteParams({ sessionId: '3f1e1a9e-7f0c-4a1d-9f7e-1b2c3d4e5f60' })).toBeNull();
    expect(safeRouteParams({ publicId: '3f1e1a9e-7f0c-4a1d-9f7e-1b2c3d4e5f60' })).toBeNull();
  });

  it('alertIdentityFromRequest usa req.user y cae al dominio público sin usuario', () => {
    expect(
      alertIdentityFromRequest({
        user: { id: 7, organization_id: 82, store_id: 105 },
        domain_context: { store_id: 999, organization_id: 111 },
      }),
    ).toEqual({ organizationId: 82, storeId: 105, userId: 7 });

    expect(
      alertIdentityFromRequest({ domain_context: { store_id: 105, organization_id: 82 } }),
    ).toEqual({ organizationId: 82, storeId: 105, userId: null });
  });

  it('alertIdentityFromRequest no mezcla usuario y dominio de tenants distintos', () => {
    // Un admin de organización sin tienda no debe heredar la tienda del dominio.
    expect(
      alertIdentityFromRequest({
        user: { id: 7, organization_id: 82 },
        domain_context: { store_id: 105, organization_id: 111 },
      }),
    ).toEqual({ organizationId: 82, storeId: null, userId: 7 });
  });

  it('alertIdentityFromRequest descarta ids raros', () => {
    expect(
      alertIdentityFromRequest({
        user: { id: '7abc', store_id: -1, organization_id: 1.5 },
        domain_context: { store_id: '82abc' },
      }),
    ).toEqual({ organizationId: null, storeId: null, userId: null });
  });

  it('tenantIdsOf solo toma ids numéricos positivos del data del job', () => {
    expect(tenantIdsOf({ store_id: '7', organizationId: 3, email: 'x@y.co' })).toEqual({
      organizationId: 3,
      storeId: 7,
    });
    expect(tenantIdsOf({ store_id: 'abc' })).toEqual({ organizationId: null, storeId: null });
    expect(tenantIdsOf(null)).toEqual({ organizationId: null, storeId: null });
  });

  it('tenantIdsOf también lee los ids anidados en data.context (QUI-1031); el nivel superior gana', () => {
    expect(tenantIdsOf({ context: { store_id: 105, organization_id: 82 } })).toEqual({
      organizationId: 82,
      storeId: 105,
    });
    expect(tenantIdsOf({ store_id: 1, context: { store_id: 2 } }).storeId).toBe(1);
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
