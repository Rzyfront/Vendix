import { ExternalIdentityLookupService } from './external-identity-lookup.service';
import {
  ExternalIdentity,
  ExternalIdentitySourceId,
  SourceOutcome,
} from './external-identity.types';

const identity = (source: ExternalIdentitySourceId): ExternalIdentity => ({
  source,
  document_type: 'NIT',
  document_number: '900123456',
  verification_digit: '7',
  person_type: 'JURIDICA',
  legal_name: `NAME ${source}`,
  first_name: null,
  last_name: null,
  trade_name: null,
  registration_status: null,
  is_active: true,
  last_renewed_year: null,
  chamber: null,
  source_updated_at: null,
  source_detail: null,
});

describe('ExternalIdentityLookupService', () => {
  let redis: { get: jest.Mock; set: jest.Mock };
  let mocks: Record<ExternalIdentitySourceId, { id: string; lookup: jest.Mock }>;
  let service: ExternalIdentityLookupService;

  const mk = (id: ExternalIdentitySourceId) => ({
    id,
    lookup: jest.fn<Promise<SourceOutcome>, [string, AbortSignal]>().mockResolvedValue(null),
  });

  beforeEach(() => {
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    mocks = {
      rues: mk('rues'),
      secop_proveedores: mk('secop_proveedores'),
      secop_contratos: mk('secop_contratos'),
      rnt: mk('rnt'),
    };
    service = new ExternalIdentityLookupService(
      redis as never,
      mocks.rues as never,
      mocks.secop_proveedores as never,
      mocks.secop_contratos as never,
      mocks.rnt as never,
    );
  });

  it('prioridad: RUES y SECOP encuentran -> gana RUES, cache 24 h', async () => {
    mocks.rues.lookup.mockResolvedValue(identity('rues'));
    mocks.secop_proveedores.lookup.mockResolvedValue(identity('secop_proveedores'));
    mocks.rnt.lookup.mockResolvedValue(identity('rnt'));
    const res = await service.lookup('900123456');
    expect(res.identity?.source).toBe('rues');
    expect(redis.set).toHaveBeenCalledWith('ext-identity:lookup:900123456', JSON.stringify(res), 'EX', 86400);
  });

  it('orden de prioridad más allá de RUES: contratos gana a RNT', async () => {
    mocks.secop_contratos.lookup.mockResolvedValue(identity('secop_contratos'));
    mocks.rnt.lookup.mockResolvedValue(identity('rnt'));
    expect((await service.lookup('900123456')).identity?.source).toBe('secop_contratos');
  });

  it('RUES unavailable + SECOP encuentra -> found de SECOP', async () => {
    mocks.rues.lookup.mockResolvedValue('unavailable');
    mocks.secop_proveedores.lookup.mockResolvedValue(identity('secop_proveedores'));
    const res = await service.lookup('900123456');
    expect(res.found).toBe(true);
    expect(res.identity?.source).toBe('secop_proveedores');
    expect(res.unavailable).toBeUndefined();
  });

  it('todas null -> {found:false} cacheado 6 h', async () => {
    const res = await service.lookup('900123456');
    expect(res).toEqual({ found: false });
    expect(redis.set).toHaveBeenCalledWith('ext-identity:lookup:900123456', JSON.stringify({ found: false }), 'EX', 21600);
  });

  it('3 null + 1 unavailable -> unavailable, sin cache', async () => {
    mocks.rnt.lookup.mockResolvedValue('unavailable');
    expect(await service.lookup('900123456')).toEqual({ found: false, unavailable: true });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('una fuente que lanza cuenta como unavailable', async () => {
    mocks.rues.lookup.mockRejectedValue(new Error('boom'));
    expect(await service.lookup('900123456')).toEqual({ found: false, unavailable: true });
  });

  it('cache hit: no llama a las fuentes', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ found: false }));
    expect(await service.lookup('900123456')).toEqual({ found: false });
    expect(redis.get).toHaveBeenCalledWith('ext-identity:lookup:900123456');
    Object.values(mocks).forEach((m) => expect(m.lookup).not.toHaveBeenCalled());
  });

  it('error de Redis en lectura se ignora', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    expect(await service.lookup('900123456')).toEqual({ found: false });
  });

  it('paralelismo: las 4 fuentes arrancan antes de que alguna resuelva', async () => {
    const resolvers: Array<(v: SourceOutcome) => void> = [];
    Object.values(mocks).forEach((m) =>
      m.lookup.mockImplementation(() => new Promise<SourceOutcome>((r) => resolvers.push(r))),
    );
    const p = service.lookup('900123456');
    await new Promise((r) => setImmediate(r));
    Object.values(mocks).forEach((m) => expect(m.lookup).toHaveBeenCalledTimes(1));
    expect(resolvers).toHaveLength(4);
    resolvers.forEach((r) => r(null));
    expect(await p).toEqual({ found: false });
  });

  it('menos de 5 dígitos: no consulta', async () => {
    expect(await service.lookup('1234')).toEqual({ found: false });
    Object.values(mocks).forEach((m) => expect(m.lookup).not.toHaveBeenCalled());
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("canonicaliza '900.123.456-7' a '900123456'", async () => {
    await service.lookup('900.123.456-7');
    Object.values(mocks).forEach((m) =>
      expect(m.lookup).toHaveBeenCalledWith('900123456', expect.any(AbortSignal)),
    );
  });

  describe('resolución temprana', () => {
    const deferred = () => {
      let resolve!: (v: SourceOutcome) => void;
      const promise = new Promise<SourceOutcome>((r) => (resolve = r));
      return { promise, resolve };
    };
    const tick = () => new Promise((r) => setImmediate(r));

    it('RUES found: resuelve sin esperar a las demás y aborta la signal', async () => {
      mocks.rues.lookup.mockResolvedValue(identity('rues'));
      (['secop_proveedores', 'secop_contratos', 'rnt'] as const).forEach((k) =>
        mocks[k].lookup.mockImplementation(() => new Promise<SourceOutcome>(() => undefined)),
      );
      const res = await service.lookup('900123456');
      expect(res.identity?.source).toBe('rues');
      const signal = mocks.rnt.lookup.mock.calls[0][1] as AbortSignal;
      expect(signal.aborted).toBe(true);
    });

    it('SECOP found con RUES pendiente: espera a RUES; RUES null -> gana SECOP', async () => {
      const rues = deferred();
      mocks.rues.lookup.mockReturnValue(rues.promise);
      mocks.secop_proveedores.lookup.mockResolvedValue(identity('secop_proveedores'));
      let resolved = false;
      const p = service.lookup('900123456').then((r) => {
        resolved = true;
        return r;
      });
      await tick();
      expect(resolved).toBe(false);
      rues.resolve(null);
      const res = await p;
      expect(res.identity?.source).toBe('secop_proveedores');
    });

    it('RUES found llega después de SECOP found: gana rues', async () => {
      const rues = deferred();
      mocks.rues.lookup.mockReturnValue(rues.promise);
      mocks.secop_proveedores.lookup.mockResolvedValue(identity('secop_proveedores'));
      const p = service.lookup('900123456');
      await tick();
      rues.resolve(identity('rues'));
      expect((await p).identity?.source).toBe('rues');
    });
  });
});
