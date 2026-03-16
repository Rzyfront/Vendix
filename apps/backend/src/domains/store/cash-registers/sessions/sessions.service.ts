import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { QuerySessionDto } from '../dto/query-session.dto';
import { MovementsService } from '../movements/movements.service';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly movements_service: MovementsService,
  ) {}

  async getActiveSession(user_id?: number) {
    const context = RequestContextService.getContext()!;
    const where: any = {
      store_id: context.store_id,
      status: 'open',
    };
    if (user_id) {
      where.opened_by = user_id;
    }

    return this.prisma.cash_register_sessions.findFirst({
      where,
      include: {
        register: true,
        opened_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
  }

  async openSession(dto: OpenSessionDto) {
    const context = RequestContextService.getContext()!;

    // Validate cash register exists and is active
    const register = await this.prisma.cash_registers.findFirst({
      where: { id: dto.cash_register_id, is_active: true },
    });
    if (!register) {
      throw new NotFoundException('Cash register not found or inactive');
    }

    // Validate no open session on this register
    const existing_session =
      await this.prisma.cash_register_sessions.findFirst({
        where: {
          cash_register_id: dto.cash_register_id,
          status: 'open',
        },
      });
    if (existing_session) {
      throw new BadRequestException(
        'This cash register already has an open session',
      );
    }

    // Check if user already has an open session (configurable)
    const user_session = await this.prisma.cash_register_sessions.findFirst({
      where: {
        opened_by: context.user_id,
        status: 'open',
      },
    });
    if (user_session) {
      throw new BadRequestException(
        'You already have an open session on another register',
      );
    }

    // Create session + opening_balance movement in transaction
    return this.prisma.$transaction(async (tx: any) => {
      const session = await tx.cash_register_sessions.create({
        data: {
          cash_register_id: dto.cash_register_id,
          store_id: context.store_id,
          opened_by: context.user_id,
          opening_amount: dto.opening_amount,
          status: 'open',
        },
        include: {
          register: true,
          opened_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      });

      // Create opening balance movement
      await tx.cash_register_movements.create({
        data: {
          session_id: session.id,
          store_id: context.store_id,
          user_id: context.user_id,
          type: 'opening_balance',
          amount: dto.opening_amount,
          payment_method: 'cash',
        },
      });

      return session;
    });
  }

  async closeSession(session_id: number, dto: CloseSessionDto) {
    const context = RequestContextService.getContext()!;

    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id, status: 'open' },
    });
    if (!session) {
      throw new NotFoundException('Open session not found');
    }

    // Calculate expected closing amount from movements
    const movements = await this.prisma.cash_register_movements.findMany({
      where: { session_id },
    });

    let expected = Number(session.opening_amount);
    for (const m of movements) {
      const amount = Number(m.amount);
      switch (m.type) {
        case 'sale':
        case 'cash_in':
          expected += amount;
          break;
        case 'refund':
        case 'cash_out':
          expected -= amount;
          break;
      }
    }

    const difference = dto.actual_closing_amount - expected;

    // Generate summary grouped by payment method
    const summary = this.generateSessionSummary(movements);

    return this.prisma.$transaction(async (tx: any) => {
      // Create closing balance movement
      await tx.cash_register_movements.create({
        data: {
          session_id,
          store_id: context.store_id,
          user_id: context.user_id,
          type: 'closing_balance',
          amount: dto.actual_closing_amount,
          payment_method: 'cash',
        },
      });

      // Update session
      const closed_session = await tx.cash_register_sessions.update({
        where: { id: session_id },
        data: {
          status: 'closed',
          closed_by: context.user_id,
          closed_at: new Date(),
          expected_closing_amount: expected,
          actual_closing_amount: dto.actual_closing_amount,
          difference,
          closing_notes: dto.closing_notes,
          summary,
        },
        include: {
          register: true,
          opened_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
          closed_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      });

      return closed_session;
    });
  }

  async suspendSession(session_id: number) {
    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id, status: 'open' },
    });
    if (!session) {
      throw new NotFoundException('Open session not found');
    }

    return this.prisma.cash_register_sessions.update({
      where: { id: session_id },
      data: { status: 'suspended' },
    });
  }

  async findAll(query: QuerySessionDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.cash_register_id)
      where.cash_register_id = query.cash_register_id;
    if (query.date_from || query.date_to) {
      where.opened_at = {};
      if (query.date_from) where.opened_at.gte = new Date(query.date_from);
      if (query.date_to) where.opened_at.lte = new Date(query.date_to);
    }

    const [data, total] = await Promise.all([
      this.prisma.cash_register_sessions.findMany({
        where,
        include: {
          register: { select: { id: true, name: true, code: true } },
          opened_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
          closed_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
        orderBy: { opened_at: query.sort_order || 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.cash_register_sessions.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit },
    };
  }

  async findOne(session_id: number) {
    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id },
      include: {
        register: true,
        opened_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        movements: {
          include: {
            user: { select: { id: true, first_name: true, last_name: true } },
            order: { select: { id: true, order_number: true } },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    return session;
  }

  async getSessionReport(session_id: number) {
    const session = await this.findOne(session_id);

    const movements_by_type = this.groupMovementsByType(session.movements);
    const movements_by_method = this.groupMovementsByPaymentMethod(
      session.movements,
    );

    return {
      session: {
        id: session.id,
        register: session.register,
        opened_by: session.opened_by_user,
        closed_by: session.closed_by_user,
        status: session.status,
        opened_at: session.opened_at,
        closed_at: session.closed_at,
        opening_amount: session.opening_amount,
        expected_closing_amount: session.expected_closing_amount,
        actual_closing_amount: session.actual_closing_amount,
        difference: session.difference,
        closing_notes: session.closing_notes,
      },
      summary: {
        by_type: movements_by_type,
        by_payment_method: movements_by_method,
        total_movements: session.movements.length,
      },
    };
  }

  private generateSessionSummary(movements: any[]) {
    const by_method: Record<string, { count: number; total: number }> = {};
    const by_type: Record<string, { count: number; total: number }> = {};

    for (const m of movements) {
      if (m.type === 'opening_balance' || m.type === 'closing_balance')
        continue;

      const method = m.payment_method || 'unknown';
      if (!by_method[method])
        by_method[method] = { count: 0, total: 0 };
      by_method[method].count++;
      by_method[method].total += Number(m.amount);

      if (!by_type[m.type])
        by_type[m.type] = { count: 0, total: 0 };
      by_type[m.type].count++;
      by_type[m.type].total += Number(m.amount);
    }

    return { by_method, by_type };
  }

  private groupMovementsByType(movements: any[]) {
    const result: Record<string, { count: number; total: number }> = {};
    for (const m of movements) {
      if (!result[m.type]) result[m.type] = { count: 0, total: 0 };
      result[m.type].count++;
      result[m.type].total += Number(m.amount);
    }
    return result;
  }

  private groupMovementsByPaymentMethod(movements: any[]) {
    const result: Record<string, { count: number; total: number }> = {};
    for (const m of movements) {
      if (m.type === 'opening_balance' || m.type === 'closing_balance')
        continue;
      const method = m.payment_method || 'unknown';
      if (!result[method]) result[method] = { count: 0, total: 0 };
      result[method].count++;
      result[method].total += Number(m.amount);
    }
    return result;
  }
}
