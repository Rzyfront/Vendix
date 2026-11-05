import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../../../../email/email.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

export type WorkflowEmailResult = 'sent' | 'skipped' | 'failed';

export interface WorkflowEmailInput {
  storeId: number;
  userId: number;
  instanceId: number;
  /** `<reference> · <stage name>` style subject. */
  subject: string;
  message: string;
}

const NOTIFICATION_TYPE = 'workflow_task';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Transactional e-mail of Flujos (task assigned, `notify` action, reminders).
 * Preference: a `notification_subscriptions` row for the type `workflow_task`
 * with `email = false` opts the user out; without a row the e-mail is sent.
 * The caller (outbox) tracks per-recipient delivery so a retry never repeats it.
 */
@Injectable()
export class WorkflowEmailService {
  private readonly logger = new Logger(WorkflowEmailService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly email: EmailService,
  ) {}

  /** Admin link of the instance, or `null` when the store has no admin domain. */
  async instanceUrl(storeId: number, instanceId: number): Promise<string | null> {
    try {
      const domain = await this.prisma.withoutScope().domain_settings.findFirst({
        where: { store_id: storeId, app_type: 'STORE_ADMIN', status: 'active' },
        orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
        select: { hostname: true },
      });
      return domain?.hostname
        ? `https://${domain.hostname}/admin/workflows/instances/${instanceId}`
        : null;
    } catch {
      return null;
    }
  }

  async send(input: WorkflowEmailInput): Promise<WorkflowEmailResult> {
    const db = this.prisma.withoutScope();
    const user = await db.users.findFirst({
      where: { id: input.userId },
      select: { email: true, first_name: true },
    });
    if (!user?.email) return 'skipped';
    const preference = await db.notification_subscriptions.findFirst({
      where: { store_id: input.storeId, user_id: input.userId, type: NOTIFICATION_TYPE },
      select: { email: true },
    });
    if (preference && preference.email === false) return 'skipped';

    const url = await this.instanceUrl(input.storeId, input.instanceId);
    const greeting = user.first_name ? `Hola ${escapeHtml(user.first_name)},` : 'Hola,';
    const html =
      `<p>${greeting}</p><p>${escapeHtml(input.message)}</p>` +
      (url ? `<p><a href="${url}">Abrir la solicitud</a></p>` : '');
    const text = `${input.message}${url ? `\n\n${url}` : ''}`;
    const result = await this.email.sendEmail(user.email, input.subject, html, text);
    if (!result.success) {
      this.logger.warn(`Workflow e-mail to user ${input.userId} failed: ${result.error}`);
      return 'failed';
    }
    return 'sent';
  }
}
