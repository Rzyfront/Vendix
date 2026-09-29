import { RuesLookupService } from './rues-lookup.service';
import { computeNitDv } from '@common/utils/nit.util';

describe('RuesLookupService', () => {
  let service: RuesLookupService;
  let redis: { get: jest.Mock; set: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  const nitRow = (over: Record<string, string> = {}) => ({
    codigo_clase_identificacion: '02',
    clase_identificacion: 'NIT',
    numero_identificacion: '900123456',
    digito_verificacion: computeNitDv('900123456'),
    razon_social: 'TECH SOLUTIONS SAS',
    organizacion_juridica: 'SOCIEDADES POR ACCIONES SIMPLIFICADAS SAS',
    estado_matricula: 'ACTIVA',
    ultimo_ano_renovado: '2026',
    camara_comercio: 'BOGOTA',
    fecha_actualizacion: '2026/04/29 18:20:37.610000000',
    ...over,
  });

  beforeEach(() => {
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    service = new RuesLookupService(redis as never);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.SOCRATA_APP_TOKEN;
  });

  it('NIT activo: persona jurídica con DV calculado y cache de 24 h', async () => {
    fetchSpy.mockResolvedValue(okResponse([nitRow()]));

    const res = await service.lookup('900.123.456');

    expect(res).toEqual({
      found: true,
      identity: {
        source: 'rues',
        document_type: 'NIT',
        document_number: '900123456',
        verification_digit: computeNitDv('900123456'),
        person_type: 'JURIDICA',
        legal_name: 'TECH SOLUTIONS SAS',
        first_name: null,
        last_name: null,
        registration_status: 'ACTIVA',
        is_active: true,
        last_renewed_year: 2026,
        chamber: 'BOGOTA',
        source_updated_at: '2026/04/29 18:20:37.610000000',
      },
    });
    expect(redis.set).toHaveBeenCalledWith(
      'rues:lookup:900123456',
      JSON.stringify(res),
      'EX',
      86400,
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain(
      encodeURIComponent(
        `nit='900123456' OR numero_identificacion='900123456'`,
      ),
    );
    expect(url).toContain('$limit=20');
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('envía X-App-Token si SOCRATA_APP_TOKEN está definido', async () => {
    process.env.SOCRATA_APP_TOKEN = 'tok123';
    fetchSpy.mockResolvedValue(okResponse([]));
    await service.lookup('900123456');
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({
      Accept: 'application/json',
      'X-App-Token': 'tok123',
    });
  });

  it('varias filas: la ACTIVA gana a la CANCELADA aunque sea más antigua', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([
        nitRow({
          estado_matricula: 'CANCELADA',
          razon_social: 'NOMBRE VIEJO',
          fecha_actualizacion: '2026/09/01 00:00:00.000000000',
        }),
        nitRow({
          estado_matricula: 'ACTIVA',
          razon_social: 'NOMBRE ACTIVO',
          fecha_actualizacion: '2020/01/01 00:00:00.000000000',
        }),
      ]),
    );
    const res = await service.lookup('900123456');
    expect(res.identity?.legal_name).toBe('NOMBRE ACTIVO');
    expect(res.identity?.is_active).toBe(true);
  });

  it('entre dos ACTIVAS gana la actualización más reciente', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([
        nitRow({
          razon_social: 'A',
          fecha_actualizacion: '2020/01/01 00:00:00.000000000',
        }),
        nitRow({
          razon_social: 'B',
          fecha_actualizacion: '2025/01/01 00:00:00.000000000',
        }),
      ]),
    );
    expect((await service.lookup('900123456')).identity?.legal_name).toBe('B');
  });

  it('sólo cancelada: found con is_active false', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([nitRow({ estado_matricula: 'CANCELADA' })]),
    );
    const res = await service.lookup('900123456');
    expect(res.found).toBe(true);
    expect(res.identity?.is_active).toBe(false);
    expect(res.identity?.registration_status).toBe('CANCELADA');
  });

  it('CC persona natural: nombres y apellidos, sin DV', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([
        {
          codigo_clase_identificacion: '01',
          clase_identificacion: 'CEDULA DE CIUDADANIA',
          numero_identificacion: '7174354',
          nit: '7174354',
          digito_verificacion: '4',
          razon_social: 'YEHISON ANDRES ABELLO RODRIGUEZ',
          primer_nombre: 'YEHISON',
          segundo_nombre: 'ANDRES',
          primer_apellido: 'ABELLO',
          segundo_apellido: 'RODRIGUEZ',
          organizacion_juridica: 'PERSONA NATURAL',
          estado_matricula: 'ACTIVA',
          ultimo_ano_renovado: '2021',
          camara_comercio: 'BOGOTA',
        },
      ]),
    );
    const res = await service.lookup('7174354');
    expect(res.identity).toMatchObject({
      document_type: 'CC',
      document_number: '7174354',
      verification_digit: null,
      person_type: 'NATURAL',
      first_name: 'YEHISON ANDRES',
      last_name: 'ABELLO RODRIGUEZ',
      legal_name: null,
      last_renewed_year: 2021,
    });
    expect(res.identity?.dv_mismatch).toBeUndefined();
  });

  it('persona natural sin nombres separados: usa razon_social como legal_name', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([
        {
          codigo_clase_identificacion: '01',
          numero_identificacion: '24560913',
          razon_social: 'RAMIREZ DE OSPINA MARIA',
          organizacion_juridica: 'PERSONA NATURAL',
          estado_matricula: 'CANCELADA',
        },
      ]),
    );
    const res = await service.lookup('24560913');
    expect(res.identity).toMatchObject({
      person_type: 'NATURAL',
      first_name: null,
      last_name: null,
      legal_name: 'RAMIREZ DE OSPINA MARIA',
    });
  });

  it('no encontrado: cachea 6 h', async () => {
    fetchSpy.mockResolvedValue(okResponse([]));
    const res = await service.lookup('11111');
    expect(res).toEqual({ found: false });
    expect(redis.set).toHaveBeenCalledWith(
      'rues:lookup:11111',
      JSON.stringify({ found: false }),
      'EX',
      21600,
    );
  });

  it('timeout/abort: unavailable y NO cachea', async () => {
    fetchSpy.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const res = await service.lookup('900123456');
    expect(res).toEqual({ found: false, unavailable: true });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('HTTP no OK: unavailable y NO cachea', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);
    const res = await service.lookup('900123456');
    expect(res).toEqual({ found: false, unavailable: true });
    expect(redis.set).not.toHaveBeenCalled();
    // 1 intento + 2 reintentos ante 5xx persistente.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('5xx transitorio: reintenta y resuelve con el 200 siguiente', async () => {
    const unavailable = { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    fetchSpy
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce({ ...unavailable, status: 500 } as Response)
      .mockResolvedValueOnce(okResponse([nitRow()]));
    const res = await service.lookup('900123456');
    expect(res.found).toBe(true);
    expect(res.identity?.legal_name).toBe('TECH SOLUTIONS SAS');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('4xx no se reintenta', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) } as unknown as Response);
    const res = await service.lookup('900123456');
    expect(res).toEqual({ found: false, unavailable: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('JSON malformado (lanza o no es arreglo): unavailable y NO cachea', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Response);
    expect(await service.lookup('900123456')).toEqual({
      found: false,
      unavailable: true,
    });

    fetchSpy.mockResolvedValueOnce(okResponse({ error: true }));
    expect(await service.lookup('900123456')).toEqual({
      found: false,
      unavailable: true,
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('DV discrepante: prevalece el calculado y marca dv_mismatch', async () => {
    const computed = computeNitDv('900123456');
    const wrong = computed === '9' ? '8' : '9';
    fetchSpy.mockResolvedValue(
      okResponse([nitRow({ digito_verificacion: wrong })]),
    );
    const res = await service.lookup('900123456');
    expect(res.identity?.verification_digit).toBe(computed);
    expect(res.identity?.dv_mismatch).toBe(true);
  });

  it('NIT con DV en la entrada se canonicaliza al número', async () => {
    fetchSpy.mockResolvedValue(okResponse([]));
    await service.lookup('900.123.456-7');
    expect(fetchSpy.mock.calls[0][0]).toContain(
      encodeURIComponent(
        `nit='900123456' OR numero_identificacion='900123456'`,
      ),
    );
  });

  it('menos de 5 dígitos: no consulta', async () => {
    expect(await service.lookup('1234')).toEqual({ found: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cache hit: no llama a fetch', async () => {
    const cached = { found: false };
    redis.get.mockResolvedValue(JSON.stringify(cached));
    expect(await service.lookup('900123456')).toEqual(cached);
    expect(redis.get).toHaveBeenCalledWith('rues:lookup:900123456');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
