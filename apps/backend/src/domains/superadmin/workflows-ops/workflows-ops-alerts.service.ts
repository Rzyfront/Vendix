import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { EmailService } from '../../../email/email.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  ALERT_CRON,
  ALERT_DEDUPE_KEY_PREFIX,
  ALERT_DEDUPE_TTL_SECONDS,
  ALERT_LOCK_KEY,
  ALERT_LOCK_TTL_SECONDS,
  BACKLOG_LAG_SECONDS,
  DEAD_LETTERS_PER_HOUR,
  LATENCY_P95_SECONDS,
  STALLED_HEARTBEAT_SECONDS,
  WEBHOOK_DEAD_PER_HOUR,
  WEBHOOK_FAILED_SHARE,
  WEBHOOK_MIN_DELIVERIES_PER_HOUR,
  type AlertRule,
} from './workflows-ops.constants';
import {
  WorkflowsOpsMetricsService,
  type WorkflowOpsSignals,
} from './workflows-ops-metrics.service';

export type AlertSeverity = 'warning' | 'critical';

interface AlertCandidate {
  rule: AlertRule;
  severity: AlertSeverity;
  title: string;
  /** Plain Spanish lines with the numbers that tripped the rule. */
  lines: string[];
  details: Record<string, number | null>;
}

const minutes = (seconds: number) => Math.round(seconds / 60);

/** Pure: which rules the current signals trip. Only counts and ages, never store data. */
export function evaluateRules(s: WorkflowOpsSignals): AlertCandidate[] {
  const out: AlertCandidate[] = [];

  const stalled =
    s.backlog_due > 0 &&
    (s.heartbeat_age_seconds === null || s.heartbeat_age_seconds > STALLED_HEARTBEAT_SECONDS);
  if (stalled) {
    out.push({
      rule: 'dispatcher_stalled',
      severity: 'critical',
      title: 'El despachador de Flujos no está procesando la cola',
      lines: [
        s.heartbeat_age_seconds === null
          ? 'No hay registro de ningún ciclo reciente del despachador.'
          : `El último ciclo fue hace ${minutes(s.heartbeat_age_seconds)} min.`,
        `Hay ${s.backlog_due} tarea(s) vencida(s) esperando.`,
      ],
      details: {
        heartbeat_age_seconds: s.heartbeat_age_seconds,
        backlog_due: s.backlog_due,
      },
    });
  }

  if (s.oldest_due_age_seconds !== null && s.oldest_due_age_seconds > BACKLOG_LAG_SECONDS) {
    out.push({
      rule: 'backlog_lag',
      severity: 'warning',
      title: 'La cola de Flujos tiene atraso',
      lines: [
        `La tarea vencida más antigua espera hace ${minutes(s.oldest_due_age_seconds)} min.`,
        `Pendientes vencidas: ${s.backlog_due}.`,
      ],
      details: {
        oldest_due_age_seconds: Math.round(s.oldest_due_age_seconds),
        backlog_due: s.backlog_due,
      },
    });
  }

  if (s.dead_outbox_1h >= DEAD_LETTERS_PER_HOUR) {
    out.push({
      rule: 'dead_letters',
      severity: 'warning',
      title: 'Hay tareas de Flujos que fallaron definitivamente',
      lines: [`${s.dead_outbox_1h} tarea(s) agotaron sus reintentos en la última hora.`],
      details: { dead_1h: s.dead_outbox_1h },
    });
  }

  const failedShare = s.webhooks_1h_total > 0 ? s.webhooks_1h_failed / s.webhooks_1h_total : 0;
  const webhookRate =
    s.webhooks_1h_total >= WEBHOOK_MIN_DELIVERIES_PER_HOUR && failedShare >= WEBHOOK_FAILED_SHARE;
  if (webhookRate || s.webhooks_dead_1h >= WEBHOOK_DEAD_PER_HOUR) {
    out.push({
      rule: 'webhook_failures',
      severity: 'warning',
      title: 'Fallan los webhooks de salida de Flujos',
      lines: [
        `Entregas de la última hora: ${s.webhooks_1h_total}, con fallo: ${s.webhooks_1h_failed} (${Math.round(failedShare * 100)} %).`,
        `Entregas agotadas (sin más reintentos): ${s.webhooks_dead_1h}.`,
      ],
      details: {
        deliveries_1h: s.webhooks_1h_total,
        failed_1h: s.webhooks_1h_failed,
        dead_1h: s.webhooks_dead_1h,
      },
    });
  }

  if (s.latency_p95_seconds !== null && s.latency_p95_seconds > LATENCY_P95_SECONDS) {
    out.push({
      rule: 'latency_p95',
      severity: 'warning',
      title: 'La latencia de la cola de Flujos está alta',
      lines: [`El p95 de la última hora es ${minutes(s.latency_p95_seconds)} min.`],
      details: { latency_p95_seconds: Math.round(s.latency_p95_seconds) },
    });
  }

  return out;
}

/**
 * Every 5 minutes (one replica, Redis lock) turns degraded platform signals
 * into a history row and one e-mail to Quickss, at most once per rule per hour.
 */
@Injectable()
export class WorkflowsOpsAlertsService {
  private readonly logger = new Logger(WorkflowsOpsAlertsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly metrics: WorkflowsOpsMetricsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(ALERT_CRON)
  async handle(): Promise<void> {
    try {
      const lock = await this.redis.set(ALERT_LOCK_KEY, '1', 'EX', ALERT_LOCK_TTL_SECONDS, 'NX');
      if (lock !== 'OK') return;
      await this.evaluate();
    } catch (e) {
      this.logger.error(`Workflow ops alert cycle failed: ${(e as Error)?.message}`);
    }
  }

  /** Returns the rules that raised an alert in this pass (deduped ones are not included). */
  async evaluate(now = new Date()): Promise<AlertRule[]> {
    const candidates = evaluateRules(await this.metrics.getSignals(now));
    const raised: AlertRule[] = [];
    for (const candidate of candidates) {
      const key = `${ALERT_DEDUPE_KEY_PREFIX}${candidate.rule}`;
      const fresh = await this.redis.set(key, '1', 'EX', ALERT_DEDUPE_TTL_SECONDS, 'NX');
      if (fresh !== 'OK') continue;
      try {
        await this.raise(candidate);
        raised.push(candidate.rule);
      } catch (e) {
        // Nothing reached anyone: let the next cycle try again instead of staying silent for an hour.
        await this.redis.del(key);
        this.logger.error(`Alert ${candidate.rule} not raised: ${(e as Error)?.message}`);
      }
    }
    return raised;
  }

  private async raise(c: AlertCandidate): Promise<void> {
    const recipients = await this.resolveRecipients();
    const sent = await this.send(c, recipients);
    try {
      await this.prisma.withoutScope().workflow_ops_alerts.create({
        data: {
          rule: c.rule,
          severity: c.severity,
          title: c.title,
          details: c.details,
          recipients: sent,
        },
      });
    } catch (e) {
      // Nobody heard of it yet: let the caller release the dedupe key so the next cycle retries.
      if (sent === 0) throw e;
      // The e-mail already went out: keep the key, or every cycle of the next hour mails it again.
      this.logger.error(
        `Alert ${c.rule} e-mailed to ${sent} recipient(s) but not stored in the history: ${(e as Error)?.message}`,
      );
    }
  }

  /** `WORKFLOW_OPS_ALERT_EMAILS` (comma separated) or, if unset, the active super admins. */
  async resolveRecipients(): Promise<string[]> {
    const configured = (this.config.get<string>('WORKFLOW_OPS_ALERT_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.includes('@'));
    const emails =
      configured.length > 0
        ? configured
        : (
            await this.prisma.withoutScope().users.findMany({
              where: {
                state: 'active',
                email: { not: null },
                user_roles: { some: { roles: { name: 'super_admin' } } },
              },
              select: { email: true },
            })
          ).map((u) => u.email as string);
    const seen = new Set<string>();
    return emails.filter((e) => !seen.has(e.toLowerCase()) && !!seen.add(e.toLowerCase()));
  }

  /** One message per address (providers take a single recipient); returns how many were accepted. */
  private async send(c: AlertCandidate, recipients: string[]): Promise<number> {
    if (recipients.length === 0) {
      this.logger.warn(`Alert ${c.rule} has no recipients configured`);
      return 0;
    }
    const base = (this.config.get<string>('FRONTEND_URL') ?? '').trim().replace(/\/$/, '');
    const link = `${base}/super-admin/workflows-ops`;
    const subject = `[Vendix] ${c.title}`;
    const text = [c.title, '', ...c.lines, '', `Revisa la pantalla "Operación de Flujos": ${link}`].join('\n');
    const html = `<p><strong>${c.title}</strong></p><ul>${c.lines
      .map((l) => `<li>${l}</li>`)
      .join('')}</ul><p>Revisa la pantalla <a href="${link}">Operación de Flujos</a>.</p>`;
    let sent = 0;
    for (const to of recipients) {
      const result = await this.email.sendEmail(to, subject, html, text);
      if (result.success) sent++;
      else this.logger.warn(`Alert ${c.rule} email to a recipient failed: ${result.error}`);
    }
    return sent;
  }
}
