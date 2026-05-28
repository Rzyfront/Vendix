import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ResponseService } from '../../../common/responses/response.service';
import { S3Service } from '../../../common/services/s3.service';

@Injectable()
export class NotificationSoundsCatalogService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
    private readonly responseService: ResponseService,
  ) {}

  async listActive() {
    const sounds = await this.globalPrisma.notification_sounds.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, s3_key: true, sort_order: true },
    });

    const data = await Promise.all(
      sounds.map(async (sound) => ({
        id: sound.id,
        name: sound.name,
        url: await this.s3Service.signUrl(sound.s3_key),
        sort_order: sound.sort_order,
      })),
    );

    return this.responseService.success(data);
  }
}
