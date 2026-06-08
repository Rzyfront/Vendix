import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ResponseService } from '../../../common/responses/response.service';
import { S3Service } from '../../../common/services/s3.service';
import { S3PathHelper } from '../../../common/helpers/s3-path.helper';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { CreateNotificationSoundDto } from './dto/create-notification-sound.dto';
import { UpdateNotificationSoundDto } from './dto/update-notification-sound.dto';

const ALLOWED_MIME = 'audio/mpeg';
const MAX_SIZE_BYTES = 300 * 1024; // 307200 bytes

@Injectable()
export class NotificationSoundsService {
  private readonly logger = new Logger(NotificationSoundsService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
  ) {}

  async create(
    file: Express.Multer.File | undefined,
    dto: CreateNotificationSoundDto,
  ) {
    if (!file) {
      throw new VendixHttpException(
        ErrorCodes.NOTIFICATION_SOUND_INVALID,
        'Archivo de sonido requerido.',
      );
    }

    if (file.mimetype !== ALLOWED_MIME) {
      throw new VendixHttpException(
        ErrorCodes.NOTIFICATION_SOUND_INVALID,
        'El sonido debe ser un archivo MP3 (audio/mpeg).',
      );
    }

    if (file.size > MAX_SIZE_BYTES) {
      throw new VendixHttpException(
        ErrorCodes.NOTIFICATION_SOUND_INVALID,
        `El sonido excede el tamaño máximo permitido (${MAX_SIZE_BYTES} bytes).`,
      );
    }

    const basePath = this.s3PathHelper.buildNotificationSoundsPath();
    const key = `${basePath}/${randomUUID()}.mp3`;

    await this.s3Service.uploadFile(file.buffer, key, ALLOWED_MIME);

    const sound = await this.globalPrisma.notification_sounds.create({
      data: {
        name: dto.name,
        s3_key: key,
        mime_type: ALLOWED_MIME,
        file_size_bytes: file.size,
        sort_order: dto.sort_order ?? 0,
      },
    });

    const signed = await this.toSignedPayload(sound);
    return this.responseService.created(signed, 'Sonido creado correctamente');
  }

  async findAll(query: { isActive?: boolean; page?: number; limit?: number; search?: string } = {}) {
    const where: Record<string, unknown> = {};
    if (typeof query.isActive === 'boolean') {
      where.is_active = query.isActive;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' as const } },
        { key: { contains: query.search, mode: 'insensitive' as const } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;

    const [sounds, total] = await Promise.all([
      this.globalPrisma.notification_sounds.findMany({
        where,
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      this.globalPrisma.notification_sounds.count({ where }),
    ]);

    const data = await Promise.all(
      sounds.map((sound: any) => this.toSignedPayload(sound)),
    );

    return this.responseService.paginated(data, total, page, limit);
  }

  async findOne(id: string) {
    const sound = await this.findOrFail(id);
    const signed = await this.toSignedPayload(sound);
    return this.responseService.success(signed);
  }

  async update(id: string, dto: UpdateNotificationSoundDto) {
    await this.findOrFail(id);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.sort_order !== undefined) {
      data.sort_order = dto.sort_order;
    }

    const updated = await this.globalPrisma.notification_sounds.update({
      where: { id },
      data,
    });

    const signed = await this.toSignedPayload(updated);
    return this.responseService.updated(
      signed,
      'Sonido actualizado correctamente',
    );
  }

  async toggleActive(id: string) {
    const sound = await this.findOrFail(id);

    const updated = await this.globalPrisma.notification_sounds.update({
      where: { id },
      data: { is_active: !sound.is_active },
    });

    const signed = await this.toSignedPayload(updated);
    return this.responseService.updated(
      signed,
      updated.is_active ? 'Sonido activado' : 'Sonido desactivado',
    );
  }

  async remove(id: string) {
    const sound = await this.findOrFail(id);

    // Reference check against store_settings.notifications.sound_id
    const refs = await this.globalPrisma.store_settings.findMany({
      where: {
        settings: { path: ['notifications', 'sound_id'], equals: id } as any,
      },
      select: { store_id: true },
    });

    if (refs.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.NOTIFICATION_SOUND_IN_USE,
        `Sonido referenciado por ${refs.length} tienda(s). Desactívalo en lugar de eliminarlo.`,
      );
    }

    // Try to delete S3 object first; if it fails we still proceed (DB is the source of truth)
    try {
      await this.s3Service.deleteFile(sound.s3_key);
    } catch (error: any) {
      this.logger.warn(
        `Failed to delete notification sound S3 object (key=${sound.s3_key}): ${error?.message ?? error}`,
      );
    }

    await this.globalPrisma.notification_sounds.delete({
      where: { id },
    });

    return this.responseService.deleted('Sonido eliminado correctamente');
  }

  private async findOrFail(id: string) {
    const sound = await this.globalPrisma.notification_sounds.findUnique({
      where: { id },
    });

    if (!sound) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Sonido no encontrado.',
      );
    }

    return sound;
  }

  private async toSignedPayload(sound: any) {
    const url = await this.s3Service.signUrl(sound.s3_key);
    return {
      ...sound,
      url,
    };
  }
}
