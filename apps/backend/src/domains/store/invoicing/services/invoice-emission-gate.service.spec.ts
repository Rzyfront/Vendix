import { InvoiceEmissionGateService } from './invoice-emission-gate.service';

/**
 * La compuerta pertenece al acto de NUMERAR, no al tipo de documento.
 *
 * Estas pruebas fijan las tres conductas que hacen que sea segura reutilizarla
 * desde el carril de notas de crédito:
 *   1. área inactiva ⇒ `INVOICING_AREA_001` (fail-closed);
 *   2. configuración DIAN que no está viva ⇒ `INVOICING_ENABLEMENT_001`;
 *   3. **sin** configuración DIAN ⇒ pasa. Esta tercera es la que evita que
 *      cerrar el hueco sea una pérdida de función mayor que el hueco: medido el
 *      2026-08-24, 20 de las 21 tiendas de dev no tienen fila en
 *      `dian_configurations`.
 */

const construir = (opts: {
  areaEnabled: boolean;
  scope?: 'ORGANIZATION' | 'STORE';
  config: { environment: string; enablement_status: string } | null;
}) => {
  const findFirst = jest.fn().mockResolvedValue(opts.config);
  const prisma: any = {
    withoutScope: () => ({ dian_configurations: { findFirst } }),
  };
  const fiscalScope: any = {
    requireFiscalScope: jest.fn().mockResolvedValue(opts.scope || 'STORE'),
  };
  const fiscalGate: any = {
    isAreaEnabled: jest.fn().mockResolvedValue(opts.areaEnabled),
  };
  return {
    svc: new InvoiceEmissionGateService(prisma, fiscalScope, fiscalGate),
    findFirst,
    fiscalGate,
    fiscalScope,
  };
};

describe('InvoiceEmissionGateService', () => {
  it('área fiscal inactiva ⇒ INVOICING_AREA_001, y no llega a consultar la habilitación', async () => {
    const { svc, findFirst } = construir({ areaEnabled: false, config: null });

    await expect(
      svc.assertAreaActive({ organization_id: 6, store_id: 10 }),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_AREA_001' });

    // Fail-closed: el área es la primera puerta y corta antes.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('configuración en test ⇒ INVOICING_ENABLEMENT_001, con el ambiente y el estado en details', async () => {
    const { svc } = construir({
      areaEnabled: true,
      config: { environment: 'test', enablement_status: 'testing' },
    });

    try {
      await svc.assertAreaActive({ organization_id: 6, store_id: 10 });
      throw new Error('debía lanzar');
    } catch (e: any) {
      expect(e.errorCode).toBe('INVOICING_ENABLEMENT_001');
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse().details).toEqual({
        environment: 'test',
        enablement_status: 'testing',
      });
    }
  });

  it('producción pero no enabled ⇒ sigue bloqueando: hacen falta LAS DOS condiciones', async () => {
    const { svc } = construir({
      areaEnabled: true,
      config: { environment: 'production', enablement_status: 'testing' },
    });

    await expect(
      svc.assertAreaActive({ organization_id: 6, store_id: 10 }),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_ENABLEMENT_001' });
  });

  it('enabled pero en test ⇒ también bloquea', async () => {
    const { svc } = construir({
      areaEnabled: true,
      config: { environment: 'test', enablement_status: 'enabled' },
    });

    await expect(
      svc.assertAreaActive({ organization_id: 6, store_id: 10 }),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_ENABLEMENT_001' });
  });

  it('producción + enabled ⇒ pasa', async () => {
    const { svc } = construir({
      areaEnabled: true,
      config: { environment: 'production', enablement_status: 'enabled' },
    });

    await expect(
      svc.assertAreaActive({ organization_id: 6, store_id: 10 }),
    ).resolves.toBeUndefined();
  });

  it('SIN configuración DIAN ⇒ pasa. Es la indulgencia deliberada, y sin ella la compuerta rompería 20 de 21 tiendas', async () => {
    const { svc, findFirst } = construir({ areaEnabled: true, config: null });

    await expect(
      svc.assertAreaActive({ organization_id: 6, store_id: 10 }),
    ).resolves.toBeUndefined();

    // Consultó y decidió pasar; no es que se saltara la consulta.
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('sin organization_id utilizable no consulta nada: no se puede resolver el alcance del NIT', async () => {
    const { svc, findFirst, fiscalScope } = construir({
      areaEnabled: true,
      config: { environment: 'test', enablement_status: 'testing' },
    });

    await expect(
      svc.assertElectronicEmissionLive({ store_id: 10 }),
    ).resolves.toBeUndefined();

    expect(fiscalScope.requireFiscalScope).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('el alcance decide el filtro: ORGANIZATION busca por organización con store_id null; STORE por tienda', async () => {
    const org = construir({
      areaEnabled: true,
      scope: 'ORGANIZATION',
      config: { environment: 'production', enablement_status: 'enabled' },
    });
    await org.svc.assertAreaActive({ organization_id: 6, store_id: 10 });
    expect(org.findFirst.mock.calls[0][0].where).toEqual({
      organization_id: 6,
      store_id: null,
      configuration_type: 'invoicing',
    });

    const tienda = construir({
      areaEnabled: true,
      scope: 'STORE',
      config: { environment: 'production', enablement_status: 'enabled' },
    });
    await tienda.svc.assertAreaActive({ organization_id: 6, store_id: 10 });
    expect(tienda.findFirst.mock.calls[0][0].where).toEqual({
      store_id: 10,
      configuration_type: 'invoicing',
    });
  });

  it('el área se pregunta con el MISMO criterio que send/accept: isAreaEnabled(org, store, "invoicing")', async () => {
    const { svc, fiscalGate } = construir({
      areaEnabled: true,
      config: null,
    });

    await svc.assertAreaActive({ organization_id: 6, store_id: 10 });

    expect(fiscalGate.isAreaEnabled).toHaveBeenCalledWith(6, 10, 'invoicing');
  });
});
