import { InvoicingService } from './invoicing.service';

/**
 * `validate-draft` tiene que dar EL MISMO veredicto que daría «Crear factura»,
 * y el generador de numeración no se limita a buscar una resolución: para los
 * tipos con serie interna (`NAS`, `NAE`) la abre o la reactiva él mismo. Si la
 * previsualización sólo mirara `invoice_resolutions`, la primera nota de ajuste
 * de una tienda saldría de «Validar» con un bloqueante que la emisión real no
 * tiene — el usuario leería «falta resolución» de un documento que sí se emite.
 *
 * Se prueba `peekResolutionForDraft` directamente y con la instancia armada por
 * prototipo: el único colaborador que este camino toca es Prisma, y pasar por
 * el constructor de 11 dependencias ataría la prueba a cambios que no le
 * incumben (fue así como un `TS2554` tumbó una suite entera sin aparecer en el
 * conteo de `Tests:`).
 */
describe('InvoicingService.peekResolutionForDraft — serie interna proyectada', () => {
  const buildService = (findFirst: jest.Mock) => {
    const service = Object.create(
      InvoicingService.prototype,
    ) as InvoicingService;
    (service as any).prisma = {
      withoutScope: () => ({ invoice_resolutions: { findFirst } }),
    };
    return service;
  };

  const peek = (service: InvoicingService, ...args: any[]) =>
    (service as any).peekResolutionForDraft(...args);

  it('proyecta la serie interna que el generador abriría para una nota de ajuste sin resolución', async () => {
    // Ninguna consulta encuentra fila: ni la vigente ni la dormida.
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = buildService(findFirst);

    const result = await peek(service, 77, 'support_adjustment_note');

    expect(result.resolution).not.toBeNull();
    expect(result.resolution).toMatchObject({
      // Sin fila todavía: anunciar un id apuntaría un diagnóstico a una
      // resolución ajena.
      id: null,
      resolution_number: 'INTERNA-NAS',
      prefix: 'NAS',
      range_from: 1,
      range_to: 1000,
      current_number: 0,
      is_active: true,
    });
    expect(result.projected_number).toBe('NAS1');
    // El CUDE de estas notas se firma con el Software-PIN; inventarles una
    // ClTec haría que el prevalidador juzgara una clave que la emisión no usa.
    expect(result.resolution_secret).toEqual({
      technical_key: null,
      technical_key_encrypted: null,
    });
  });

  it('proyecta la nota de ajuste de documento equivalente con su propio prefijo', async () => {
    const service = buildService(jest.fn().mockResolvedValue(null));

    const result = await peek(service, 77, 'equivalent_adjustment_note');

    expect(result.resolution).toMatchObject({
      resolution_number: 'INTERNA-NAE',
      prefix: 'NAE',
    });
    expect(result.projected_number).toBe('NAE1');
  });

  it('reactiva la serie dormida CONSERVANDO su cursor, no reabriéndola en el inicio del rango', async () => {
    const dormant = {
      id: 41,
      resolution_number: 'INTERNA-NAS',
      prefix: 'NAS',
      range_from: 1,
      range_to: 1000,
      current_number: 37,
      valid_from: new Date('2020-01-01'),
      valid_to: new Date('2021-01-01'),
      is_active: false,
      technical_key: null,
      technical_key_encrypted: null,
    };
    // 1.ª llamada: la búsqueda de resolución VIGENTE, que no la encuentra
    // porque está inactiva y vencida. 2.ª: la búsqueda de la dormida.
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dormant);
    const service = buildService(findFirst);

    const result = await peek(service, 77, 'support_adjustment_note');

    expect(result.resolution).toMatchObject({
      id: 41,
      current_number: 37,
      is_active: true,
    });
    // Reabrirla en `NAS1` reemitiría 37 consecutivos ya usados.
    expect(result.projected_number).toBe('NAS38');
    // La vigencia se proyecta renovada, que es lo que el generador escribiría.
    expect(result.resolution.valid_to.getTime()).toBeGreaterThan(Date.now());
  });

  it('NO inventa serie para un tipo cuyo rango autoriza la DIAN', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = buildService(findFirst);

    const result = await peek(service, 77, 'sales_invoice');

    // `RESOLUTION_MISSING` es la respuesta honesta: ese rango se pide en MUISCA.
    expect(result.resolution).toBeNull();
    expect(result.projected_number).toBe('');
    expect(result.resolution_secret).toBeNull();
    // Y no se malgasta la consulta de la serie dormida.
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('NO fabrica serie cuando el DTO nombró una resolución que no apareció', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = buildService(findFirst);

    const result = await peek(service, 77, 'support_adjustment_note', 512);

    // El problema es ESA fila —borrada, inactiva o vencida—, no la ausencia de
    // serie: `provisionInternalSeries` se niega igual.
    expect(result.resolution).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
