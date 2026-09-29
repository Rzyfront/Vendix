import { computeNitDv } from '@common/utils/nit.util';
import { SocrataClient } from './socrata.client';
import { RuesSource } from './rues.source';
import { SecopProveedoresSource } from './secop-proveedores.source';
import { SecopContratosSource } from './secop-contratos.source';
import { RntSource } from './rnt.source';

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const httpResponse = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

describe('SocrataClient', () => {
  let client: SocrataClient;
  let fetchSpy: jest.SpyInstance;
  const q = { where: "nit='1'", select: 'a,b', limit: 3 };
  const signal = new AbortController().signal;

  beforeEach(() => {
    client = new SocrataClient();
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.SOCRATA_APP_TOKEN;
  });

  it('200 con arreglo: devuelve filas y arma la URL', async () => {
    fetchSpy.mockResolvedValue(okResponse([{ a: 1 }]));
    expect(await client.fetchRows('abcd-1234', { ...q, order: 'a DESC' }, signal)).toEqual([{ a: 1 }]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('https://www.datos.gov.co/resource/abcd-1234.json');
    expect(url).toContain(encodeURIComponent("nit='1'"));
    expect(url).toContain('$limit=3');
    expect(url).toContain(`$order=${encodeURIComponent('a DESC')}`);
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('5xx persistente: 3 llamadas y null', async () => {
    fetchSpy.mockResolvedValue(httpResponse(503));
    expect(await client.fetchRows('d', q, signal)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('503 -> 500 -> 200: devuelve filas', async () => {
    fetchSpy
      .mockResolvedValueOnce(httpResponse(503))
      .mockResolvedValueOnce(httpResponse(500))
      .mockResolvedValueOnce(okResponse([{ x: 1 }]));
    expect(await client.fetchRows('d', q, signal)).toEqual([{ x: 1 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('4xx: 1 llamada y null', async () => {
    fetchSpy.mockResolvedValue(httpResponse(400));
    expect(await client.fetchRows('d', q, signal)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('abort: null', async () => {
    fetchSpy.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(await client.fetchRows('d', q, signal)).toBeNull();
  });

  it('cuerpo que no es arreglo: null', async () => {
    fetchSpy.mockResolvedValue(okResponse({ error: true }));
    expect(await client.fetchRows('d', q, signal)).toBeNull();
  });

  it('json lanza: null', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad');
      },
    } as unknown as Response);
    expect(await client.fetchRows('d', q, signal)).toBeNull();
  });

  it('X-App-Token sólo si SOCRATA_APP_TOKEN está definido', async () => {
    process.env.SOCRATA_APP_TOKEN = 'tok123';
    fetchSpy.mockResolvedValue(okResponse([]));
    await client.fetchRows('d', q, signal);
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({
      Accept: 'application/json',
      'X-App-Token': 'tok123',
    });
  });
});

describe('RuesSource', () => {
  let source: RuesSource;
  let fetchSpy: jest.SpyInstance;
  const signal = new AbortController().signal;

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
    source = new RuesSource(new SocrataClient());
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('NIT activo: persona jurídica con DV calculado', async () => {
    fetchSpy.mockResolvedValue(okResponse([nitRow()]));
    const res = await source.lookup('900123456', signal);
    expect(res).toEqual({
      source: 'rues',
      document_type: 'NIT',
      document_number: '900123456',
      verification_digit: computeNitDv('900123456'),
      person_type: 'JURIDICA',
      legal_name: 'TECH SOLUTIONS SAS',
      first_name: null,
      last_name: null,
      trade_name: null,
      registration_status: 'ACTIVA',
      is_active: true,
      last_renewed_year: 2026,
      chamber: 'BOGOTA',
      source_updated_at: '2026/04/29 18:20:37.610000000',
      source_detail: null,
    });
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain(encodeURIComponent(`nit='900123456' OR numero_identificacion='900123456'`));
    expect(url).toContain('$limit=20');
  });

  it('varias filas: la ACTIVA gana a la CANCELADA aunque sea más antigua', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([
        nitRow({ estado_matricula: 'CANCELADA', razon_social: 'NOMBRE VIEJO', fecha_actualizacion: '2026/09/01 00:00:00.000000000' }),
        nitRow({ estado_matricula: 'ACTIVA', razon_social: 'NOMBRE ACTIVO', fecha_actualizacion: '2020/01/01 00:00:00.000000000' }),
      ]),
    );
    const res = (await source.lookup('900123456', signal)) as any;
    expect(res.legal_name).toBe('NOMBRE ACTIVO');
    expect(res.is_active).toBe(true);
  });

  it('entre dos ACTIVAS gana la actualización más reciente', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([
        nitRow({ razon_social: 'A', fecha_actualizacion: '2020/01/01 00:00:00.000000000' }),
        nitRow({ razon_social: 'B', fecha_actualizacion: '2025/01/01 00:00:00.000000000' }),
      ]),
    );
    expect(((await source.lookup('900123456', signal)) as any).legal_name).toBe('B');
  });

  it('sólo cancelada: is_active false', async () => {
    fetchSpy.mockResolvedValue(okResponse([nitRow({ estado_matricula: 'CANCELADA' })]));
    const res = (await source.lookup('900123456', signal)) as any;
    expect(res.is_active).toBe(false);
    expect(res.registration_status).toBe('CANCELADA');
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
    const res = (await source.lookup('7174354', signal)) as any;
    expect(res).toMatchObject({
      document_type: 'CC',
      document_number: '7174354',
      verification_digit: null,
      person_type: 'NATURAL',
      first_name: 'YEHISON ANDRES',
      last_name: 'ABELLO RODRIGUEZ',
      legal_name: null,
      last_renewed_year: 2021,
    });
    expect(res.dv_mismatch).toBeUndefined();
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
    expect(await source.lookup('24560913', signal)).toMatchObject({
      person_type: 'NATURAL',
      first_name: null,
      last_name: null,
      legal_name: 'RAMIREZ DE OSPINA MARIA',
    });
  });

  it('no encontrado: null', async () => {
    fetchSpy.mockResolvedValue(okResponse([]));
    expect(await source.lookup('11111', signal)).toBeNull();
  });

  it('timeout/abort: unavailable', async () => {
    fetchSpy.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(await source.lookup('900123456', signal)).toBe('unavailable');
  });

  it('HTTP 5xx persistente: unavailable tras 3 intentos', async () => {
    fetchSpy.mockResolvedValue(httpResponse(503));
    expect(await source.lookup('900123456', signal)).toBe('unavailable');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('5xx transitorio: reintenta y resuelve con el 200 siguiente', async () => {
    fetchSpy
      .mockResolvedValueOnce(httpResponse(503))
      .mockResolvedValueOnce(httpResponse(500))
      .mockResolvedValueOnce(okResponse([nitRow()]));
    expect(((await source.lookup('900123456', signal)) as any).legal_name).toBe('TECH SOLUTIONS SAS');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('4xx no se reintenta', async () => {
    fetchSpy.mockResolvedValue(httpResponse(400));
    expect(await source.lookup('900123456', signal)).toBe('unavailable');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('JSON malformado (lanza o no es arreglo): unavailable', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Response);
    expect(await source.lookup('900123456', signal)).toBe('unavailable');
    fetchSpy.mockResolvedValueOnce(okResponse({ error: true }));
    expect(await source.lookup('900123456', signal)).toBe('unavailable');
  });

  it('DV discrepante: prevalece el calculado y marca dv_mismatch', async () => {
    const computed = computeNitDv('900123456');
    const wrong = computed === '9' ? '8' : '9';
    fetchSpy.mockResolvedValue(okResponse([nitRow({ digito_verificacion: wrong })]));
    const res = (await source.lookup('900123456', signal)) as any;
    expect(res.verification_digit).toBe(computed);
    expect(res.dv_mismatch).toBe(true);
  });
});

describe('SecopProveedoresSource', () => {
  let source: SecopProveedoresSource;
  let fetchSpy: jest.SpyInstance;
  const signal = new AbortController().signal;

  beforeEach(() => {
    source = new SecopProveedoresSource(new SocrataClient());
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('persona natural: CC, nombre completo en legal_name, sin nombres separados', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([{ nombre: 'Patricia  Realpe Urbano', nit: '37060176', tipo_empresa: 'PERSONA NATURAL COLOMBIANA', esta_activa: 'Si', fecha_creacion: '2020-01-01T00:00:00.000' }]),
    );
    const res = await source.lookup('37060176', signal);
    expect(res).toMatchObject({
      source: 'secop_proveedores',
      document_type: 'CC',
      person_type: 'NATURAL',
      legal_name: 'PATRICIA REALPE URBANO',
      first_name: null,
      last_name: null,
      verification_digit: null,
      registration_status: 'ACTIVO',
      is_active: true,
      trade_name: null,
      source_detail: null,
    });
  });

  it('persona jurídica: NIT con DV; prefiere la fila activa', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([
        { nombre: 'INACTIVA SAS', tipo_empresa: 'SAS', esta_activa: 'No' },
        { nombre: 'ACTIVA SAS', tipo_empresa: 'SAS', esta_activa: 'Si' },
      ]),
    );
    const res = await source.lookup('900123456', signal);
    expect(res).toMatchObject({
      document_type: 'NIT',
      person_type: 'JURIDICA',
      legal_name: 'ACTIVA SAS',
      verification_digit: computeNitDv('900123456'),
    });
  });

  it('inactiva: INACTIVO / is_active false', async () => {
    fetchSpy.mockResolvedValue(okResponse([{ nombre: 'X SAS', tipo_empresa: 'SAS', esta_activa: 'No' }]));
    expect(await source.lookup('900123456', signal)).toMatchObject({ registration_status: 'INACTIVO', is_active: false });
  });

  it('[] -> null', async () => {
    fetchSpy.mockResolvedValue(okResponse([]));
    expect(await source.lookup('37060176', signal)).toBeNull();
  });

  it('cliente null -> unavailable', async () => {
    fetchSpy.mockResolvedValue(httpResponse(400));
    expect(await source.lookup('37060176', signal)).toBe('unavailable');
  });

  it('la consulta nunca pide telefono ni correo', async () => {
    fetchSpy.mockResolvedValue(okResponse([]));
    await source.lookup('37060176', signal);
    const url = decodeURIComponent(fetchSpy.mock.calls[0][0]).toLowerCase();
    expect(url).not.toContain('telefono');
    expect(url).not.toContain('correo');
  });
});

describe('SecopContratosSource', () => {
  let source: SecopContratosSource;
  let fetchSpy: jest.SpyInstance;
  const signal = new AbortController().signal;
  const row = (over: Record<string, string> = {}) => ({
    nom_raz_social_contratista: 'Bancolombia  S.A.',
    tipo_documento_proveedor: 'No Definido',
    documento_proveedor: '890903938',
    fecha_de_firma_del_contrato: '2024-05-17T00:00:00.000',
    ...over,
  });

  beforeEach(() => {
    source = new SecopContratosSource(new SocrataClient());
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it("'No Definido' con 890903938 -> NIT JURIDICA con DV", async () => {
    fetchSpy.mockResolvedValue(okResponse([row()]));
    const res = await source.lookup('890903938', signal);
    expect(res).toMatchObject({
      source: 'secop_contratos',
      document_type: 'NIT',
      person_type: 'JURIDICA',
      verification_digit: computeNitDv('890903938'),
      legal_name: 'BANCOLOMBIA S.A.',
      is_active: true,
      registration_status: null,
      source_detail: 'Último contrato: 2024-05-17',
    });
    const url = decodeURIComponent(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('$order=fecha_de_firma_del_contrato DESC');
    expect(url).toContain('$limit=1');
  });

  it("'No Definido' con 37060176 -> CC NATURAL", async () => {
    fetchSpy.mockResolvedValue(okResponse([row({ documento_proveedor: '37060176' })]));
    expect(await source.lookup('37060176', signal)).toMatchObject({
      document_type: 'CC',
      person_type: 'NATURAL',
      verification_digit: null,
    });
  });

  it('tipos explícitos, sin importar mayúsculas ni tildes', async () => {
    fetchSpy.mockResolvedValue(okResponse([row({ tipo_documento_proveedor: 'CÉDULA DE EXTRANJERÍA' })]));
    expect(await source.lookup('123456789', signal)).toMatchObject({ document_type: 'CE', person_type: 'NATURAL' });
    fetchSpy.mockResolvedValue(okResponse([row({ tipo_documento_proveedor: 'Cédula de Ciudadanía' })]));
    expect(await source.lookup('123456789', signal)).toMatchObject({ document_type: 'CC', person_type: 'NATURAL' });
    fetchSpy.mockResolvedValue(okResponse([row({ tipo_documento_proveedor: 'Nit de Persona Jurídica' })]));
    expect(await source.lookup('123456789', signal)).toMatchObject({ document_type: 'NIT', person_type: 'JURIDICA' });
  });

  it('[] -> null', async () => {
    fetchSpy.mockResolvedValue(okResponse([]));
    expect(await source.lookup('37060176', signal)).toBeNull();
  });

  it('cliente null -> unavailable', async () => {
    fetchSpy.mockRejectedValue(new Error('net'));
    expect(await source.lookup('37060176', signal)).toBe('unavailable');
  });
});

describe('RntSource', () => {
  let source: RntSource;
  let fetchSpy: jest.SpyInstance;
  const signal = new AbortController().signal;

  beforeEach(() => {
    source = new RntSource(new SocrataClient());
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('19116195 -> trade_name HOTEL MAITAMA, sin nombre de titular', async () => {
    fetchSpy.mockResolvedValue(
      okResponse([{ razon_social_establecimiento: 'HOTEL MAITAMA', nit: '19116195', categoria: 'HOTEL', estado_rnt: 'ACTIVO', ano: '2019' }]),
    );
    const res = await source.lookup('19116195', signal);
    expect(res).toMatchObject({
      source: 'rnt',
      document_type: 'CC',
      person_type: 'NATURAL',
      trade_name: 'HOTEL MAITAMA',
      legal_name: null,
      first_name: null,
      last_name: null,
      registration_status: 'ACTIVO',
      is_active: true,
      source_detail: 'HOTEL · corte 2019',
    });
  });

  it('NIT de 9 dígitos: JURIDICA con DV', async () => {
    fetchSpy.mockResolvedValue(okResponse([{ razon_social_establecimiento: 'BCD TRAVEL', categoria: 'AGENCIA', estado_rnt: 'ACTIVO', ano: '2019' }]));
    expect(await source.lookup('800078692', signal)).toMatchObject({
      document_type: 'NIT',
      person_type: 'JURIDICA',
      verification_digit: computeNitDv('800078692'),
      legal_name: null,
    });
  });

  it('[] -> null', async () => {
    fetchSpy.mockResolvedValue(okResponse([]));
    expect(await source.lookup('19116195', signal)).toBeNull();
  });

  it('cliente null -> unavailable', async () => {
    fetchSpy.mockResolvedValue(httpResponse(400));
    expect(await source.lookup('19116195', signal)).toBe('unavailable');
  });
});
