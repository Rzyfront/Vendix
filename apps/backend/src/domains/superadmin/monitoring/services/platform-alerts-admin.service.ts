import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PlatformIncidentService } from '../../../../common/incidents/platform-incident.service';
import { PlatformAlertService } from '../../../../common/platform-alerts/platform-alert.service';
import { TelegramNotifierService } from '../../../../common/platform-alerts/telegram-notifier.service';
import type { PlatformAlertRow } from '../../../../common/platform-alerts/platform-alert.types';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import type {
  PlatformAlertsQueryDto,
  PlatformTestAlertDto,
} from '../dto/platform-alerts-query.dto';

/** Lo que ve Superadmin de una alerta (contrato del frontend). */
export interface PlatformAlertView {
  id: number;
  source: string;
  process: string;
  error_type: string;
  severity: string;
  status: string;
  title: string;
  message: string | null;
  details: unknown;
  organization_id: number | null;
  store_id: number | null;
  affected_store_ids: number[];
  occurrences: number;
  first_seen_at: Date;
  last_seen_at: Date;
  escalated_at: Date | null;
  resolved_at: Date | null;
  resolution: string | null;
  ticket_number: string | null;
  ticket_status: string | null;
  telegram_sent: boolean;
}

export interface PlatformAlertsStats {
  open_critical: number;
  open_warning: number;
  open_info: number;
  last_24h: number;
  telegram_enabled: boolean;
  email_recipients: number;
}

export interface PlatformTestAlertResult {
  alert_id: number;
  occurrences: number;
  ticket_number: string | null;
  telegram_sent: boolean;
}

/**
 * Vista de Superadmin del bot de monitoreo (QUI-1010, S5): lista, detalle,
 * estado del ticket, resolución manual y alerta de prueba.
 */
@Injectable()
export class PlatformAlertsAdminService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly alerts: PlatformAlertService,
    private readonly telegram: TelegramNotifierService,
    private readonly incidents: PlatformIncidentService,
  ) {}

  async list(
    query: PlatformAlertsQueryDto,
  ): Promise<{ data: PlatformAlertView[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.platform_alertsWhereInput = {};
    const status = query.status ?? 'open';
    if (status !== 'all') where.status = status;
    if (query.severity) where.severity = query.severity;
    if (query.source) where.source = query.source;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { process: { contains: search, mode: 'insensitive' } },
        { error_type: { contains: search, mode: 'insensitive' } },
        { ticket_number: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.platform_alerts.findMany({
        where,
        orderBy: [{ last_seen_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.platform_alerts.count({ where }),
    ]);
    return { data: await this.toViews(rows), total, page, limit };
  }

  async stats(now = new Date()): Promise<PlatformAlertsStats> {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [open, last24h, recipients] = await Promise.all([
      this.prisma.platform_alerts.groupBy({
        by: ['severity'],
        where: { status: 'open' },
        _count: { _all: true },
      }),
      this.prisma.platform_alerts.count({
        where: { last_seen_at: { gte: since } },
      }),
      this.incidents.resolveRecipients().catch(() => [] as string[]),
    ]);
    const openBy = (severity: string) =>
      open.find((g) => g.severity === severity)?._count._all ?? 0;
    return {
      open_critical: openBy('critical'),
      open_warning: openBy('warning'),
      open_info: openBy('info'),
      last_24h: last24h,
      telegram_enabled: this.telegram.isEnabled(),
      email_recipients: recipients.length,
    };
  }

  async findOne(id: number): Promise<PlatformAlertView> {
    const row = await this.prisma.platform_alerts.findUnique({ where: { id } });
    if (!row) throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    const [view] = await this.toViews([row]);
    return view;
  }

  async resolve(id: number, userId: number | null): Promise<PlatformAlertView> {
    const row = await this.alerts.resolve(id, 'manual', userId);
    if (!row) throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    const [view] = await this.toViews([row]);
    return view;
  }

  async sendTest(
    dto: PlatformTestAlertDto,
    userId: number | null,
  ): Promise<PlatformTestAlertResult> {
    const { alert } = await this.alerts.sendTestAlert(dto.severity, userId);
    return {
      alert_id: alert.id,
      occurrences: alert.occurrences,
      ticket_number: alert.ticket_number,
      telegram_sent: alert.telegram_message_id !== null,
    };
  }

  private async toViews(rows: PlatformAlertRow[]): Promise<PlatformAlertView[]> {
    const numbers = [
      ...new Set(
        rows.map((r) => r.ticket_number).filter((n): n is string => !!n),
      ),
    ];
    const tickets =
      numbers.length > 0
        ? await this.prisma.support_tickets.findMany({
            where: { ticket_number: { in: numbers } },
            select: { ticket_number: true, status: true },
          })
        : [];
    const statusOf = new Map(
      tickets.map((t) => [t.ticket_number, String(t.status)]),
    );
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      process: row.process,
      error_type: row.error_type,
      severity: row.severity,
      status: row.status,
      title: row.title,
      message: row.message,
      details: row.details ?? null,
      organization_id: row.organization_id,
      store_id: row.store_id,
      affected_store_ids: row.affected_store_ids ?? [],
      occurrences: row.occurrences,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      escalated_at: row.escalated_at,
      resolved_at: row.resolved_at,
      resolution: row.resolution,
      ticket_number: row.ticket_number,
      ticket_status: row.ticket_number
        ? (statusOf.get(row.ticket_number) ?? null)
        : null,
      telegram_sent: row.telegram_message_id !== null,
    }));
  }
}
