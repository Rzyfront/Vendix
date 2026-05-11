import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { EmailService } from '../../../email/email.service';
import { NotificationsService } from '../../store/notifications/notifications.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

interface FiscalScopeChangedEvent {
  organization_id: number;
  previous_fiscal_scope: 'STORE' | 'ORGANIZATION';
  new_fiscal_scope: 'STORE' | 'ORGANIZATION';
  changed_by_user_id?: number | null;
  audit_log_id?: number | null;
  forced?: boolean;
  applied_at?: string | Date;
}

@Injectable()
export class FiscalScopeEventsListener {
  private readonly logger = new Logger(FiscalScopeEventsListener.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  @OnEvent('organization.fiscal_scope_changed')
  async handleFiscalScopeChanged(event: FiscalScopeChangedEvent) {
    try {
      const [organization, stores, recipients, changedBy] = await Promise.all([
        this.prisma.organizations.findUnique({
          where: { id: event.organization_id },
          select: { id: true, name: true, slug: true },
        }),
        this.prisma.stores.findMany({
          where: {
            organization_id: event.organization_id,
            is_active: true,
          },
          select: { id: true, name: true },
        }),
        this.findOrgAdminRecipients(event.organization_id),
        event.changed_by_user_id
          ? this.prisma.users.findUnique({
              where: { id: event.changed_by_user_id },
              select: { first_name: true, last_name: true, email: true },
            })
          : Promise.resolve(null),
      ]);

      const orgName = organization?.name ?? `Organización ${event.organization_id}`;
      const appliedAt = event.applied_at
        ? new Date(event.applied_at).toISOString()
        : new Date().toISOString();
      const title = 'Alcance fiscal actualizado';
      const body = `${orgName} cambió su alcance fiscal de ${event.previous_fiscal_scope} a ${event.new_fiscal_scope}.`;
      const data = {
        organization_id: event.organization_id,
        organization_name: orgName,
        previous_fiscal_scope: event.previous_fiscal_scope,
        new_fiscal_scope: event.new_fiscal_scope,
        changed_by_user_id: event.changed_by_user_id ?? null,
        audit_log_id: event.audit_log_id ?? null,
        forced: Boolean(event.forced),
        applied_at: appliedAt,
      };

      await Promise.all(
        stores.map((store) =>
          this.notifications.createAndBroadcast(
            store.id,
            'fiscal_scope_changed',
            title,
            body,
            data,
          ),
        ),
      );

      await Promise.all(
        recipients.map((recipient) =>
          this.email.sendEmail(
            recipient.email,
            title,
            this.buildEmailHtml({
              organizationName: orgName,
              recipientName: recipient.first_name || recipient.username,
              previousScope: event.previous_fiscal_scope,
              newScope: event.new_fiscal_scope,
              appliedAt,
              changedBy: changedBy
                ? `${changedBy.first_name} ${changedBy.last_name}`.trim() ||
                  changedBy.email
                : null,
              forced: Boolean(event.forced),
              auditLogId: event.audit_log_id ?? null,
            }),
            this.buildEmailText({
              organizationName: orgName,
              previousScope: event.previous_fiscal_scope,
              newScope: event.new_fiscal_scope,
              appliedAt,
              changedBy: changedBy
                ? `${changedBy.first_name} ${changedBy.last_name}`.trim() ||
                  changedBy.email
                : null,
              forced: Boolean(event.forced),
              auditLogId: event.audit_log_id ?? null,
            }),
          ),
        ),
      );

      this.logger.log(
        `Fiscal scope change notified for organization ${event.organization_id}: ${stores.length} store notification(s), ${recipients.length} email(s)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify fiscal scope change for organization ${event.organization_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  private async findOrgAdminRecipients(organization_id: number) {
    const users = await this.prisma.users.findMany({
      where: {
        organization_id,
        state: { not: 'archived' },
        email: { not: '' },
      },
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        user_settings: { select: { app_type: true } },
        user_roles: {
          select: {
            roles: { select: { name: true } },
          },
        },
      },
    });

    const adminRoleNames = new Set(['owner', 'admin', 'ORG_ADMIN']);
    const seen = new Set<string>();

    return users.filter((user) => {
      const isOrgAdminApp = user.user_settings?.app_type === 'ORG_ADMIN';
      const hasAdminRole = user.user_roles.some((userRole) =>
        userRole.roles?.name ? adminRoleNames.has(userRole.roles.name) : false,
      );

      if (!isOrgAdminApp && !hasAdminRole) return false;
      if (seen.has(user.email)) return false;
      seen.add(user.email);
      return true;
    });
  }

  private buildEmailHtml(input: {
    organizationName: string;
    recipientName: string;
    previousScope: string;
    newScope: string;
    appliedAt: string;
    changedBy: string | null;
    forced: boolean;
    auditLogId: number | null;
  }) {
    const changedBy = input.changedBy
      ? `<p><strong>Usuario:</strong> ${this.escapeHtml(input.changedBy)}</p>`
      : '';
    const audit = input.auditLogId
      ? `<p><strong>Audit log:</strong> #${input.auditLogId}</p>`
      : '';

    return `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
        <h2>Alcance fiscal actualizado</h2>
        <p>Hola ${this.escapeHtml(input.recipientName)},</p>
        <p>La organización <strong>${this.escapeHtml(input.organizationName)}</strong> cambió su alcance fiscal.</p>
        <p><strong>Anterior:</strong> ${input.previousScope}</p>
        <p><strong>Nuevo:</strong> ${input.newScope}</p>
        <p><strong>Aplicado:</strong> ${input.appliedAt}</p>
        ${changedBy}
        ${audit}
        <p><strong>Cambio forzado:</strong> ${input.forced ? 'Sí' : 'No'}</p>
      </div>
    `;
  }

  private buildEmailText(input: {
    organizationName: string;
    previousScope: string;
    newScope: string;
    appliedAt: string;
    changedBy: string | null;
    forced: boolean;
    auditLogId: number | null;
  }) {
    return [
      'Alcance fiscal actualizado',
      `Organización: ${input.organizationName}`,
      `Anterior: ${input.previousScope}`,
      `Nuevo: ${input.newScope}`,
      `Aplicado: ${input.appliedAt}`,
      input.changedBy ? `Usuario: ${input.changedBy}` : null,
      input.auditLogId ? `Audit log: #${input.auditLogId}` : null,
      `Cambio forzado: ${input.forced ? 'Sí' : 'No'}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
