import { ProfileCatalogCacheService, CatalogEntry } from './profile-catalog-cache.service';

/**
 * CACHÉ DEL CATÁLOGO — lo que hay que probar es el comportamiento ante el fallo.
 *
 * Las sondas en vivo cubrieron el camino feliz, la invalidación y las dos formas
 * de caché envenenada (forma ajena y JSON roto). Lo que NO se puede provocar con
 * `redis-cli` es Redis caído: pararlo tira las colas BullMQ de todo el stack
 * compartido, y este árbol de trabajo lo comparten otras sesiones. Acá el fallo
 * se inyecta: un cliente cuyos `get`/`set`/`del` rechazan.
 *
 * La propiedad que se afirma es una sola y es la que importa: **la caché nunca
 * puede ser la causa de que el endpoint falle.** Sirve más lento y correcto.
 */
describe('ProfileCatalogCacheService', () => {
  const ENTRIES: CatalogEntry[] = [
    { id: 9, name: 'Estándar DIAN', operation_type: '10', is_default: true, current_version: 1 },
    { id: 8, name: 'AIU', operation_type: '09', is_default: false, current_version: 3 },
  ];

  function make(redis: Partial<Record<'get' | 'set' | 'del', jest.Mock>>) {
    const client = {
      get: redis.get ?? jest.fn().mockResolvedValue(null),
      set: redis.set ?? jest.fn().mockResolvedValue('OK'),
      del: redis.del ?? jest.fn().mockResolvedValue(1),
    };
    return { service: new ProfileCatalogCacheService(client as any), client };
  }

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  // ─── Redis caído ───────────────────────────────────────────────────────

  it('read devuelve null si Redis rechaza, en vez de propagar', async () => {
    const { service } = make({ get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    await expect(service.read(10)).resolves.toBeNull();
  });

  it('write no lanza si Redis rechaza', async () => {
    const { service } = make({ set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    await expect(service.write(10, ENTRIES)).resolves.toBeUndefined();
  });

  it('invalidate no lanza si Redis rechaza — el commit ya ocurrió', async () => {
    const { service } = make({ del: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    // Si lanzara, una escritura ya confirmada en base terminaría en un 500 y el
    // usuario creería que su cambio no se guardó.
    await expect(service.invalidate(10)).resolves.toBeUndefined();
  });

  // ─── Caché envenenada ──────────────────────────────────────────────────

  it('descarta un JSON válido cuya FORMA no es la esperada', async () => {
    const { service } = make({
      get: jest.fn().mockResolvedValue(JSON.stringify([{ id: 'no soy número' }])),
    });
    // Confiar en ella devolvería `undefined` en cada campo al frontend.
    await expect(service.read(10)).resolves.toBeNull();
  });

  it('descarta un objeto donde se esperaba un array', async () => {
    const { service } = make({ get: jest.fn().mockResolvedValue('{"id":9}') });
    await expect(service.read(10)).resolves.toBeNull();
  });

  it('descarta JSON corrupto', async () => {
    const { service } = make({ get: jest.fn().mockResolvedValue('{no es json') });
    await expect(service.read(10)).resolves.toBeNull();
  });

  it('descarta un array con una entrada incompleta, no sólo con una mal tipada', async () => {
    const { service } = make({
      get: jest.fn().mockResolvedValue(JSON.stringify([ENTRIES[0], { id: 8, name: 'x' }])),
    });
    await expect(service.read(10)).resolves.toBeNull();
  });

  it('devuelve el catálogo cuando la forma es correcta', async () => {
    const { service } = make({ get: jest.fn().mockResolvedValue(JSON.stringify(ENTRIES)) });
    await expect(service.read(10)).resolves.toEqual(ENTRIES);
  });

  // ─── La clave ──────────────────────────────────────────────────────────

  it('la clave lleva el store_id y el prefijo del dominio', async () => {
    const { service, client } = make({});
    await service.write(10, ENTRIES);
    expect(client.set).toHaveBeenCalledWith(
      'inv:profiles:catalog:10',
      JSON.stringify(ENTRIES),
      'EX',
      30,
    );
  });

  it('el TTL es finito y explícito', async () => {
    const { service, client } = make({});
    await service.write(7, []);
    const [, , flag, ttl] = client.set.mock.calls[0];
    expect(flag).toBe('EX');
    expect(typeof ttl).toBe('number');
    expect(ttl).toBeGreaterThan(0);
  });

  it('dos tiendas usan claves distintas', async () => {
    const { service, client } = make({});
    await service.write(10, ENTRIES);
    await service.write(11, ENTRIES);
    const keys = client.set.mock.calls.map((c: any[]) => c[0]);
    expect(new Set(keys).size).toBe(2);
  });

  it.each([0, -1, 1.5, NaN, undefined, null, 'diez'])(
    'un store_id inválido (%p) no llega a formar una clave',
    async (bad) => {
      const { service, client } = make({});
      // `inv:profiles:catalog:undefined` es una clave válida para Redis, y la
      // compartirían todos los tenants a los que les faltara el contexto.
      await expect(service.read(bad as any)).rejects.toThrow(/store_id inválido/);
      await expect(service.write(bad as any, ENTRIES)).rejects.toThrow(/store_id inválido/);
      expect(client.get).not.toHaveBeenCalled();
      expect(client.set).not.toHaveBeenCalled();
    },
  );

  it('invalidate con un store_id inválido tampoco borra nada NI lanza', async () => {
    const { service, client } = make({});
    // No lanza porque corre después de un commit: ver el docblock. Pero tampoco
    // puede emitir un `del` sobre una clave inventada.
    await expect(service.invalidate(undefined as any)).resolves.toBeUndefined();
    expect(client.del).not.toHaveBeenCalled();
  });
});
