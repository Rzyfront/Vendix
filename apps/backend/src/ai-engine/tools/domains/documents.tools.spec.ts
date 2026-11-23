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
      records?: Record<string, { id: number; label: string | null } | null>;
    } = {},
  ) {
    const attachment =
      overrides.attachment === null ? null : { ...PDF, ...overrides.attachment };
    const records: Record<string, { id: number; label: string | null } | null> =
      {
        customer: { id: 5, label: 'Ana Pérez' },
        order: { id: 5, label: 'ORD-5' },
        purchase_order: { id: 123, label: 'OC-123' },
        supplier: { id: 5, label: 'Distribuidora Sur' },
        expense: { id: 5, label: 'Arriendo' },
        product: { id: 5, label: 'Camiseta' },
        ...overrides.records,
      };
    const attachments = {
      findAttachmentForAgent: jest.fn().mockResolvedValue(attachment),
    };
    const recordAttachments = {
      // Only the requested id exists in this store.
      findRecordForAgent: jest.fn(async (type: string, id: number) => {
        const row = records[type];
        return row && row.id === id ? row : null;
      }),
      saveAttachmentToRecordForAgent: jest.fn(async (input: any) => ({
        stored_file_id: input.attachment.stored_file_id ?? 77,
        dossier_id: 55,
        dossier_item_id: 66,
        purchase_order_attachment_id:
          input.entityType === 'purchase_order' ? 900 : null,
      })),
    };
    const deps = { attachments, recordAttachments };
    const tools = createDocumentTools(deps as unknown as DocumentToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const save = recordAttachments.saveAttachmentToRecordForAgent;
    return { deps, attachments, recordAttachments, save, tools, byName };
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
    const { byName, save } = build();
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
    expect(save).not.toHaveBeenCalled();
  });

  it('ejecuta: delega el guardado al servicio con el registro, el expediente y el actor', async () => {
    const { byName, save, attachments, recordAttachments } = build();
    const out = await run(byName.attach_document_to_customer, {
      attachment_id: 'att_41',
      entity_id: 5,
      doc_type: 'contrato',
    });
    expect(out).toEqual({
      resumen: 'factura.pdf guardado en el cliente #5.',
      entity_type: 'customer',
      entity_id: 5,
      stored_file_id: 77,
      dossier_id: 55,
      dossier_item_id: 66,
      purchase_order_attachment_id: null,
    });
    expect(attachments.findAttachmentForAgent).toHaveBeenCalledWith(41);
    expect(recordAttachments.findRecordForAgent).toHaveBeenCalledWith(
      'customer',
      5,
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      entityType: 'customer',
      record: { id: 5, label: 'Ana Pérez' },
      attachment: PDF,
      docType: 'contrato',
      dossierTitle: 'Cliente #5 · Ana Pérez',
      storeId: 7,
      organizationId: 3,
      userId: 11,
    });
  });

  it('un registro sin etiqueta titula su carpeta solo con el número', async () => {
    const { byName, save } = build({
      records: { expense: { id: 5, label: null } },
    });
    await run(byName.attach_document_to_expense, {
      attachment_id: 'att_41',
      entity_id: 5,
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ dossierTitle: 'Gasto #5' }),
    );
  });

  it('orden de compra: devuelve también el adjunto creado en la orden', async () => {
    const { byName, save } = build();
    const out = await run(byName.attach_document_to_purchase_order, {
      attachment_id: 'att_41',
      entity_id: 123,
    });
    expect(out.purchase_order_attachment_id).toBe(900);
    expect(out.resumen).toBe('factura.pdf guardado en la orden de compra #123.');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'purchase_order',
        record: { id: 123, label: 'OC-123' },
        dossierTitle: 'Orden de compra #123 · OC-123',
      }),
    );
  });

  it('un adjunto ya guardado llega al servicio con su archivo para reutilizarlo', async () => {
    const { byName, save } = build({
      attachment: { stored_file_id: 31 },
    });
    const out = await run(byName.attach_document_to_supplier, {
      attachment_id: 'att_41',
      entity_id: 5,
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({ stored_file_id: 31 }),
        docType: 'vex_attachment',
      }),
    );
    expect(out.stored_file_id).toBe(31);
  });

  describe('permiso por entidad destino', () => {
    it.each(ATTACHABLE_ENTITY_TYPES)(
      '%s: sin su permiso de escritura no se lista y el handler rechaza',
      async (type) => {
        const { byName, save, attachments } = build();
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
        expect(attachments.findAttachmentForAgent).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
      },
    );

    it('el permiso de lectura de la entidad no basta', async () => {
      const { byName, save } = build();
      const out = await run(
        byName.attach_document_to_purchase_order,
        { attachment_id: 'att_41', entity_id: 123 },
        ['store:orders:purchase_orders:read'],
      );
      expect(out.error).toContain('falta el permiso');
      expect(save).not.toHaveBeenCalled();
    });
  });

  it('un registro de otra tienda (no visible) responde que no existe, en preview y al ejecutar', async () => {
    const { byName, save } = build({
      records: { purchase_order: null },
    });
    const args = { attachment_id: 'att_41', entity_id: 123 };
    const p = await preview(byName.attach_document_to_purchase_order, args);
    expect(p.status).toBe('error');
    expect(p.message).toContain('Orden de compra #123 no existe');
    const out = await run(byName.attach_document_to_purchase_order, args);
    expect(out.error).toContain('no existe o no es visible en esta tienda');
    expect(save).not.toHaveBeenCalled();
  });

  it('un adjunto que no es de esta tienda (no se resuelve) se rechaza', async () => {
    const { byName, save, attachments } = build({ attachment: null });
    const out = await run(byName.attach_document_to_order, {
      attachment_id: 'att_999',
      entity_id: 5,
    });
    expect(out.error).toContain('ya no está disponible');
    expect(attachments.findAttachmentForAgent).toHaveBeenCalledWith(999);
    expect(save).not.toHaveBeenCalled();
  });

  describe.each([
    ['HEIC', 'image/heic', 'foto.heic'],
    ['CSV', 'text/csv', 'ventas.csv'],
  ])('%s: formato que el módulo documental no acepta', (_l, mime, name) => {
    it('el preview dice que no se puede guardar y la ejecución se rehúsa sin convertir', async () => {
      const { byName, save } = build({
        attachment: { mime_type: mime, original_name: name },
      });
      const args = { attachment_id: 'att_41', entity_id: 5 };
      const p = await preview(byName.attach_document_to_customer, args);
      expect(p.status).toBe('error');
      expect(p.message).toContain('No se puede guardar');
      expect(p.target).toBe(`Guardar ${name} en el cliente #5`);
      const out = await run(byName.attach_document_to_customer, args);
      expect(out.error).toContain('No se puede guardar');
      expect(save).not.toHaveBeenCalled();
    });
  });

  it('si el servicio falla (ya compensó S3) responde que no se guardó nada', async () => {
    const { byName, save } = build();
    save.mockRejectedValueOnce(new Error('boom'));
    const out = await run(byName.attach_document_to_purchase_order, {
      attachment_id: 'att_41',
      entity_id: 123,
    });
    expect(out).toEqual({
      error: 'boom',
      next_step: 'No se guardó nada. Vuelve a intentarlo o avisa a soporte.',
    });
  });

  it('argumentos inválidos devuelven {error,next_step} sin tocar servicios', async () => {
    const { byName, attachments, recordAttachments, save } = build();
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
    expect(attachments.findAttachmentForAgent).not.toHaveBeenCalled();
    expect(recordAttachments.findRecordForAgent).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
