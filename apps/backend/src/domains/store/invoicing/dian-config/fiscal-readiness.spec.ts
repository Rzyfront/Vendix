import { DianConfigService } from './dian-config.service';
import { FiscalProductionReadinessService } from '../providers/fiscal-production-readiness.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  DIAN_CONFIGURATION_TYPES,
  documentTypesFor,
} from '../fiscal-document-requirements';

/**
 * Estado fiscal agregado por entidad (`GET .../dian-config/fiscal-readiness`).
 *
 * Lo que estos tests protegen, en una frase: UN EJE SIN CONFIGURACIÓN EXISTE.
 * Antes de este endpoint, preguntar por el estado exigía un `configId`, así que
 * las habilitaciones que nadie había creado —documento soporte, nómina,
 * documento equivalente— no podían aparecer en ninguna respuesta. Y un eje que
 * no aparece no se lee como «te falta»: se lee como «no aplica». Ese es el
 * motivo por el que el documento soporte llevaba meses invisible.
 */
describe('DianConfigService.getFiscalReadiness', () => {
  /** Clave técnica de mentira, pero tratada como la de verdad: NO puede salir. */
  const CLTEC_SECRETA = 'CLTEC-QUE-NUNCA-DEBE-VIAJAR-9f3a';

  const configRow = (overrides: Record<string, any> = {}) => ({
    id: 41,
    organization_id: 7,
    store_id: 12,
    accounting_entity_id: 77,
    configuration_type: 'invoicing',
    operation_mode: 'own_software',
    environment: 'test',
    enablement_status: 'testing',
    software_id: 'sw-1',
    software_pin_encrypted: 'pin-cifrado',
    certificate_s3_key: 'certs/tenant.p12',
    certificate_password_encrypted: 'pass-cifrada',
    certificate_kms_key_id: null,
    certificate_expiry: new Date('2099-01-01T00:00:00Z'),
    certificate_fingerprint: 'huella',
    certificate_nit: '900123456',
    enablement_evidence: { track_id: 'track-1' },
    test_set_id: 'set-1',
    last_test_result: { success: true },
    nit: '900123456',
    nit_dv: '1',
    ...overrides,
  });

  const resolutionRow = (overrides: Record<string, any> = {}) => ({
    id: 501,
    document_type: 'sales_invoice',
    prefix: 'FE',
    range_from: 1,
    range_to: 1000,
    current_number: 10,
    valid_from: new Date('2020-01-01T00:00:00Z'),
    valid_to: new Date('2099-01-01T00:00:00Z'),
    is_active: true,
    technical_key: CLTEC_SECRETA,
    ...overrides,
  });

  const build = (options: {
    configs?: any[];
    resolutions?: any[];
    fiscal_scope?: string;
  }) => {
    const client = {
      dian_configurations: {
        findMany: jest.fn().mockResolvedValue(options.configs ?? []),
      },
      invoice_resolutions: {
        findMany: jest.fn().mockResolvedValue(options.resolutions ?? []),
        // Sonda de clave técnica compartida: sin ClTec propia el hallazgo es
        // `null` — COMPROBADO Y LIMPIO, que es distinto de no comprobar.
        findFirst: jest.fn().mockResolvedValue({
          id: 501,
          technical_key: null,
          accounting_entity: { tax_id: '900123456' },
        }),
      },
    };
    const prisma = { withoutScope: () => client } as any;
    const encryption = {
      isUsingFallbackKey: () => false,
      needsReencryption: () => false,
    } as any;
    // Servicio de readiness REAL: si se mockeara, el test afirmaría que la UI
    // recibe un checklist sin comprobar que sea EL checklist que bloquea la
    // emisión, que es justo la divergencia que el diseño evita.
    const readiness = new FiscalProductionReadinessService(prisma, encryption);
    const fiscalScope = {
      requireFiscalScope: jest
        .fn()
        .mockResolvedValue(options.fiscal_scope ?? 'STORE'),
    } as any;
    const service = new DianConfigService(
      prisma,
      encryption,
      fiscalScope,
      readiness,
    );
    return { service, client, readiness, fiscalScope };
  };

  const run = (service: DianConfigService) =>
    RequestContextService.run(
      {
        user_id: 3,
        organization_id: 7,
        store_id: 12,
        is_super_admin: false,
        is_owner: true,
      },
      () => service.getFiscalReadiness(),
    );

  // (a) —————————————————————————————————————————————————————————————————————
  it('devuelve los 4 ejes con config_id null cuando la tienda no tiene ninguna configuración', async () => {
    const { service } = build({ configs: [] });

    const result = await run(service);

    expect(result.axes).toHaveLength(DIAN_CONFIGURATION_TYPES.length);
    expect(result.axes.map((a) => a.configuration_type)).toEqual([
      ...DIAN_CONFIGURATION_TYPES,
    ]);
    for (const axis of result.axes) {
      expect(axis.config_id).toBeNull();
      // El eje EXISTE y está sin empezar. No es lo mismo que no aparecer.
      expect(axis.enablement_status).toBe('not_started');
      expect(axis.environment).toBeNull();
      expect(axis.readiness).toBeNull();
      expect(axis.resolutions).toEqual([]);
      // Rótulo en español derivado del contrato, nunca vacío: es lo que la
      // pantalla imprime cuando no hay nada más que mostrar.
      expect(axis.label).toBeTruthy();
    }
  });

  it('sigue declarando los ejes sin configurar cuando otro eje sí está configurado', async () => {
    // La regresión concreta: con solo la habilitación de facturación creada, el
    // documento soporte desaparecía de la respuesta y el comerciante concluía
    // que no le aplicaba.
    const { service } = build({ configs: [configRow()] });

    const result = await run(service);

    const soporte = result.axes.find(
      (a) => a.configuration_type === 'support_document',
    );
    expect(soporte).toBeDefined();
    expect(soporte!.config_id).toBeNull();
    expect(soporte!.enablement_status).toBe('not_started');
    expect(result.axes.map((a) => a.configuration_type)).toEqual([
      ...DIAN_CONFIGURATION_TYPES,
    ]);
  });

  // (b) —————————————————————————————————————————————————————————————————————
  it('nunca serializa la clave técnica: solo informa technical_key_set', async () => {
    const { service } = build({
      configs: [configRow()],
      resolutions: [resolutionRow()],
    });

    const result = await run(service);

    const facturacion = result.axes.find(
      (a) => a.configuration_type === 'invoicing',
    )!;
    const resolucion = facturacion.resolutions[0];

    expect(resolucion.technical_key_set).toBe(true);
    // La propiedad se ELIMINA, no se enmascara: `in` lo comprueba de verdad,
    // mientras que leerla y compararla con undefined pasaría igual si viajara
    // como null.
    expect('technical_key' in resolucion).toBe(false);
    // Y el valor no aparece por ninguna otra vía (un spread olvidado en otro
    // nivel del árbol, por ejemplo).
    expect(JSON.stringify(result)).not.toContain(CLTEC_SECRETA);
  });

  it('reporta technical_key_set false cuando el rango no tiene clave', async () => {
    const { service } = build({
      configs: [configRow()],
      resolutions: [resolutionRow({ technical_key: null })],
    });

    const result = await run(service);

    const facturacion = result.axes.find(
      (a) => a.configuration_type === 'invoicing',
    )!;
    expect(facturacion.resolutions[0].technical_key_set).toBe(false);
    expect('technical_key' in facturacion.resolutions[0]).toBe(false);
  });

  // (c) —————————————————————————————————————————————————————————————————————
  it('el eje configurado trae el checklist real, no vacío', async () => {
    const { service } = build({
      configs: [configRow()],
      resolutions: [resolutionRow()],
    });

    const result = await run(service);

    const facturacion = result.axes.find(
      (a) => a.configuration_type === 'invoicing',
    )!;
    expect(facturacion.config_id).toBe(41);
    expect(facturacion.readiness).not.toBeNull();
    expect(facturacion.readiness!.checks.length).toBeGreaterThan(0);
    // Viene del evaluador compartido con el gate de emisión, así que sus claves
    // son las mismas que bloquean facturar.
    expect(facturacion.readiness!.checks.map((c) => c.key)).toContain(
      'certificate_expiry',
    );
    // Estado REAL en el eje, aunque el checklist se evalúe como si ya estuviera
    // promovido: si el eje dijera «production/enabled» la UI anunciaría una
    // habilitación que no existe.
    expect(facturacion.environment).toBe('test');
    expect(facturacion.enablement_status).toBe('testing');
  });

  it('resuelve shared_technical_key y lo pasa como dato comprobado (null, no undefined)', async () => {
    const { service, readiness } = build({
      configs: [configRow()],
      resolutions: [resolutionRow()],
    });
    const spy = jest.spyOn(readiness, 'evaluateProductionReadiness');

    await run(service);

    const arg = spy.mock.calls[0][0];
    // `null` = comprobado y limpio. `undefined` = no comprobado, y la
    // comprobación fallaría EN ABIERTO afirmando que la clave está sana.
    expect(arg.shared_technical_key).toBeNull();
    expect('shared_technical_key' in arg).toBe(true);
    // Y los dos campos cuya ausencia haría que `resolveTestSetProof` cayera al
    // último lote y leyera «no pasó» sobre una habilitación ya concedida.
    expect(arg.enablement_evidence).toEqual({ track_id: 'track-1' });
    expect(arg.last_test_result).toEqual({ success: true });
    const checkClave = spy.mock.results[0].value.checks.find(
      (c: any) => c.key === 'technical_key_per_nit',
    );
    expect(checkClave.satisfied).toBe(true);
  });

  it('pide las resoluciones de TODOS los documentos del eje, no solo del principal', async () => {
    const { service, client } = build({
      configs: [configRow()],
      resolutions: [resolutionRow()],
    });

    await run(service);

    const facturacion = client.invoice_resolutions.findMany.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.document_type?.in?.includes('sales_invoice'),
    );
    expect(facturacion).toBeDefined();
    // Del contrato, no de una lista escrita a mano aquí: la habilitación de
    // facturación cubre también las notas, y omitirlas escondería justamente el
    // rango que falta.
    expect(facturacion![0].where.document_type.in).toEqual(
      documentTypesFor('invoicing'),
    );
    // Filtro de tenant explícito: `withoutScope()` no aplica ninguno.
    expect(facturacion![0].where.accounting_entity_id).toBe(77);
    expect(facturacion![0].where.organization_id).toBe(7);
  });

  // Aislamiento entre tiendas ————————————————————————————————————————————————
  it('acota por store_id con fiscal_scope=STORE y por organización con ORGANIZATION', async () => {
    const porTienda = build({ configs: [], fiscal_scope: 'STORE' });
    await run(porTienda.service);
    expect(
      porTienda.client.dian_configurations.findMany.mock.calls[0][0].where,
    ).toEqual({ store_id: 12 });

    const porOrganizacion = build({ configs: [], fiscal_scope: 'ORGANIZATION' });
    const resultado = await run(porOrganizacion.service);
    // `store_id: null` es parte del predicado, no un descuido: la configuración
    // de una organización fiscal única NO cuelga de ninguna tienda, y omitirlo
    // mostraría la habilitación de una tienda hermana.
    expect(
      porOrganizacion.client.dian_configurations.findMany.mock.calls[0][0].where,
    ).toEqual({ organization_id: 7, store_id: null });
    expect(resultado.fiscal_scope).toBe('ORGANIZATION');
  });
});
