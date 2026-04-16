import {
  Injectable,
  BadRequestException,
  NotFoundException,
  MessageEvent,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { QuerySessionDto } from '../dto/query-session.dto';
import { MovementsService } from '../movements/movements.service';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly movements_service: MovementsService,
    private readonly event_emitter: EventEmitter2,
    private readonly aiEngine: AIEngineService,
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
    const session = await this.prisma.$transaction(async (tx: any) => {
      const created_session = await tx.cash_register_sessions.create({
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
          session_id: created_session.id,
          store_id: context.store_id,
          user_id: context.user_id,
          type: 'opening_balance',
          amount: dto.opening_amount,
          payment_method: 'cash',
        },
      });

      return created_session;
    });

    // Emit accounting event
    const store = await this.prisma.stores.findUnique({
      where: { id: session.store_id },
      select: { organization_id: true },
    });
    if (store && Number(dto.opening_amount) > 0) {
      this.event_emitter.emit('cash_register.opened', {
        session_id: session.id,
        store_id: session.store_id,
        organization_id: store.organization_id,
        opening_amount: Number(dto.opening_amount),
        user_id: session.opened_by,
      });
    }

    return session;
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
          if (m.payment_method === 'cash') expected += amount;
          break;
        case 'cash_in':
          expected += amount;
          break;
        case 'refund':
          if (m.payment_method === 'cash') expected -= amount;
          break;
        case 'cash_out':
          expected -= amount;
          break;
      }
    }

    const difference = dto.actual_closing_amount - expected;

    // Generate summary grouped by payment method
    const summary = this.generateSessionSummary(movements);

    const closed_session = await this.prisma.$transaction(async (tx: any) => {
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
      const updated_session = await tx.cash_register_sessions.update({
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

      return updated_session;
    });

    // Emit accounting event
    const store = await this.prisma.stores.findUnique({
      where: { id: closed_session.store_id },
      select: { organization_id: true },
    });
    if (store) {
      this.event_emitter.emit('cash_register.closed', {
        session_id: closed_session.id,
        store_id: closed_session.store_id,
        organization_id: store.organization_id,
        expected_amount: Number(closed_session.expected_closing_amount),
        actual_amount: Number(closed_session.actual_closing_amount),
        difference: Number(closed_session.difference),
        user_id: closed_session.closed_by,
      });
    }

    return closed_session;
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

  streamClosingSummary(sessionId: number): Observable<MessageEvent> {
    // Capture request context before entering the Observable async callback,
    // because AsyncLocalStorage is lost inside the Observable's IIFE.
    const context = RequestContextService.getContext();

    return new Observable<MessageEvent>((subscriber) => {
      const run = async () => {
        try {
          const report = await this.getSessionReport(sessionId);
          const variables = this.buildAISummaryVariables(report);

          try {
            // Try streaming first
            let accumulatedText = '';
            for await (const chunk of this.aiEngine.runStream(
              'cash_register_closing_summary',
              variables,
            )) {
              if (chunk.type === 'text' && chunk.content) {
                accumulatedText += chunk.content;
              }

              if (chunk.type === 'done') {
                if (accumulatedText) {
                  await this.saveAiSummary(sessionId, accumulatedText);
                }
                subscriber.next({
                  data: JSON.stringify(chunk),
                  type: 'ai-chunk',
                } as MessageEvent);
                subscriber.complete();
                return;
              }

              if (chunk.type === 'error') {
                subscriber.next({
                  data: JSON.stringify(chunk),
                  type: 'ai-chunk',
                } as MessageEvent);
                subscriber.complete();
                return;
              }

              subscriber.next({
                data: JSON.stringify(chunk),
                type: 'ai-chunk',
              } as MessageEvent);
            }
            subscriber.complete();
          } catch {
            // Fallback to non-streaming
            try {
              const result = await this.aiEngine.run(
                'cash_register_closing_summary',
                variables,
              );
              if (result.content) {
                await this.saveAiSummary(sessionId, result.content);
              }
              subscriber.next({
                data: JSON.stringify({ type: 'text', content: result.content }),
                type: 'ai-chunk',
              } as MessageEvent);
              subscriber.next({
                data: JSON.stringify({
                  type: 'done',
                  usage: result.usage,
                }),
                type: 'ai-chunk',
              } as MessageEvent);
              subscriber.complete();
            } catch (fallbackError: any) {
              subscriber.next({
                data: JSON.stringify({
                  type: 'error',
                  error: fallbackError.message,
                }),
                type: 'ai-chunk',
              } as MessageEvent);
              subscriber.complete();
            }
          }
        } catch (error: any) {
          subscriber.next({
            data: JSON.stringify({ type: 'error', error: error.message }),
            type: 'ai-chunk',
          } as MessageEvent);
          subscriber.complete();
        }
      };

      // Re-inject the captured request context into the async callback
      if (context) {
        RequestContextService.run(context, () => { run(); });
      } else {
        run();
      }
    });
  }

  private buildAISummaryVariables(report: any): Record<string, string> {
    const s = report.session;
    const summary = report.summary;

    const formatUser = (user: any) =>
      user ? `${user.first_name} ${user.last_name}` : 'N/A';

    const formatDate = (date: any) =>
      date ? new Date(date).toLocaleString('es-CO') : 'N/A';

    const formatDecimal = (value: any) =>
      value != null ? String(Number(value)) : '0';

    const formatGrouped = (grouped: Record<string, { count: number; total: number }>) =>
      Object.entries(grouped)
        .map(([key, val]) => `- ${key}: ${val.count} movimiento(s), total $${val.total}`)
        .join('\n') || 'Sin datos';

    return {
      register_name: s.register?.name || 'N/A',
      opened_by: formatUser(s.opened_by),
      closed_by: formatUser(s.closed_by),
      opened_at: formatDate(s.opened_at),
      closed_at: formatDate(s.closed_at),
      opening_amount: formatDecimal(s.opening_amount),
      expected_closing_amount: formatDecimal(s.expected_closing_amount),
      actual_closing_amount: formatDecimal(s.actual_closing_amount),
      difference: formatDecimal(s.difference),
      closing_notes: s.closing_notes || 'Sin notas',
      summary_by_method: formatGrouped(summary.by_payment_method),
      summary_by_type: formatGrouped(summary.by_type),
      total_movements: String(summary.total_movements),
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

  private async saveAiSummary(sessionId: number, summary: string): Promise<void> {
    try {
      await this.prisma.cash_register_sessions.update({
        where: { id: sessionId },
        data: { ai_summary: summary },
      });
    } catch (error: any) {
      this.logger.error(`Failed to save AI summary for session ${sessionId}: ${error.message}`);
      // Don't throw — saving the summary is best-effort, don't break the stream
    }
  }
}
