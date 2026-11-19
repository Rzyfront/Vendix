import { VideoLibraryAdminService } from './video-library-admin.service';
import { VideoSourceTypeEnum } from './dto';

const OLD_ID = 'dQw4w9WgXcQ';
const NEW_ID = 'kJQP7kiw5Fk';
const ytThumb = (id: string) => `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;

const storedVideo = {
  id: 1,
  title: 'Configuración Inicial de tu Tienda en Vendix',
  video_url: `https://www.youtube.com/watch?v=${OLD_ID}`,
  video_source: 'YOUTUBE',
  external_id: OLD_ID,
  thumbnail_url: ytThumb(OLD_ID),
};

describe('VideoLibraryAdminService', () => {
  let service: VideoLibraryAdminService;
  let prisma: {
    videos: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let s3Service: { sanitizeForStorage: jest.Mock; signUrl: jest.Mock };

  beforeEach(() => {
    prisma = {
      videos: {
        findUnique: jest.fn().mockResolvedValue(storedVideo),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }) => ({ ...storedVideo, ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    // External URLs are stored as-is.
    s3Service = {
      sanitizeForStorage: jest.fn((url: string) => url),
      signUrl: jest.fn(),
    };
    service = new VideoLibraryAdminService(prisma as any, s3Service as any);
  });

  const updateData = () => prisma.videos.update.mock.calls[0][0].data;

  describe('updateVideo — changing the video URL', () => {
    it('uses the new YouTube ID and thumbnail when the form carries the old ID and auto thumbnail', async () => {
      await service.updateVideo(1, {
        video_url: `https://youtu.be/${NEW_ID}`,
        external_id: OLD_ID,
        video_source: VideoSourceTypeEnum.YOUTUBE,
        thumbnail_url: ytThumb(OLD_ID),
      });

      expect(updateData()).toMatchObject({
        video_url: `https://youtu.be/${NEW_ID}`,
        external_id: NEW_ID,
        video_source: VideoSourceTypeEnum.YOUTUBE,
        thumbnail_url: ytThumb(NEW_ID),
      });
    });

    it('swaps the stored auto thumbnail when the form does not send one', async () => {
      await service.updateVideo(1, { video_url: `https://www.youtube.com/watch?v=${NEW_ID}` });

      expect(updateData()).toMatchObject({
        external_id: NEW_ID,
        thumbnail_url: ytThumb(NEW_ID),
      });
    });

    it('switches platform and ID to Loom when the new URL is a Loom link', async () => {
      await service.updateVideo(1, {
        video_url: 'https://www.loom.com/share/abc123def456',
        external_id: OLD_ID,
        video_source: VideoSourceTypeEnum.YOUTUBE,
      });

      expect(updateData()).toMatchObject({
        external_id: 'abc123def456',
        video_source: VideoSourceTypeEnum.LOOM,
      });
    });

    it('switches platform and ID to Vimeo when the new URL is a Vimeo link', async () => {
      await service.updateVideo(1, {
        video_url: 'https://vimeo.com/76979871',
        external_id: OLD_ID,
        video_source: VideoSourceTypeEnum.YOUTUBE,
      });

      expect(updateData()).toMatchObject({
        external_id: '76979871',
        video_source: VideoSourceTypeEnum.VIMEO,
      });
    });

    it('respects an external ID typed by hand that differs from the stored one', async () => {
      await service.updateVideo(1, {
        video_url: `https://youtu.be/${NEW_ID}`,
        external_id: 'manualId123',
      });

      expect(updateData().external_id).toBe('manualId123');
    });

    it('keeps a custom uploaded thumbnail', async () => {
      const custom = 'video-library/thumbnails/custom.webp';
      prisma.videos.findUnique.mockResolvedValue({ ...storedVideo, thumbnail_url: custom });

      await service.updateVideo(1, {
        video_url: `https://youtu.be/${NEW_ID}`,
        external_id: OLD_ID,
        thumbnail_url: custom,
      });

      expect(updateData().thumbnail_url).toBe(custom);
      expect(updateData().external_id).toBe(NEW_ID);
    });
  });

  describe('updateVideo — URL unchanged', () => {
    it('keeps external ID, platform and thumbnail when only the title changes', async () => {
      await service.updateVideo(1, {
        title: 'Nuevo título',
        video_url: storedVideo.video_url,
        external_id: OLD_ID,
        video_source: VideoSourceTypeEnum.YOUTUBE,
        thumbnail_url: ytThumb(OLD_ID),
      });

      expect(updateData()).toMatchObject({
        title: 'Nuevo título',
        external_id: OLD_ID,
        video_source: VideoSourceTypeEnum.YOUTUBE,
        thumbnail_url: ytThumb(OLD_ID),
      });
    });
  });

  describe('findAllVideos — search', () => {
    const titlesOf = (result: { data: { title: string }[] }) => result.data.map((v) => v.title);
    const searchOr = () => prisma.videos.findMany.mock.calls[0][0].where.OR as unknown[];

    it('matches each meaningful word of a long query, not only the literal phrase', async () => {
      await service.findAllVideos({ search: 'Punto de Venta POS' });

      expect(searchOr()).toEqual(
        expect.arrayContaining([
          { title: { contains: 'Punto de Venta POS', mode: 'insensitive' } },
          { title: { contains: 'punto', mode: 'insensitive' } },
          { title: { contains: 'venta', mode: 'insensitive' } },
          { title: { contains: 'pos', mode: 'insensitive' } },
        ]),
      );
      // Stopwords are not used as search terms.
      expect(searchOr()).not.toContainEqual({ title: { contains: 'de', mode: 'insensitive' } });
    });

    it('orders results by relevance to the query', async () => {
      prisma.videos.findMany.mockResolvedValue([
        { id: 2, title: 'Operación Completa del Punto de Venta (POS)', tags: [], keywords: [] },
        { id: 1, title: 'Configuración Inicial de tu Tienda en Vendix', tags: [], keywords: [] },
      ]);

      const result = await service.findAllVideos({ search: 'Configuración de tu Tienda' });

      expect(titlesOf(result)[0]).toBe('Configuración Inicial de tu Tienda en Vendix');
    });

    it('keeps status and category filters alongside the search', async () => {
      await service.findAllVideos({ search: 'crear cliente', status: 'PUBLISHED', category: 'ventas' } as any);

      const where = prisma.videos.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('PUBLISHED');
      expect(where.category).toEqual({ slug: 'ventas' });
      expect(where.OR).toEqual(
        expect.arrayContaining([{ title: { contains: 'crear cliente', mode: 'insensitive' } }]),
      );
    });

    it('keeps the default order when there is no search', async () => {
      await service.findAllVideos({});

      const args = prisma.videos.findMany.mock.calls[0][0];
      expect(args.where.OR).toBeUndefined();
      expect(args.orderBy).toEqual([{ sort_order: 'asc' }, { created_at: 'desc' }]);
    });
  });
});
