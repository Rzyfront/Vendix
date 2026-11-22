import { RequestContextService } from '@common/context/request-context.service';
import {
  RecordAttachmentsService,
  SaveAttachmentToRecordInput,
} from './record-attachments.service';

/**
 * T44 (odd/tasks/vex-agente-avanzado.md, S7): the save behind
 * `attach_document_to_<entity>`. The tool is a facade; the queries, the
 * transaction and the S3 compensation live (and are pinned) here.
 */
describe('RecordAttachmentsService · guardar un adjunto del chat en un registro', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };
  const PDF = {
    id: 41,
    s3_key: 'org/store/vexi/attachments/abc.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
    original_name: 'factura.pdf',
    stored_file_id: null as number | null,
  };

  async function inContext<T>(fn: () => Promise<T>): Promise<T> {
    const spy = jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(CONTEXT as any);
    try {
      return await fn();
    } finally {
      spy.mockRestore();
    }
  }

  function build(
    overrides: { store?: { id: number; slug: string } | null } = {},
  ) {
    const tx = {
      purchase_order_attachments: {
        create: jest.fn().mockResolvedValue({ id: 900 }),
      },
    };
    const prisma = {
      users: { findFirst: jest.fn() },
      orders: { findFirst: jest.fn() },
      purchase_orders: { findFirst: jest.fn() },
      suppliers: { findFirst: jest.fn() },
      expenses: { findFirst: jest.fn() },
      products: { findFirst: jest.fn() },
      stores: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides.store === undefined ? { id: 7, slug: 's' } : overrides.store,
          ),
      },
      organizations: {
        findFirst: jest.fn().mockResolvedValue({ id: 3, slug: 'o' }),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const storedFiles = {
      upload: jest.fn(async (input: any, _tx?: unknown) => ({
        id: 77,
        s3_key: `org/store/${input.folder}/uuid.pdf`,
        original_name: input.originalName,
      })),
      discardObject: jest.fn().mockResolvedValue(undefined),
    };
    const dossiers = {
      ensureForSubject: jest.fn().mockResolvedValue({ id: 55 }),
      addSubjectFileItem: jest.fn().mockResolvedValue({ id: 66 }),
    };
    const attachments = {
      markSavedToRecordForAgent: jest.fn().mockResolvedValue(undefined),
    };
    const s3 = {
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 x')),
      uploadFile: jest.fn(async (_b: Buffer, key: string) => key),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const paths = {
      buildPurchaseOrderAttachmentPath: jest.fn(
        (_o: any, _s: any, id: number) =>
          `org/store/purchase-orders/attachments/${id}`,
      ),
    };
    const service = new RecordAttachmentsService(
      prisma as never,
      storedFiles as never,
      dossiers as never,
      attachments as never,
      s3 as never,
      paths as never,
    );
    return { service, tx, prisma, storedFiles, dossiers, attachments, s3, paths };
  }

  function input(
    overrides: Partial<SaveAttachmentToRecordInput> = {},
  ): SaveAttachmentToRecordInput {
    return {
      entityType: 'customer',
      record: { id: 5, label: 'Ana Pérez' },
      attachment: { ...PDF },
      docType: 'contrato',
      dossierTitle: 'Cliente #5 · Ana Pérez',
      storeId: 7,
      organizationId: 3,
      userId: 11,
      ...overrides,
    };
  }

  describe('findRecordForAgent', () => {
    it('cliente: solo de esta tienda y con rol cliente; la etiqueta es su nombre', async () => {
      const { service, prisma } = build();
      prisma.users.findFirst.mockResolvedValue({
        id: 5,
        first_name: 'Ana',
        last_name: 'Pérez',
      });
      const record = await inContext(() =>
        service.findRecordForAgent('customer', 5),
      );
      expect(record).toEqual({ id: 5, label: 'Ana Pérez' });
      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: {
          id: 5,
          store_users: { some: { store_id: 7 } },
          user_roles: { some: { roles: { name: 'customer' } } },
        },
        select: { id: true, first_name: true, last_name: true },
      });
    });

    it('proveedor: filtrado por la organización del contexto', async () => {
      const { service, prisma } = build();
      prisma.suppliers.findFirst.mockResolvedValue({
        id: 5,
        name: 'Distribuidora Sur',
      });
      const record = await inContext(() =>
        service.findRecordForAgent('supplier', 5),
      );
      expect(record).toEqual({ id: 5, label: 'Distribuidora Sur' });
      expect(prisma.suppliers.findFirst).toHaveBeenCalledWith({
        where: { id: 5, organization_id: 3 },
        select: { id: true, name: true },
      });
    });

    it.each([
      ['order', 'orders', { id: 5, order_number: 'ORD-5' }, 'ORD-5'],
      ['purchase_order', 'purchase_orders', { id: 5, order_number: 'OC-5' }, 'OC-5'],
      ['product', 'products', { id: 5, name: 'Camiseta' }, 'Camiseta'],
    ] as const)('%s: etiqueta legible desde %s', async (type, model, row, label) => {
      const { service, prisma } = build();
      prisma[model].findFirst.mockResolvedValue(row);
      const record = await inContext(() => service.findRecordForAgent(type, 5));
      expect(record).toEqual({ id: 5, label });
      expect(prisma[model].findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('gasto: la descripción se recorta a 60 caracteres', async () => {
      const { service, prisma } = build();
      prisma.expenses.findFirst.mockResolvedValue({
        id: 5,
        description: `  ${'a'.repeat(80)}  `,
      });
      const record = await inContext(() =>
        service.findRecordForAgent('expense', 5),
      );
      expect(record).toEqual({ id: 5, label: 'a'.repeat(60) });
    });

    it('un registro que no es visible en esta tienda devuelve null', async () => {
      const { service, prisma } = build();
      prisma.purchase_orders.findFirst.mockResolvedValue(null);
      await expect(
        inContext(() => service.findRecordForAgent('purchase_order', 123)),
      ).resolves.toBeNull();
    });
  });

  describe('saveAttachmentToRecordForAgent', () => {
    it('archivo guardado aparte, carpeta del registro, ítem y adjunto marcado en una transacción', async () => {
      const { service, tx, prisma, storedFiles, dossiers, attachments, s3 } =
        build();
      const out = await service.saveAttachmentToRecordForAgent(input());
      expect(out).toEqual({
        stored_file_id: 77,
        dossier_id: 55,
        dossier_item_id: 66,
        purchase_order_attachment_id: null,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // separate S3 object under the record's folder, source 'upload', agent actor
      expect(s3.downloadFile).toHaveBeenCalledWith(PDF.s3_key);
      const [upload, uploadTx] = storedFiles.upload.mock.calls[0];
      expect(uploadTx).toBe(tx);
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
      expect(dossiers.addSubjectFileItem).toHaveBeenCalledWith(tx, {
        dossier_id: 55,
        file_id: 77,
        stage_key: 'records',
        field_key: 'contrato',
        note: 'Guardado por Vex',
        actor: { type: 'ai', id: 11 },
      });
      // purge survival criterion, stamped inside the same transaction
      expect(attachments.markSavedToRecordForAgent).toHaveBeenCalledWith(tx, {
        attachmentId: 41,
        entityType: 'customer',
        entityId: 5,
        storedFileId: 77,
      });
      expect(tx.purchase_order_attachments.create).not.toHaveBeenCalled();
      expect(prisma.stores.findFirst).not.toHaveBeenCalled();
    });

    it('orden de compra: además crea purchase_order_attachments con su propia copia en S3', async () => {
      const { service, tx, prisma, s3, paths } = build();
      const out = await service.saveAttachmentToRecordForAgent(
        input({
          entityType: 'purchase_order',
          record: { id: 123, label: 'OC-123' },
          dossierTitle: 'Orden de compra #123 · OC-123',
        }),
      );
      expect(out.purchase_order_attachment_id).toBe(900);
      // store and organization resolved here, by the context ids
      expect(prisma.stores.findFirst).toHaveBeenCalledWith({
        where: { id: 7, organization_id: 3 },
        select: { id: true, slug: true },
      });
      expect(prisma.organizations.findFirst).toHaveBeenCalledWith({
        where: { id: 3 },
        select: { id: true, slug: true },
      });
      expect(paths.buildPurchaseOrderAttachmentPath).toHaveBeenCalledWith(
        { id: 3, slug: 'o' },
        { id: 7, slug: 's' },
        123,
      );
      const uploadedKey = s3.uploadFile.mock.calls[0][1] as string;
      expect(uploadedKey).toContain('purchase-orders/attachments/123/');
      expect(tx.purchase_order_attachments.create).toHaveBeenCalledWith({
        data: {
          purchase_order_id: 123,
          file_url: uploadedKey,
          file_name: 'factura.pdf',
          file_type: 'application/pdf',
          file_size: 2048,
          notes: 'Guardado por Vex',
          uploaded_by_user_id: 11,
        },
      });
    });

    it('un adjunto ya guardado reutiliza su archivo en vez de subirlo otra vez', async () => {
      const { service, storedFiles, dossiers, attachments } = build();
      const out = await service.saveAttachmentToRecordForAgent(
        input({
          entityType: 'supplier',
          attachment: { ...PDF, stored_file_id: 31 },
          docType: 'vex_attachment',
        }),
      );
      expect(storedFiles.upload).not.toHaveBeenCalled();
      expect(dossiers.addSubjectFileItem).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ file_id: 31, field_key: 'vex_attachment' }),
      );
      expect(attachments.markSavedToRecordForAgent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ storedFileId: 31 }),
      );
      expect(out.stored_file_id).toBe(31);
    });

    it('si algo falla dentro de la transacción no queda ningún objeto huérfano en S3', async () => {
      const first = build();
      first.dossiers.addSubjectFileItem.mockRejectedValueOnce(new Error('boom'));
      await expect(
        first.service.saveAttachmentToRecordForAgent(
          input({
            entityType: 'purchase_order',
            record: { id: 123, label: 'OC-123' },
          }),
        ),
      ).rejects.toThrow('boom');
      expect(first.storedFiles.discardObject).toHaveBeenCalledWith(
        'org/store/records/purchase_order/123/uuid.pdf',
      );
      expect(first.attachments.markSavedToRecordForAgent).not.toHaveBeenCalled();

      const second = build();
      second.tx.purchase_order_attachments.create.mockRejectedValueOnce(
        new Error('db caída'),
      );
      await expect(
        second.service.saveAttachmentToRecordForAgent(
          input({
            entityType: 'purchase_order',
            record: { id: 123, label: 'OC-123' },
          }),
        ),
      ).rejects.toThrow('db caída');
      const copyKey = second.s3.uploadFile.mock.calls[0][1];
      expect(second.storedFiles.discardObject).toHaveBeenCalledWith(copyKey);
      expect(second.storedFiles.discardObject).toHaveBeenCalledWith(
        'org/store/records/purchase_order/123/uuid.pdf',
      );
      expect(first.s3.deleteFile).not.toHaveBeenCalled();
      expect(second.s3.deleteFile).not.toHaveBeenCalled();
    });

    it('orden de compra sin tienda resoluble: falla y descarta lo subido', async () => {
      const { service, storedFiles, s3 } = build({ store: null });
      await expect(
        service.saveAttachmentToRecordForAgent(
          input({
            entityType: 'purchase_order',
            record: { id: 123, label: 'OC-123' },
          }),
        ),
      ).rejects.toThrow('No se pudo resolver la tienda');
      expect(s3.uploadFile).not.toHaveBeenCalled();
      expect(storedFiles.discardObject).toHaveBeenCalledWith(
        'org/store/records/purchase_order/123/uuid.pdf',
      );
    });

    it('orden de compra sin tienda en el contexto: no consulta tiendas ni sube la copia', async () => {
      const { service, prisma, s3 } = build();
      await expect(
        service.saveAttachmentToRecordForAgent(
          input({
            entityType: 'purchase_order',
            record: { id: 123, label: 'OC-123' },
            storeId: undefined,
          }),
        ),
      ).rejects.toThrow('No se pudo resolver la tienda');
      expect(prisma.stores.findFirst).not.toHaveBeenCalled();
      expect(s3.uploadFile).not.toHaveBeenCalled();
    });

    it('si la descarga del adjunto falla no abre la transacción ni descarta nada', async () => {
      const { service, prisma, storedFiles, s3 } = build();
      s3.downloadFile.mockRejectedValueOnce(new Error('S3 caído'));
      await expect(
        service.saveAttachmentToRecordForAgent(input()),
      ).rejects.toThrow('S3 caído');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(storedFiles.discardObject).not.toHaveBeenCalled();
    });
  });
});
