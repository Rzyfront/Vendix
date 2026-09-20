import { NotFoundException } from '@nestjs/common';
import { VideoLibraryService } from './video-library.service';

describe('VideoLibraryService', () => {
  let service: VideoLibraryService;
  let prisma: {
    videos: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    video_categories: {
      findMany: jest.Mock;
    };
  };
  let s3Service: {
    getSignedUrl: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      videos: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      video_categories: {
        findMany: jest.fn(),
      },
    };

    s3Service = {
      getSignedUrl: jest.fn(),
    };

    service = new VideoLibraryService(prisma as any, s3Service as any);
  });

  describe('incrementView', () => {
    it('incrementa atómicamente el contador de vistas', async () => {
      prisma.videos.update.mockResolvedValue({ id: 1, view_count: 5 });

      const result = await service.incrementView(1);

      expect(prisma.videos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { view_count: { increment: 1 } },
        select: { id: true, view_count: true },
      });
      expect(result).toEqual({ view_count: 5 });
    });
  });

  describe('toggleLike', () => {
    it('incrementa atómicamente like_count cuando liked no es false', async () => {
      prisma.videos.update.mockResolvedValue({ id: 1, like_count: 10 });

      const result = await service.toggleLike(1);

      expect(prisma.videos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { like_count: { increment: 1 } },
        select: { id: true, like_count: true },
      });
      expect(result).toEqual({ like_count: 10 });
    });

    it('decrementa atómicamente like_count cuando liked es false y el conteo es mayor a 0', async () => {
      prisma.videos.findUnique.mockResolvedValue({ id: 1, like_count: 3 });
      prisma.videos.update.mockResolvedValue({ id: 1, like_count: 2 });

      const result = await service.toggleLike(1, false);

      expect(prisma.videos.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: { id: true, like_count: true },
      });
      expect(prisma.videos.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { like_count: { decrement: 1 } },
        select: { id: true, like_count: true },
      });
      expect(result).toEqual({ like_count: 2 });
    });

    it('no decrementa por debajo de 0 si like_count ya es 0', async () => {
      prisma.videos.findUnique.mockResolvedValue({ id: 1, like_count: 0 });

      const result = await service.toggleLike(1, false);

      expect(prisma.videos.findUnique).toHaveBeenCalled();
      expect(prisma.videos.update).not.toHaveBeenCalled();
      expect(result).toEqual({ like_count: 0 });
    });

    it('lanza NotFoundException si el video no existe al decrementar', async () => {
      prisma.videos.findUnique.mockResolvedValue(null);

      await expect(service.toggleLike(999, false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza NotFoundException si el update falla con P2025 al incrementar', async () => {
      const error: any = new Error('Record not found');
      error.code = 'P2025';
      prisma.videos.update.mockRejectedValue(error);

      await expect(service.toggleLike(999)).rejects.toThrow(NotFoundException);
    });
  });
});
