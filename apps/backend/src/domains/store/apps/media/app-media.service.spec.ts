import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { AppMediaService } from './app-media.service';

describe('AppMediaService — biblioteca de medios (apps-customization F1.1)', () => {
  const file = (over: Partial<Express.Multer.File> = {}): Express.Multer.File =>
    ({
      originalname: 'fachada local.jpg',
      mimetype: 'image/jpeg',
      size: 120_000,
      buffer: Buffer.from('jpg-bytes'),
      ...over,
    }) as Express.Multer.File;

  function build() {
    const created: any[] = [];
    const prisma = {
      store_app_media: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: created.length + 1, created_at: new Date(), ...data };
          created.push(row);
          return row;
        }),
        findMany: jest.fn(async () => created),
        count: jest.fn(async () => created.length),
        findFirst: jest.fn(async ({ where }: any) => created.find((r) => r.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const row = created.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
        aggregate: jest.fn(async () => ({ _sum: { size_bytes: 0 } })),
        delete: jest.fn(),

      },
    } as any;
    const s3 = {
      uploadImage: jest.fn(async (_buffer: Buffer, key: string) => ({
        key: key.replace(/\.webp$/, '.webp'),
        thumbKey: key.replace(/\.webp$/, '_thumb.webp'),
      })),
      uploadFile: jest.fn(async (_buffer: Buffer, _key: string, _mime: string) => undefined),
      signUrl: jest.fn(async (key: string) => `https://signed.test/${key}`),
      deleteFile: jest.fn(async () => undefined),
    } as any;
    const service = new AppMediaService(prisma, s3);
    return { service, prisma, s3, created };
  }

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(7);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(3);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sube una imagen optimizada, la registra por tienda y devuelve URL firmada', async () => {
    const { service, prisma, s3 } = build();
    const [row] = await service.upload([file()]);

    expect(s3.uploadImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^stores\/7\/apps\/shared\/.+\.webp$/),
      expect.objectContaining({ generateThumbnail: true }),
    );
    expect(prisma.store_app_media.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: 7,
        app_kind: null,
        kind: 'image',
        mime_type: 'image/jpeg',
        created_by_user_id: 3,
        alt: 'fachada local',
      }),
    });
    // URL estable de la API: no vence como una firma.
    expect(row.url).toBe('/public/apps/media/1');
    expect(row.thumb_url).toBe('/public/apps/media/1?thumb=1');
  });

  it('guarda un PDF como documento y respeta la app destino', async () => {
    const { service, s3 } = build();
    const [row] = await service.upload(
      [file({ originalname: 'politicas.pdf', mimetype: 'application/pdf' })],
      'booking' as never,
    );
    expect(s3.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^stores\/7\/apps\/booking\/.+\.pdf$/),
      'application/pdf',
    );
    expect(row.kind).toBe('document');
    expect(row.app_kind).toBe('booking');
  });

  it('rechaza formatos no permitidos y archivos de más de 8 MB', async () => {
    const { service } = build();
    await expect(service.upload([file({ mimetype: 'text/html' })])).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    await expect(
      service.upload([file({ size: 9 * 1024 * 1024, mimetype: 'image/png' })]),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('borrar es lógico: no elimina el archivo que una app publicada ya usa', async () => {
    const { service, prisma, s3, created } = build();
    await service.upload([file()]);
    const id = created[0].id;
    await service.remove(id);
    expect(prisma.store_app_media.update).toHaveBeenCalledWith({
      where: { id },
      data: { deleted_at: expect.any(Date) },
    });
    expect(s3.deleteFile).not.toHaveBeenCalled();
  });

  it('rechaza un PDF que no empieza por %PDF-', async () => {
    const { service } = build();
    await expect(
      service.upload([file({ mimetype: 'application/pdf', buffer: Buffer.from('no soy pdf') })]),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('respeta el techo de 1 GB por tienda', async () => {
    const { service, prisma } = build();
    prisma.store_app_media.aggregate.mockResolvedValue({
      _sum: { size_bytes: 1024 * 1024 * 1024 - 10 },
    });
    await expect(service.upload([file({ size: 5000 })])).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });
});
