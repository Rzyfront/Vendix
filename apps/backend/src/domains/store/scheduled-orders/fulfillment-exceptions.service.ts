import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  CreateFulfillmentExceptionDto,
  UpdateFulfillmentExceptionDto,
} from './dto/fulfillment-exceptions.dto';

/** CRUD de excepciones por fecha de la agenda de cumplimiento. */
@Injectable()
export class FulfillmentExceptionsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private storeId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  private assertHours(dto: UpdateFulfillmentExceptionDto) {
    if (!!dto.start_time !== !!dto.end_time || (dto.start_time && dto.end_time && dto.start_time >= dto.end_time)) {
      throw new VendixHttpException(
        ErrorCodes.SCHED_INVALID_RANGE,
        'El horario especial necesita hora de inicio y de fin, y el fin debe ser posterior.',
      );
    }
  }

  findAll(from?: string, to?: string) {
    return this.prisma.fulfillment_schedule_exceptions.findMany({
      where: {
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
                ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  async create(dto: CreateFulfillmentExceptionDto) {
    this.assertHours(dto);
    const store_id = this.storeId();
    const date = new Date(`${dto.date}T00:00:00.000Z`);
    const data = {
      is_closed: dto.is_closed ?? false,
      start_time: dto.start_time ?? null,
      end_time: dto.end_time ?? null,
      slot_capacity: dto.slot_capacity ?? null,
      day_capacity: dto.day_capacity ?? null,
      reason: dto.reason ?? null,
    };
    // Una excepción por fecha: crear sobre una fecha existente la reemplaza.
    const existing = await this.prisma.fulfillment_schedule_exceptions.findFirst({
      where: { date },
    });
    if (existing) {
      return this.prisma.fulfillment_schedule_exceptions.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.fulfillment_schedule_exceptions.create({
      data: { store_id, date, ...data },
    });
  }

  async update(id: number, dto: UpdateFulfillmentExceptionDto) {
    const existing = await this.prisma.fulfillment_schedule_exceptions.findFirst({
      where: { id },
    });
    if (!existing) throw new VendixHttpException(ErrorCodes.SCHED_EXCEPTION_NOT_FOUND);
    this.assertHours({
      start_time: dto.start_time ?? existing.start_time ?? undefined,
      end_time: dto.end_time ?? existing.end_time ?? undefined,
    });
    const { date, ...rest } = dto;
    return this.prisma.fulfillment_schedule_exceptions.update({
      where: { id },
      data: { ...rest, ...(date ? { date: new Date(`${date}T00:00:00.000Z`) } : {}) },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.fulfillment_schedule_exceptions.findFirst({
      where: { id },
    });
    if (!existing) throw new VendixHttpException(ErrorCodes.SCHED_EXCEPTION_NOT_FOUND);
    await this.prisma.fulfillment_schedule_exceptions.delete({ where: { id } });
    return { id };
  }
}
