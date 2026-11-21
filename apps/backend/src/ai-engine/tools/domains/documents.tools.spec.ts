import { RequestContextService } from '@common/context/request-context.service';
import { AIToolRegistry } from '../ai-tool-registry';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  ATTACH_ENTITY_PERMISSION,
  ATTACHABLE_ENTITY_TYPES,
  createDocumentTools,
  DocumentToolDeps,
} from './documents.tools';

/**
 * T44 (odd/tasks/vex-agente-avanzado.md, S7): "guarda esta factura en la orden
 * de compra #123". Propose -> preview -> confirm -> execute, permission per
 * TARGET entity, the file survives the conversation purge.
 */
describe('documents.tools · guardar y asociar', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };
  const PDF = {
    id: 41,
    s3_key: 'org/store/vexi/attachments/abc.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
    original_name: 'factura.pdf',
    stored_file_id: null as number | null,
  };

  const ALL_PERMISSIONS = Object.values(ATTACH_ENTITY_PERMISSION);

  async function withPermissions<T>(
    permissions: string[],
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const spy = jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ ...CONTEXT, permissions } as any);
    try {
      return await fn();
    } finally {
      spy.mockRestore();
    }
  }

  function build(
    overrides: {
      attachment?: Partial<typeof PDF> | null;
      records?: Record<string, any>;
      uploadFails?: boolean;
    } = {},
  ) {
    const attachment =
      overrides.attachment === null ? null : { ...PDF, ...overrides.attachment };
    const records: Record<string, any> = {
      users: { id: 5, first_name: 'Ana', last_name: 'Pérez' },
      orders: { id: 5, order_number: 'ORD-5' },
      purchase_orders: { id: 123, order_number: 'OC-123' },
      suppliers: { id: 5, name: 'Distribuidora Sur' },
      expenses: { id: 5, description: 'Arriendo' },
      products: { id: 5, name: 'Camiseta' },
      ...overrides.records,
    };
    const finder = (model: string) =>
      jest.fn().mockImplementation(async (args: any) => {
        const row = records[model];
        if (!row) return null;
        // Only the requested id exists in this store.
        return args?.where?.id === row.id ? row : null;
      });
    const tx = {
      ai_attachments: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      purchase_order_attachments: {
        create: jest.fn().mockResolvedValue({ id: 900 }),
      },
    };
    const prisma = {
      ai_attachments: {
        findFirst: jest.fn().mockResolvedValue(attachment),
      },
      users: { findFirst: finder('users') },
      orders: { findFirst: finder('orders') },
      purchase_orders: { findFirst: finder('purchase_orders') },
      suppliers: { findFirst: finder('suppliers') },
      expenses: { findFirst: finder('expenses') },
      products: { findFirst: finder('products') },
      stores: { findFirst: jest.fn().mockResolvedValue({ id: 7, slug: 's' }) },
      organizations: {
        findFirst: jest.fn().mockResolvedValue({ id: 3, slug: 'o' }),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const storedFiles = {
      upload: jest.fn(async (input: any) => {
        if (overrides.uploadFails) throw new Error('S3 caído');
        return {
          id: 77,
          s3_key: `org/store/${input.folder}/uuid.pdf`,
          original_name: input.originalName,
        };
      }),
      discardObject: jest.fn().mockResolvedValue(undefined),
    };
    const dossiers = {
      ensureForSubject: jest.fn().mockResolvedValue({ id: 55 }),
      addSubjectFileItem: jest.fn().mockResolvedValue({ id: 66 }),
    };
    const s3 = {
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 x')),
      uploadFile: jest.fn(async (_b: Buffer, key: string) => key),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const paths = {
      buildPurchaseOrderAttachmentPath: jest.fn(
        (_o: any, _s: any, id: number) => `org/store/purchase-orders/attachments/${id}`,
      ),
    };
    const deps = { prisma, storedFiles, dossiers, s3, paths } as any;
    const tools = createDocumentTools(deps as DocumentToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps, tx, prisma, storedFiles, dossiers, s3, paths, tools, byName };
  }

  const preview = (tool: RegisteredTool, args: Record<string, any>) =>
    withPermissions(ALL_PERMISSIONS, () => tool.preview!(args, CONTEXT));
  const run = (
    tool: RegisteredTool,
    args: Record<string, any>,
    permissions: string[] = ALL_PERMISSIONS,
  ) =>
    withPermissions(permissions, () => tool.handler!(args, CONTEXT)).then(
      (raw) => JSON.parse(raw),
    );

  it('expone una escritura con confirmación por entidad y su permiso de escritura', () => {
    const { tools } = build();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ATTACHABLE_ENTITY_TYPES.map((t) => `attach_document_to_${t}`).sort(),
    );
    for (const tool of tools) {
      expect(tool.requiresConfirmation).toBe(true);
      expect(tool.readOnly).toBeUndefined();
      expect(tool.requiredPermissions).toHaveLength(1);
    }
    expect(
      Object.fromEntries(tools.map((t) => [t.name, t.requiredPermissions])),
    ).toEqual({
      attach_document_to_customer: ['store:customers:update'],
      attach_document_to_order: ['store:orders:update'],
      attach_document_to_purchase_order: [
        'store:orders:purchase_orders:attach',
      ],
      attach_document_to_supplier: ['store:inventory:suppliers:update'],
      attach_document_to_expense: ['store:expenses:update'],
      attach_document_to_product: ['store:products:update'],
    });
  });

  it('propone «Guardar factura.pdf en la orden de compra #123» sin escribir nada', async () => {
    const { byName, storedFiles, dossiers, tx, s3 } = build();
    const p = await preview(byName.attach_document_to_purchase_order, {
      attachment_id: 'att_41',
      entity_id: 123,
      doc_type: 'factura',
    });
    expect(p.status).toBe('ok');
    expect(p.target).toBe('Guardar factura.pdf en la orden de compra #123');
    expect(p.changes.map((c) => c.to)).toEqual([
      'factura.pdf',
      '#123 · OC-123',
      'factura',
    ]);
    expect(storedFiles.upload).not.toHaveBeenCalled();
    expect(dossiers.ensureForSubject).not.toHaveBeenCalled();
    expect(tx.ai_attachments.updateMany).not.toHaveBeenCalled();
    expect(s3.downloadFile).not.toHaveBeenCalled();
  });

  it('ejecuta: archivo guardado aparte, carpeta del registro, ítem y adjunto marcado', async () => {
    const { byName, storedFiles, dossiers, tx, s3 } = build();
    const out = await run(byName.attach_document_to_customer, {
      attachment_id: 'att_41',
      entity_id: 5,
      doc_type: 'contrato',
    });
    expect(out).toMatchObject({
      resumen: 'factura.pdf guardado en el cliente #5.',
      stored_file_id: 77,
      dossier_id: 55,
      dossier_item_id: 66,
      purchase_order_attachment_id: null,
    });
    // separate S3 object under the record's folder, source 'upload', agent actor
    expect(s3.downloadFile).toHaveBeenCalledWith(PDF.s3_key);
    const upload = storedFiles.upload.mock.calls[0][0];
    expect(upload).toMatchObject({
      originalName: 'factura.pdf',
      mimeType: 'application/pdf',
      source: 'upload',
      folder: 'records/customer/5',
      actor: { type: 'ai', id: 11 },
    });
    // the stored object is NOT the conversation's object
    const stored = await storedFiles.upload.mock.results[0].value;
    expect(stored.s3_key).not.toBe(PDF.s3_key);
    expect(dossiers.ensureForSubject).toHaveBeenCalledWith(tx, {
      subject_type: 'customer',
      subject_id: 5,
      title: 'Cliente #5 · Ana Pérez',
    });
    expect(dossiers.addSubjectFileItem).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        dossier_id: 55,
        file_id: 77,
        stage_key: 'records',
        field_key: 'contrato',
      }),
    );
    // purge survival criterion: linked + stored_file_id on the attachment row
    expect(tx.ai_attachments.updateMany).toHaveBeenCalledWith({
      where: { id: 41 },
      data: expect.objectContaining({
        linked_entity_type: 'customer',
        linked_entity_id: 5,
        stored_file_id: 77,
        linked_at: expect.any(Date),
      }),
    });
    expect(tx.purchase_order_attachments.create).not.toHaveBeenCalled();
  });

  it('orden de compra: además crea purchase_order_attachments con su propia copia en S3', async () => {
    const { byName, tx, s3 } = build();
    const out = await run(byName.attach_document_to_purchase_order, {
      attachment_id: 'att_41',
      entity_id: 123,
    });
    expect(out.purchase_order_attachment_id).toBe(900);
    const uploadedKey = s3.uploadFile.mock.calls[0][1] as string;
    expect(uploadedKey).toContain('purchase-orders/attachments/123/');
    expect(tx.purchase_order_attachments.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purchase_order_id: 123,
        file_url: uploadedKey,
        file_name: 'factura.pdf',
        file_type: 'application/pdf',
        file_size: 2048,
        uploaded_by_user_id: 11,
      }),
    });
  });

  it('un adjunto ya guardado reutiliza su archivo en vez de subirlo otra vez', async () => {
    const { byName, storedFiles, dossiers } = build({
      attachment: { stored_file_id: 31 },
    });
    const out = await run(byName.attach_document_to_supplier, {
      attachment_id: 'att_41',
      entity_id: 5,
    });
    expect(storedFiles.upload).not.toHaveBeenCalled();
    expect(dossiers.addSubjectFileItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ file_id: 31, field_key: 'vex_attachment' }),
    );
    expect(out.stored_file_id).toBe(31);
  });

  describe('permiso por entidad destino', () => {
    it.each(ATTACHABLE_ENTITY_TYPES)(
      '%s: sin su permiso de escritura no se lista y el handler rechaza',
      async (type) => {
        const { byName, storedFiles, prisma } = build();
        const tool = byName[`attach_document_to_${type}`];
        const registry = new AIToolRegistry({} as any);
        registry.register(tool);

        const others = ALL_PERMISSIONS.filter(
          (p) => p !== ATTACH_ENTITY_PERMISSION[type],
        );
        expect(
          registry.getAvailableDefinitions(others).map((d) => d.function.name),
        ).toEqual([]);
        expect(
          registry
            .getAvailableDefinitions([ATTACH_ENTITY_PERMISSION[type]])
            .map((d) => d.function.name),
        ).toEqual([tool.name]);

        const out = await run(
          tool,
          { attachment_id: 'att_41', entity_id: 5 },
          others,
        );
        expect(out.error).toContain('Tu rol no permite guardar documentos');
        expect(out.error).toContain(ATTACH_ENTITY_PERMISSION[type]);
        expect(storedFiles.upload).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('el permiso de lectura de la entidad no basta', async () => {
      const { byName, storedFiles } = build();
      const out = await run(
        byName.attach_document_to_purchase_order,
        { attachment_id: 'att_41', entity_id: 123 },
        ['store:orders:purchase_orders:read'],
      );
      expect(out.error).toContain('falta el permiso');
      expect(storedFiles.upload).not.toHaveBeenCalled();
    });
  });

  it('un registro de otra tienda (no visible) responde que no existe, en preview y al ejecutar', async () => {
    const { byName, storedFiles, prisma } = build({
      records: { purchase_orders: null },
    });
    const args = { attachment_id: 'att_41', entity_id: 123 };
    const p = await preview(byName.attach_document_to_purchase_order, args);
    expect(p.status).toBe('error');
    expect(p.message).toContain('Orden de compra #123 no existe');
    const out = await run(byName.attach_document_to_purchase_order, args);
    expect(out.error).toContain('no existe o no es visible en esta tienda');
    expect(storedFiles.upload).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('un adjunto que no es de esta tienda (no se resuelve) se rechaza', async () => {
    const { byName, storedFiles } = build({ attachment: null });
    const out = await run(byName.attach_document_to_order, {
      attachment_id: 'att_999',
      entity_id: 5,
    });
    expect(out.error).toContain('ya no está disponible');
    expect(storedFiles.upload).not.toHaveBeenCalled();
  });

  describe.each([
    ['HEIC', 'image/heic', 'foto.heic'],
    ['CSV', 'text/csv', 'ventas.csv'],
  ])('%s: formato que el módulo documental no acepta', (_l, mime, name) => {
    it('el preview dice que no se puede guardar y la ejecución se rehúsa sin convertir', async () => {
      const { byName, storedFiles, s3, prisma } = build({
        attachment: { mime_type: mime, original_name: name },
      });
      const args = { attachment_id: 'att_41', entity_id: 5 };
      const p = await preview(byName.attach_document_to_customer, args);
      expect(p.status).toBe('error');
      expect(p.message).toContain('No se puede guardar');
      expect(p.target).toBe(`Guardar ${name} en el cliente #5`);
      const out = await run(byName.attach_document_to_customer, args);
      expect(out.error).toContain('No se puede guardar');
      expect(storedFiles.upload).not.toHaveBeenCalled();
      expect(s3.downloadFile).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('si algo falla dentro de la transacción no queda ningún objeto huérfano en S3', async () => {
    const { byName, storedFiles, dossiers, s3 } = build();
    dossiers.addSubjectFileItem.mockRejectedValueOnce(new Error('boom'));
    const out = await run(byName.attach_document_to_purchase_order, {
      attachment_id: 'att_41',
      entity_id: 123,
    });
    expect(out.error).toBe('boom');
    expect(storedFiles.discardObject).toHaveBeenCalledWith(
      'org/store/records/purchase_order/123/uuid.pdf',
    );

    const second = build();
    second.tx.purchase_order_attachments.create.mockRejectedValueOnce(
      new Error('db caída'),
    );
    await run(second.byName.attach_document_to_purchase_order, {
      attachment_id: 'att_41',
      entity_id: 123,
    });
    const copyKey = second.s3.uploadFile.mock.calls[0][1];
    expect(second.storedFiles.discardObject).toHaveBeenCalledWith(copyKey);
    expect(second.storedFiles.discardObject).toHaveBeenCalledWith(
      'org/store/records/purchase_order/123/uuid.pdf',
    );
    expect(s3.deleteFile).not.toHaveBeenCalled();
  });

  it('argumentos inválidos devuelven {error,next_step} sin tocar servicios', async () => {
    const { byName, prisma, storedFiles } = build();
    const bad = await run(byName.attach_document_to_order, {
      attachment_id: 'factura.pdf',
      entity_id: 5,
    });
    expect(bad.error).toContain('no es un adjunto válido');
    const badId = await run(byName.attach_document_to_order, {
      attachment_id: 'att_41',
      entity_id: 'x',
    });
    expect(badId.error).toContain('entity_id inválido');
    expect(prisma.ai_attachments.findFirst).not.toHaveBeenCalled();
    expect(storedFiles.upload).not.toHaveBeenCalled();
  });
});
