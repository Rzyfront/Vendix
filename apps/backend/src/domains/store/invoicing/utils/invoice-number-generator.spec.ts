import { InvoiceNumberGenerator } from './invoice-number-generator';

/**
 * ClTec de 40 hexadecimales, la forma que emite la DIAN. Es load-bearing en los
 * fixtures de `sales_invoice`: el generador rechaza ese tipo si la resolución no
 * trae una clave utilizable, porque el 14º campo de su CUFE es esta clave y un
 * rechazo de la DIAN gasta el consecutivo autorizado sin devolverlo.
 */
const VALID_CLTEC = 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c';

describe('InvoiceNumberGenerator', () => {
  const createService = (txOverrides: any = {}) => {
    const resolution = {
      id: 9,
      prefix: 'FE',
      current_number: 10,
      // `range_from` is load-bearing: the generator floors the cursor at
      // `range_from - 1`, so omitting it made the floor comparison NaN and the
      // fixture only passed by accident.
      range_from: 1,
      range_to: 20,
      technical_key: VALID_CLTEC,
    };
    const tx = {
      $executeRawUnsafe: jest.fn(),
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue(resolution),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...resolution, current_number: 11 }),
      },
      ...txOverrides,
    };
    const client = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const prisma = { withoutScope: () => client };
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest.fn(),
    };

    return {
      service: new InvoiceNumberGenerator(prisma as any, fiscalScope as any),
      tx,
      fiscalScope,
    };
  };

  it('locks and increments by accounting entity and fiscal document type', async () => {
    const { service, tx, fiscalScope } = createService();

    await expect(
      service.generateNextNumber({
        organization_id: 1,
        accounting_entity_id: 77,
        document_type: 'support_document',
      }),
    ).resolves.toEqual({ invoice_number: 'FE11', resolution_id: 9 });

    expect(fiscalScope.resolveAccountingEntityForFiscal).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'invoice_resolution:77:support_document',
    );
    expect(tx.invoice_resolutions.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        accounting_entity_id: 77,
        document_type: 'support_document',
        is_active: true,
      }),
      orderBy: { created_at: 'desc' },
    });
    expect(tx.invoice_resolutions.updateMany).toHaveBeenCalledWith({
      where: { id: 9, current_number: { lt: 20 } },
      // ABSOLUTE assignment, not `{ increment: 1 }`. The value written is the
      // FLOORED cursor + 1, and only an absolute write can carry the floor. It is
      // safe because the advisory lock above serializes allocation, so no
      // concurrent transaction can slip between the read and this write.
      data: { current_number: 11 },
    });
  });

  /**
   * A resolution whose cursor drifted below its authorized floor (a fresh row left
   * at 0, a bad import) would emit numbers starting at 1 under a blind
   * `increment: 1`. The DIAN rejects every number outside the authorized range,
   * and each rejection still consumes the attempt — so the floor is what keeps a
   * drifted cursor from burning the whole block.
   */
  it('floors a drifted cursor at range_from instead of emitting out-of-range numbers', async () => {
    const { service, tx } = createService({
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          prefix: 'FE',
          current_number: 0,
          range_from: 990,
          range_to: 1000,
          technical_key: VALID_CLTEC,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          prefix: 'FE',
          current_number: 990,
          range_from: 990,
          range_to: 1000,
          technical_key: VALID_CLTEC,
        }),
      },
    });

    await expect(
      service.generateNextNumber({
        organization_id: 1,
        accounting_entity_id: 77,
      }),
    ).resolves.toEqual({ invoice_number: 'FE990', resolution_id: 9 });

    // First number of a drifted resolution is exactly `range_from`, not 1.
    expect(tx.invoice_resolutions.updateMany).toHaveBeenCalledWith({
      where: { id: 9, current_number: { lt: 1000 } },
      data: { current_number: 990 },
    });
  });

  it('resolves the fiscal accounting entity when not provided', async () => {
    const { service, fiscalScope } = createService();
    fiscalScope.resolveAccountingEntityForFiscal.mockResolvedValue({ id: 501 });

    await service.generateNextNumber({
      organization_id: 1,
      store_id: 30,
      document_type: 'sales_invoice',
    });

    expect(fiscalScope.resolveAccountingEntityForFiscal).toHaveBeenCalledWith({
      organization_id: 1,
      store_id: 30,
    });
  });

  it('blocks exhausted fiscal ranges without allocating a number', async () => {
    const { service } = createService({
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          prefix: 'FE',
          current_number: 20,
          range_from: 1,
          range_to: 20,
          technical_key: VALID_CLTEC,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
    });

    await expect(
      service.generateNextNumber({
        organization_id: 1,
        accounting_entity_id: 77,
      }),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_RESOLUTION_EXHAUSTED' });
  });

  /**
   * REGRESIÓN DE UN INCIDENTE DE PRODUCCIÓN.
   *
   * Una resolución guardó una ClTec de 38 caracteres —hexadecimales válidos, dos
   * perdidos al copiarla— y nadie miró su forma. El XML salió impecable (la ClTec
   * no viaja en él), la DIAN recomputó el CUFE con la clave verdadera, los hashes
   * difirieron y rechazó la factura. El consecutivo autorizado ya estaba gastado
   * y eso no se recupera.
   *
   * Lo que estos tests fijan no es sólo que falle, sino DÓNDE: antes del
   * `updateMany` que mueve el cursor. Un fallo posterior sería indistinguible del
   * rechazo de la DIAN en lo único que importa — el número perdido.
   */
  describe('precondición de clave técnica (sales_invoice)', () => {
    const withKey = (technical_key: string | null) => {
      const row = {
        id: 9,
        prefix: 'FE',
        current_number: 10,
        range_from: 1,
        range_to: 20,
        technical_key,
      };
      return {
        invoice_resolutions: {
          findFirst: jest.fn().mockResolvedValue(row),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...row, current_number: 11 }),
        },
      };
    };

    it('rechaza una clave truncada SIN asignar numeración', async () => {
      const truncated = VALID_CLTEC.slice(0, 38);
      const { service, tx } = createService(withKey(truncated));

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'sales_invoice',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_011' });

      // Lo esencial: el cursor no se movió.
      expect(tx.invoice_resolutions.updateMany).not.toHaveBeenCalled();
    });

    it('rechaza una resolución de venta sin clave', async () => {
      const { service, tx } = createService(withKey(null));

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'sales_invoice',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_011' });
      expect(tx.invoice_resolutions.updateMany).not.toHaveBeenCalled();
    });

    it('acepta la clave en mayúscula: el hex no distingue caso', async () => {
      // Un PDF que la renderiza en mayúscula no entrega una clave distinta. Se
      // normaliza a minúscula al guardar, así que bloquearla aquí sería un falso
      // positivo sobre una resolución perfectamente válida.
      const { service } = createService(withKey(VALID_CLTEC.toUpperCase()));

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'sales_invoice',
        }),
      ).resolves.toMatchObject({ resolution_id: 9 });
    });

    /**
     * El 14º campo del CUDE de una nota o un documento equivalente es el
     * Software-PIN, no la ClTec. Exigírsela bloquearía documentos que
     * legítimamente no la tienen — y el primer test de este archivo emite un
     * `support_document` sin ella.
     */
    it('no exige clave a los tipos que se hashean con el Software-PIN', async () => {
      const { service } = createService(withKey(null));

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'credit_note',
        }),
      ).resolves.toMatchObject({ resolution_id: 9 });
    });
  });
});
