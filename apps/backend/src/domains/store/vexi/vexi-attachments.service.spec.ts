import * as AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VexiAttachmentsService } from './vexi-attachments.service';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ctx = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  is_super_admin: false,
  is_owner: false,
};

function build() {
  const prisma = {
    stores: { findFirst: jest.fn(async () => ({ id: 1, slug: 'tienda' })) },
    organizations: { findFirst: jest.fn(async () => ({ id: 2, slug: 'org' })) },
    ai_attachments: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 41,
        original_name: data.original_name,
        mime_type: data.mime_type,
        size_bytes: data.size_bytes,
      })),
      findFirst: jest.fn(),
    },
  };
  const s3 = {
    uploadFile: jest.fn(async () => undefined),
    downloadFile: jest.fn(),
  };
  const service = new VexiAttachmentsService(prisma as never, s3 as never);
  return { service, prisma, s3 };
}

function file(
  buffer: Buffer,
  mimetype: string,
  originalname: string,
  size = buffer.length,
) {
  return { buffer, mimetype, originalname, size } as Express.Multer.File;
}

const run = <T>(fn: () => Promise<T>) =>
  RequestContextService.runIsolated(ctx, fn);

const xlsxBuffer = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a'], ['1']]), 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const docxBuffer = () => {
  const zip = new AdmZip();
  zip.addFile(
    'word/document.xml',
    Buffer.from('<w:p><w:r><w:t>Hola</w:t></w:r></w:p>'),
  );
  return zip.toBuffer();
};

describe('VexiAttachmentsService.store (T41)', () => {
  it.each([
    ['CSV', Buffer.from('a,b\n1,2\n'), 'text/csv', 'a.csv', 'text/csv'],
    ['CSV sent as Excel MIME', Buffer.from('a,b\n1,2\n'), 'application/vnd.ms-excel', 'a.csv', 'text/csv'],
    ['XLSX', xlsxBuffer(), XLSX_MIME, 'a.xlsx', XLSX_MIME],
    ['DOCX', docxBuffer(), DOCX_MIME, 'a.docx', DOCX_MIME],
    ['TXT', Buffer.from('hola'), 'text/plain', 'a.txt', 'text/plain'],
  ])('accepts %s and writes the derived JSON', async (_n, buf, mime, name, stored) => {
    const { service, prisma, s3 } = build();
    const result = await run(() => service.store(file(buf, mime, name)));
    expect(result.attachment_id).toBe('att_41');
    expect(result.mime_type).toBe(stored);

    expect(s3.uploadFile).toHaveBeenCalledTimes(2);
    const [original, derived] = s3.uploadFile.mock.calls as unknown as Array<
      [Buffer, string, string]
    >;
    expect(original[1]).toMatch(
      /^organizations\/org-2\/stores\/tienda-1\/ai-attachments\/[\w-]+\.\w+$/,
    );
    expect(derived[1]).toMatch(/\/ai-attachments\/derived\/[\w-]+\.json$/);
    expect(derived[2]).toBe('application/json');
    expect(prisma.ai_attachments.create.mock.calls[0][0].data).toMatchObject({
      s3_key: original[1],
      derived_text_key: derived[1],
    });
  });

  it('still accepts the JPEG and PDF that Vexi accepted before', async () => {
    const { service } = build();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    await expect(
      run(() => service.store(file(jpeg, 'image/jpeg', 'f.jpg'))),
    ).resolves.toMatchObject({ mime_type: 'image/jpeg' });
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    await expect(
      run(() => service.store(file(pdf, 'application/pdf', 'f.pdf'))),
    ).resolves.toMatchObject({ mime_type: 'application/pdf' });
  });

  it('rejects a .xlsx whose bytes are not a ZIP', async () => {
    const { service, s3 } = build();
    await expect(
      run(() =>
        service.store(file(Buffer.from('plain text'), XLSX_MIME, 'a.xlsx')),
      ),
    ).rejects.toThrow(/no coincide con su extensión/);
    expect(s3.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects files over 10 MB and unsupported types, citing the shared label', async () => {
    const { service } = build();
    await expect(
      run(() =>
        service.store(
          file(Buffer.from('a'), 'text/plain', 'a.txt', 11 * 1024 * 1024),
        ),
      ),
    ).rejects.toThrow(/máximo son 10 MB/);
    await expect(
      run(() =>
        service.store(file(Buffer.from('a'), 'application/zip', 'a.zip')),
      ),
    ).rejects.toThrow(/Fotos \(JPG, PNG, WEBP, HEIC\), PDF, Excel \(XLSX\)/);
    await expect(
      run(() =>
        service.store(
          file(Buffer.from('a'), 'application/vnd.ms-excel', 'a.xls'),
        ),
      ),
    ).rejects.toThrow(/no se puede leer/);
  });

  it('an extraction/upload failure of the derived JSON does not fail the upload', async () => {
    const { service, prisma, s3 } = build();
    s3.uploadFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('s3 down'));
    await run(() =>
      service.store(file(Buffer.from('hola'), 'text/plain', 'a.txt')),
    );
    expect(prisma.ai_attachments.create.mock.calls[0][0].data).toMatchObject({
      derived_text_key: null,
    });
  });
});

describe('VexiAttachmentsService.readContent', () => {
  it('reads the derived JSON when present', async () => {
    const { service, prisma, s3 } = build();
    const content = {
      kind: 'text',
      original_name: 'a.txt',
      mime_type: 'text/plain',
      text: 'hola',
    };
    prisma.ai_attachments.findFirst.mockResolvedValue({
      id: 41,
      s3_key: 'o.txt',
      mime_type: 'text/plain',
      original_name: 'a.txt',
      derived_text_key: 'd.json',
    });
    s3.downloadFile.mockResolvedValue(Buffer.from(JSON.stringify(content)));
    await expect(service.readContent('att_41')).resolves.toEqual(content);
    expect(s3.downloadFile).toHaveBeenCalledWith('d.json');
  });

  it('extracts on the fly for legacy rows without writing', async () => {
    const { service, prisma, s3 } = build();
    prisma.ai_attachments.findFirst.mockResolvedValue({
      id: 41,
      s3_key: 'o.csv',
      mime_type: 'text/csv',
      original_name: 'a.csv',
      derived_text_key: null,
    });
    s3.downloadFile.mockResolvedValue(Buffer.from('x,y\n1,2\n'));
    const out = await service.readContent('att_41');
    expect(out).toMatchObject({ kind: 'table' });
    expect(s3.uploadFile).not.toHaveBeenCalled();
  });
});

describe('VexiAttachmentsService · métodos para el agente (T44)', () => {
  it('findAttachmentForAgent devuelve la fila con su archivo promovido', async () => {
    const { service, prisma } = build();
    const row = {
      id: 41,
      s3_key: 'org/store/ai-attachments/abc.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2048,
      original_name: 'factura.pdf',
      stored_file_id: 31,
    };
    prisma.ai_attachments.findFirst.mockResolvedValue(row);
    await expect(service.findAttachmentForAgent(41)).resolves.toEqual(row);
    expect(prisma.ai_attachments.findFirst).toHaveBeenCalledWith({
      where: { id: 41 },
      select: {
        id: true,
        s3_key: true,
        mime_type: true,
        size_bytes: true,
        original_name: true,
        stored_file_id: true,
      },
    });
  });

  it('findAttachmentForAgent devuelve null si el adjunto no es de esta tienda', async () => {
    const { service, prisma } = build();
    prisma.ai_attachments.findFirst.mockResolvedValue(null);
    await expect(service.findAttachmentForAgent(999)).resolves.toBeNull();
  });

  it('markSavedToRecordForAgent estampa registro y archivo dentro de la transacción recibida', async () => {
    const { service, prisma } = build();
    const tx = {
      ai_attachments: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await service.markSavedToRecordForAgent(tx, {
      attachmentId: 41,
      entityType: 'customer',
      entityId: 5,
      storedFileId: 77,
    });
    expect(tx.ai_attachments.updateMany).toHaveBeenCalledWith({
      where: { id: 41 },
      data: {
        linked_entity_type: 'customer',
        linked_entity_id: 5,
        linked_at: expect.any(Date),
        stored_file_id: 77,
      },
    });
    expect(prisma.ai_attachments.create).not.toHaveBeenCalled();
  });
});
