import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: StorePrismaService) { }

  async create(data: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    return this.prisma.store_settings.create({
      data: {
        ...data,
        store_id: store_id
      }
    });
  }

  async findAll() {
    // Auto-scoped
    return this.prisma.store_settings.findMany();
  }

  async findOne(id: number) {
    // Auto-scoped
    const setting = await this.prisma.store_settings.findFirst({
      where: { id }
    });
    if (!setting) throw new NotFoundException('Setting not found');
    return setting;
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.store_settings.update({
      where: { id },
      data
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.store_settings.delete({
      where: { id }
    });
  }
}
