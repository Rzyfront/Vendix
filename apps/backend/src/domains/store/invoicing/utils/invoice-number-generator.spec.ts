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

    // Doble de la bóveda con la MISMA preferencia que el servicio real: la
    // copia cifrada manda y la plana sólo es respaldo. El generador valida por
    // aquí justamente para no aprobar una clave distinta de la que se hashea.
    const technicalKeyVault = {
      reveal: jest.fn(
        (stored: any) =>
          stored?.technical_key_encrypted ?? stored?.technical_key ?? null,
      ),
    };

    return {
      service: new InvoiceNumberGenerator(
        prisma as any,
        fiscalScope as any,
        technicalKeyVault as any,
      ),
      tx,
      fiscalScope,
      technicalKeyVault,
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

    /**
     * EL CASO QUE LA VERSIÓN ANTERIOR APROBABA.
     *
     * Fila con la columna plana ya corregida (40 hex impecables) y la copia
     * cifrada todavía rancia. Validar `resolution.technical_key` la daba por
     * buena, pero `reveal()` PREFIERE la cifrada, así que el CUFE se hashaba
     * con la vieja y la DIAN rechazaba por «CUFE mal calculado» — con el
     * consecutivo autorizado ya gastado y un validador que había dicho que sí.
     *
     * La puerta tiene que mirar exactamente el valor que se va a hashear.
     */
    it('rechaza cuando la copia cifrada —la que se hashea— está truncada, aunque la plana esté bien', async () => {
      const row = {
        id: 9,
        prefix: 'FE',
        current_number: 10,
        range_from: 1,
        range_to: 20,
        technical_key: VALID_CLTEC,
        technical_key_encrypted: VALID_CLTEC.slice(0, 38),
      };
      const { service, tx, technicalKeyVault } = createService({
        invoice_resolutions: {
          findFirst: jest.fn().mockResolvedValue(row),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...row, current_number: 11 }),
        },
      });

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'sales_invoice',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_011' });

      expect(technicalKeyVault.reveal).toHaveBeenCalled();
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

  /**
   * SERIE INTERNA: la numeración que ponemos nosotros no puede bloquear.
   *
   * Emitir una nota exigía una fila de `invoice_resolutions` que nadie creaba
   * nunca —no hay seed, y la pantalla de resoluciones pide los datos de una
   * Autorización de Numeración que para una nota no existe—, así que ninguna
   * factura se podía corregir. El bloqueo no protegía nada: la DIAN no autoriza
   * numeración de notas (Oficio 346 de 2018) y el consecutivo es del emisor.
   *
   * Lo que estos tests fijan no es que las notas funcionen, sino la FRONTERA:
   * cada automatismo tiene su contraprueba en un tipo con rango autorizado. Que
   * el generador fabrique o amplíe numeración de una factura de venta es peor
   * que el bloqueo que vino a quitar — son documentos emitidos fuera de la
   * autorización, rechazados uno por uno, cada rechazo quemando un número.
   */
  describe('serie interna', () => {
    /** Fixture sin fila previa, con los dos carriles de escritura espiables. */
    const withoutRow = (created: any = null) => {
      const create = jest.fn().mockResolvedValue(
        created ?? {
          id: 31,
          prefix: 'NC',
          current_number: 0,
          range_from: 1,
          range_to: 1000,
          technical_key: null,
        },
      );
      return {
        invoice_resolutions: {
          findFirst: jest.fn().mockResolvedValue(null),
          create,
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 31, prefix: 'NC', current_number: 1 }),
        },
      };
    };

    it('abre la serie de una nota crédito cuando no hay ninguna fila', async () => {
      const overrides = withoutRow();
      const { service, tx } = createService(overrides);

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'credit_note',
        }),
      ).resolves.toEqual({ invoice_number: 'NC1', resolution_id: 31 });

      expect(tx.invoice_resolutions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accounting_entity_id: 77,
          document_type: 'credit_note',
          prefix: 'NC',
          resolution_number: 'INTERNA-NC',
          range_from: 1,
          current_number: 0,
          // Sin ClTec: el CUDE de una nota se firma con el Software-PIN, y una
          // clave aquí haría que `invoice-flow` inyectara la equivocada.
          technical_key: null,
          // A la entidad contable, no a una tienda: la búsqueda de consecutivo
          // no filtra por tienda, y sellarlo daría un `NC1` por tienda.
          store_id: null,
        }),
      });
    });

    /** CONTRAPRUEBA del auto-alta. */
    it('NO fabrica numeración para una factura de venta sin resolución', async () => {
      const { service, tx } = createService(withoutRow());

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'sales_invoice',
        }),
      ).rejects.toMatchObject({ errorCode: 'FISCAL_RESOLUTION_MISSING' });

      expect(tx.invoice_resolutions.create).not.toHaveBeenCalled();
    });

    /**
     * Pedir una resolución concreta y no encontrarla no es «no hay serie»: es
     * que ESA fila no sirve. Abrir otra ignoraría en silencio lo que se pidió.
     */
    it('no abre serie cuando el llamador nombró una resolución que no apareció', async () => {
      const { service, tx } = createService(withoutRow());

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'credit_note',
          resolution_id: 404,
        }),
      ).rejects.toMatchObject({ errorCode: 'FISCAL_RESOLUTION_MISSING' });

      expect(tx.invoice_resolutions.create).not.toHaveBeenCalled();
    });

    /**
     * `findFirst` filtra por `is_active` y vigencia. Una serie interna caducada
     * no aparece, y crear otra con el MISMO prefijo reiniciaría el cursor en 1 y
     * emitiría `NC1` por segunda vez. Dos documentos fiscales con el mismo
     * número es peor que el bloqueo que este código quita.
     */
    it('revive la serie dormida en vez de abrir una segunda con el mismo prefijo', async () => {
      const dormant = {
        id: 31,
        prefix: 'NC',
        current_number: 42,
        range_from: 1,
        range_to: 1000,
        technical_key: null,
      };
      const invoice_resolutions = {
        // Vacío en la búsqueda con filtros; presente en la de reutilización.
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(dormant),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...dormant, is_active: true }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...dormant, current_number: 43 }),
      };
      const { service, tx } = createService({ invoice_resolutions });

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'credit_note',
        }),
      ).resolves.toEqual({ invoice_number: 'NC43', resolution_id: 31 });

      expect(tx.invoice_resolutions.create).not.toHaveBeenCalled();
      expect(tx.invoice_resolutions.update).toHaveBeenCalledWith({
        where: { id: 31 },
        data: expect.objectContaining({ is_active: true }),
      });
    });

    it('amplía el rango de una nota agotada en vez de bloquear', async () => {
      const exhausted = {
        id: 31,
        prefix: 'NC',
        current_number: 1000,
        range_from: 1,
        range_to: 1000,
        technical_key: null,
      };
      // Primer intento contra el techo viejo: nada que asignar. Segundo, ya
      // ampliado: asigna.
      const updateMany = jest
        .fn()
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      const invoice_resolutions = {
        findFirst: jest.fn().mockResolvedValue(exhausted),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...exhausted, range_to: 2000 }),
        updateMany,
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...exhausted, current_number: 1001 }),
      };
      const { service, tx } = createService({ invoice_resolutions });

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'credit_note',
        }),
      ).resolves.toEqual({ invoice_number: 'NC1001', resolution_id: 31 });

      expect(tx.invoice_resolutions.update).toHaveBeenCalledWith({
        where: { id: 31 },
        data: { range_to: 2000 },
      });
      // El segundo intento mide contra el techo NUEVO. Repetir el viejo dejaría
      // la fila ampliada y el documento sin numerar igualmente.
      expect(updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 31, current_number: { lt: 2000 } },
        data: { current_number: 1001 },
      });
    });

    /** Un segundo fallo ya no es agotamiento: el techo acaba de subir. */
    it('no reintenta en bucle si tampoco asigna después de ampliar', async () => {
      const invoice_resolutions = {
        findFirst: jest.fn().mockResolvedValue({
          id: 31,
          prefix: 'NC',
          current_number: 1000,
          range_from: 1,
          range_to: 1000,
          technical_key: null,
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      };
      const { service, tx } = createService({ invoice_resolutions });

      await expect(
        service.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'credit_note',
        }),
      ).rejects.toMatchObject({ errorCode: 'FISCAL_RESOLUTION_EXHAUSTED' });

      expect(tx.invoice_resolutions.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.invoice_resolutions.update).toHaveBeenCalledTimes(1);
    });

    /**
     * Reportar el techo viejo describiría un agotamiento que ya no existe y
     * mandaría a quien lea la traza a ampliar un rango que acaba de crecer.
     */
    it('reporta el techo ampliado, no el que acaba de quedar obsoleto', async () => {
      const invoice_resolutions = {
        findFirst: jest.fn().mockResolvedValue({
          id: 31,
          prefix: 'NC',
          current_number: 1000,
          range_from: 1,
          range_to: 1000,
          technical_key: null,
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      };
      const { service } = createService({ invoice_resolutions });

      const error: any = await service
        .generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 77,
          document_type: 'credit_note',
        })
        .catch((e: any) => e);

      expect(error.errorCode).toBe('FISCAL_RESOLUTION_EXHAUSTED');
      expect(error.getResponse().details).toMatchObject({ range_to: 2000 });
    });
  });
});
