import { randomBytes } from 'crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { EmailService } from '../../email/email.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  PLATFORM_INCIDENT_REPORTED_EVENT,
  type PlatformIncidentInput,
  type PlatformIncidentResult,
} from './platform-incident.types';

export const INCIDENT_DEDUPE_KEY_PREFIX = 'incidents:dedupe:';
export const INCIDENT_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;
const PENDING = 'pending';
const NO_TICKET = 'no-ticket';
/** How long a losing caller waits for the winner to publish the ticket number. */
const WAIT_STEP_MS = 20;
const WAIT_MAX_STEPS = 100;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Turns a platform failure into ONE support ticket (category INCIDENT) and one
 * e-mail per recipient, deduplicated in Redis by `dedupeKey`.
 *
 * Pattern: `WorkflowsOpsAlertsService` (SET NX EX + release on failure).
 * Never throws: an incident that cannot be reported must not break the caller.
 */
@Injectable()
export class PlatformIncidentService {
  private readonly logger = new Logger(PlatformIncidentService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * Reports the incident and then announces it with
   * `PLATFORM_INCIDENT_REPORTED_EVENT` (the QUI-1010 bot logs it and sends it
   * to Telegram). Every call is announced, deduped or not: the bot counts
   * repetitions.
   */
  async report(input: PlatformIncidentInput): Promise<PlatformIncidentResult> {
    const result = await this.reportOnce(input);
    try {
      this.events?.emit(PLATFORM_INCIDENT_REPORTED_EVENT, { input, result });
    } catch (error) {
      this.logger.warn(
        `Incident ${input.dedupeKey} not announced: ${(error as Error)?.message}`,
      );
    }
    return result;
  }

  private async reportOnce(
    input: PlatformIncidentInput,
  ): Promise<PlatformIncidentResult> {
    const key = `${INCIDENT_DEDUPE_KEY_PREFIX}${input.dedupeKey}`;
    try {
      const ttl = input.dedupeTtlSeconds ?? INCIDENT_DEDUPE_TTL_SECONDS;
      const won = await this.redis.set(key, PENDING, 'EX', ttl, 'NX');
      if (won !== 'OK') {
        return {
          ticketNumber: await this.awaitWinner(key),
          created: false,
          emailed: 0,
        };
      }
      return await this.openIncident(key, input);
    } catch (error) {
      this.logger.error(
        `Incident ${input.dedupeKey} could not be reported: ${(error as Error)?.message}`,
      );
      return { ticketNumber: null, created: false, emailed: 0 };
    }
  }

  private async openIncident(
    key: string,
    input: PlatformIncidentInput,
  ): Promise<PlatformIncidentResult> {
    const ticketNumber = await this.createTicket(input);
    let emailed = 0;
    try {
      emailed = await this.sendEmails(input, ticketNumber);
    } catch (error) {
      this.logger.error(
        `Incident ${input.dedupeKey} e-mail failed: ${(error as Error)?.message}`,
      );
    }
    if (ticketNumber === null && emailed === 0) {
      // Nobody heard of it: let the next failure try again.
      await this.safeDel(key);
      return { ticketNumber: null, created: false, emailed: 0 };
    }
    try {
      await this.redis.set(key, ticketNumber ?? NO_TICKET, 'KEEPTTL');
    } catch (error) {
      this.logger.error(
        `Incident ${input.dedupeKey} ticket number not stored: ${(error as Error)?.message}`,
      );
    }
    return { ticketNumber, created: true, emailed };
  }

  /** Losers of the SET NX race read the number the winner stores in the same key. */
  private async awaitWinner(key: string): Promise<string | null> {
    for (let step = 0; step < WAIT_MAX_STEPS; step++) {
      const value = await this.redis.get(key);
      if (value === null) return null; // released: the winner failed
      if (value !== PENDING) return value === NO_TICKET ? null : value;
      await sleep(WAIT_STEP_MS);
    }
    return null;
  }

  private async safeDel(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(
        `Incident dedupe key not released: ${(error as Error)?.message}`,
      );
    }
  }

  private async createTicket(
    input: PlatformIncidentInput,
  ): Promise<string | null> {
    try {
      const creatorId = input.userId ?? (await this.firstSuperAdminId());
      if (creatorId == null) {
        this.logger.warn(
          `Incident ${input.dedupeKey}: no user to own the ticket (e-mail only)`,
        );
        return null;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const ticketNumber = this.generateTicketNumber();
        try {
          await this.prisma.support_tickets.create({
            data: {
              ticket_number: ticketNumber,
              organization_id: input.organizationId,
              store_id: input.storeId ?? null,
              created_by_user_id: creatorId,
              title: input.title.slice(0, 255),
              description: this.buildDescription(input),
              category: 'INCIDENT',
              priority: input.severity === 'critical' ? 'P1' : 'P2',
              status: 'NEW',
              source_channel: input.source,
              tags: ['incident', input.source, ...(input.tags ?? [])],
            },
          });
          return ticketNumber;
        } catch (error) {
          if ((error as { code?: string })?.code === 'P2002' && attempt === 0) {
            continue;
          }
          throw error;
        }
      }
      return null;
    } catch (error) {
      this.logger.error(
        `Incident ${input.dedupeKey} ticket not created: ${(error as Error)?.message}`,
      );
      return null;
    }
  }

  private async firstSuperAdminId(): Promise<number | null> {
    const admin = await this.prisma.users.findFirst({
      where: {
        state: 'active',
        user_roles: { some: { roles: { name: 'super_admin' } } },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return admin?.id ?? null;
  }

  /** `INC-YYYYMMDD-XXXXXX`: random suffix, so no count()+1 race. */
  private generateTicketNumber(): string {
    const now = new Date();
    const day = now.toISOString().slice(0, 10).replace(/-/g, '');
    let suffix = '';
    const bytes = randomBytes(6);
    for (const b of bytes) suffix += (b % 36).toString(36);
    return `INC-${day}-${suffix.toUpperCase()}`;
  }

  /** Visible to the organization: never the stack nor `internalDetails`. */
  private buildDescription(input: PlatformIncidentInput): string {
    const lines = [input.summary, ''];
    for (const [label, value] of Object.entries(input.details ?? {})) {
      if (value === null || value === undefined || value === '') continue;
      lines.push(`${label}: ${value}`);
    }
    if (input.errorCode) lines.push(`Código de error: ${input.errorCode}`);
    if (input.correlationId) lines.push(`Correlación: ${input.correlationId}`);
    lines.push(`Fecha: ${new Date().toISOString()}`);
    return lines.join('\n');
  }

  /** `SUPPORT_INCIDENT_EMAILS` (comma separated) or, if unset, the active super admins. */
  async resolveRecipients(): Promise<string[]> {
    const configured = (this.config.get<string>('SUPPORT_INCIDENT_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.includes('@'));
    const emails =
      configured.length > 0
        ? configured
        : (
            await this.prisma.users.findMany({
              where: {
                state: 'active',
                email: { not: null },
                user_roles: { some: { roles: { name: 'super_admin' } } },
              },
              select: { email: true },
            })
          ).map((u) => u.email as string);
    const seen = new Set<string>();
    return emails.filter(
      (e) => !seen.has(e.toLowerCase()) && !!seen.add(e.toLowerCase()),
    );
  }

  private async sendEmails(
    input: PlatformIncidentInput,
    ticketNumber: string | null,
  ): Promise<number> {
    const recipients = await this.resolveRecipients();
    if (recipients.length === 0) {
      this.logger.warn(`Incident ${input.dedupeKey} has no recipients`);
      return 0;
    }
    const subject = `[Vendix] Incidente: ${input.title}`;
    const lines = [
      ticketNumber ? `Ticket: ${ticketNumber}` : 'Ticket: no se pudo crear',
      input.summary,
      ...Object.entries({ ...input.details, ...input.internalDetails })
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}: ${v}`),
      ...(input.errorCode ? [`Código de error: ${input.errorCode}`] : []),
      ...(input.correlationId ? [`Correlación: ${input.correlationId}`] : []),
    ];
    const stack = (input.stack ?? '').split('\n').slice(0, 10).join('\n');
    const text = [input.title, '', ...lines, ...(stack ? ['', stack] : [])].join(
      '\n',
    );
    const html =
      `<p><strong>${escapeHtml(input.title)}</strong></p><ul>` +
      lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('') +
      `</ul>` +
      (stack ? `<pre>${escapeHtml(stack)}</pre>` : '');
    let sent = 0;
    for (const to of recipients) {
      const result = await this.email.sendEmail(to, subject, html, text);
      if (result.success) sent++;
      else
        this.logger.warn(
          `Incident ${input.dedupeKey} e-mail to a recipient failed: ${result.error}`,
        );
    }
    return sent;
  }
}
