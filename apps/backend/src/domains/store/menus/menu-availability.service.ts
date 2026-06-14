import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateAvailabilityWindowDto,
  UpdateAvailabilityWindowDto,
} from './dto';

@Injectable()
export class MenuAvailabilityService {
  constructor(private prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return storeId;
  }

  private timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  private assertValidRange(start_time: string, end_time: string) {
    const start = this.timeToMinutes(start_time);
    const end = this.timeToMinutes(end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new VendixHttpException(ErrorCodes.MENU_AVAILABILITY_INVALID_TIME);
    }
  }

  async listForMenu(menuId: number) {
    const storeId = this.requireStoreId();
    return this.prisma.menu_availability_windows.findMany({
      where: { store_id: storeId, menu_id: menuId, menu_section_id: null },
      orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }],
    });
  }

  async create(menuId: number, dto: CreateAvailabilityWindowDto) {
    const storeId = this.requireStoreId();
    this.assertValidRange(dto.start_time, dto.end_time);

    const menu = await this.prisma.menus.findFirst({
      where: { id: menuId, store_id: storeId },
      select: { id: true },
    });
    if (!menu) throw new VendixHttpException(ErrorCodes.MENU_NOT_FOUND);

    let sectionId: number | null = null;
    if (dto.menu_section_id != null) {
      const section = await this.prisma.menu_sections.findFirst({
        where: { id: dto.menu_section_id, store_id: storeId, menu_id: menuId },
        select: { id: true },
      });
      if (!section)
        throw new VendixHttpException(ErrorCodes.MENU_SECTION_NOT_FOUND);
      sectionId = section.id;
    }

    return this.prisma.menu_availability_windows.create({
      data: {
        store_id: storeId,
        menu_id: menuId,
        menu_section_id: sectionId,
        day_of_week: dto.day_of_week,
        start_time: dto.start_time,
        end_time: dto.end_time,
      },
    });
  }

  async update(id: number, dto: UpdateAvailabilityWindowDto) {
    const storeId = this.requireStoreId();
    const window = await this.prisma.menu_availability_windows.findFirst({
      where: { id, store_id: storeId },
    });
    if (!window)
      throw new VendixHttpException(ErrorCodes.MENU_AVAILABILITY_NOT_FOUND);

    if (dto.start_time && dto.end_time) {
      this.assertValidRange(dto.start_time, dto.end_time);
    } else if (dto.start_time || dto.end_time) {
      const start = dto.start_time ?? window.start_time;
      const end = dto.end_time ?? window.end_time;
      this.assertValidRange(start, end);
    }

    return this.prisma.menu_availability_windows.update({
      where: { id },
      data: { ...dto, updated_at: new Date() },
    });
  }

  async delete(id: number) {
    const storeId = this.requireStoreId();
    const window = await this.prisma.menu_availability_windows.findFirst({
      where: { id, store_id: storeId },
    });
    if (!window)
      throw new VendixHttpException(ErrorCodes.MENU_AVAILABILITY_NOT_FOUND);
    await this.prisma.menu_availability_windows.delete({ where: { id } });
    return { deleted: true };
  }
}
