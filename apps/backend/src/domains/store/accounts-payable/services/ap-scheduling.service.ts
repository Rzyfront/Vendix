import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ScheduleApPaymentDto } from '../dto/schedule-ap-payment.dto';

@Injectable()
export class ApSchedulingService {
  constructor(private readonly prisma: StorePrismaService) {}

  // ─── SCHEDULE PAYMENT ──────────────────────────────────────
  async schedulePayment(ap_id: number, dto: ScheduleApPaymentDto) {
    const ap = await this.prisma.accounts_payable.findFirst({
      where: { id: ap_id },
    });

    if (!ap) {
      throw new NotFoundException(`Cuenta por pagar #${ap_id} no encontrada`);
    }

    if (ap.status === 'paid' || ap.status === 'written_off') {
      throw new BadRequestException(
        `No se puede programar un pago en una cuenta con estado "${ap.status}"`,
      );
    }

    if (dto.amount > Number(ap.balance)) {
      throw new BadRequestException(
        `El monto programado ($${dto.amount}) excede el saldo pendiente ($${Number(ap.balance)})`,
      );
    }

    return this.prisma.ap_payment_schedules.create({
      data: {
        accounts_payable_id: ap_id,
        scheduled_date: new Date(dto.scheduled_date),
        amount: dto.amount,
        status: 'scheduled',
      },
    });
  }

  // ─── GET SCHEDULED PAYMENTS ────────────────────────────────
  async getScheduledPayments(query: {
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const { page = 1, limit = 20, status } = query;

    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.ap_payment_schedules.findMany({
        where,
        include: {
          accounts_payable: {
            select: {
              id: true,
              document_number: true,
              balance: true,
              supplier_id: true,
              supplier: {
                select: { id: true, name: true },
              },
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { scheduled_date: 'asc' },
      }),
      this.prisma.ap_payment_schedules.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── CANCEL SCHEDULE ───────────────────────────────────────
  async cancelSchedule(schedule_id: number) {
    const schedule = await this.prisma.ap_payment_schedules.findFirst({
      where: { id: schedule_id },
    });

    if (!schedule) {
      throw new NotFoundException(
        `Pago programado #${schedule_id} no encontrado`,
      );
    }

    if (schedule.status !== 'scheduled') {
      throw new BadRequestException(
        `Solo se pueden cancelar pagos con estado "scheduled", estado actual: "${schedule.status}"`,
      );
    }

    return this.prisma.ap_payment_schedules.update({
      where: { id: schedule_id },
      data: { status: 'cancelled' },
    });
  }

  // ─── UPCOMING SCHEDULES ────────────────────────────────────
  async getUpcomingSchedules(days: number = 7) {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return this.prisma.ap_payment_schedules.findMany({
      where: {
        status: 'scheduled',
        scheduled_date: { gte: now, lte: future },
      },
      include: {
        accounts_payable: {
          select: {
            id: true,
            document_number: true,
            balance: true,
            priority: true,
            supplier_id: true,
            supplier: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { scheduled_date: 'asc' },
    });
  }
}
