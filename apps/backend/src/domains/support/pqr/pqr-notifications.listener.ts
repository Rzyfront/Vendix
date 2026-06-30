import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  PqrCreatedEvent,
  PqrResponseSentEvent,
} from './pqr.service';

/**
 * In-app (bell) notifications for the PQR module.
 *
 * Listens for:
 *  - pqr.created        → broadcast to every SUPER_ADMIN user
 *  - pqr.response_sent  → notify the owning store's admins
 *
 * Email-side notifications are handled separately by
 * pqr-email.service.ts (which talks to the requester / platform
 * admin inbox). This service is strictly the in-app bell, which
 * surfaces in the sidebar notification badge the operator sees
 * without having to be on the email channel.
 *
 * The notification rows have:
 *  - store_id = null      → super-admin audience (queryable by
 *                            absence of store_id)
 *  - store_id = <orgStore> → store-admin audience (existing
 *                            store-scoped pattern)
 *
 * Per-user targeting is stored in `data.target_user_id` (see
 * notifications.service.ts) — the `notifications` table does NOT have
 * a `user_id` column, so the listener writes the recipient as part of
 * the JSON payload and the SSE / bell query filters by it.
 *
 * Frontend consumes via the existing /api/store/notifications/stream
 * SSE channel — the bell badge query already filters by user
 * role + store_id when present.
 */
@Injectable()
export class PqrNotificationsListener {
  private readonly logger = new Logger(PqrNotificationsListener.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  /**
   * Broadcast a "new PQR" in-app notification to every super-admin.
   * Looks up the role via the `user_roles` table (a user can have
   * multiple roles) and writes one row per super-admin user so each
   * one has an independent is_read state.
   */
  @OnEvent('pqr.created')
  async handlePqrCreated(payload: PqrCreatedEvent) {
    try {
      const superAdmins = await this.globalPrisma.users.findMany({
        where: {
          state: 'active',
          user_roles: {
            some: { roles: { name: 'SUPER_ADMIN' } },
          },
        },
        select: { id: true },
      });

      if (superAdmins.length === 0) {
        this.logger.warn('pqr.created: no super-admin user found');
        return;
      }

      const ticket = payload.ticket;
      // pqr_type lives on `payload.contact`, not on `ticket` (the
      // ticket row stores it as a category enum + a `pqr` tag).
      const pqrType = payload.contact.pqr_type;
      const typeLabel = {
        PETITION: 'Petición',
        COMPLAINT: 'Queja',
        CLAIM: 'Reclamo',
        SUGGESTION: 'Sugerencia',
      }[pqrType] ?? pqrType;

      await this.globalPrisma.notifications.createMany({
        data: superAdmins.map((u) => ({
          store_id: null,
          // 'pqr_new' / 'pqr_update' are valid enum values after
          // migration 20260629120000_add_pqr_notification_types.
          type: 'pqr_new' as any,
          severity: 'info' as any,
          title: `Nueva ${typeLabel}: ${ticket.ticket_number}`,
          body: `${ticket.title} — pendiente de respuesta del equipo de soporte.`,
          data: {
            kind: 'pqr.created',
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            organization_id: ticket.organization_id,
            store_id: ticket.store_id,
            pqr_type: pqrType,
            target_user_id: u.id,
          },
        })),
        skipDuplicates: false,
      });

      this.logger.log(
        `pqr.created: notified ${superAdmins.length} super-admin(s) about ${ticket.ticket_number}`,
      );
    } catch (err) {
      this.logger.error(
        `pqr.created: failed to dispatch in-app notifications — ${
          err instanceof Error ? err.stack : err
        }`,
      );
    }
  }

  /**
   * Notify the owning store's admins when the super-admin (or any
   * admin) sends a public response to a PQR. Uses the ticket's
   * `store_id` to scope the notification, falling back to
   * `organization_id` if the ticket has no store (anonymous
   * public-form submissions).
   */
  @OnEvent('pqr.response_sent')
  async handlePqrResponseSent(payload: PqrResponseSentEvent) {
    try {
      const ticket = await this.globalPrisma.support_tickets.findUnique({
        where: { id: payload.ticket_id },
        select: { id: true, ticket_number: true, title: true, store_id: true, organization_id: true },
      });
      if (!ticket) return;

      if (!ticket.store_id) {
        // Anonymous PQR (no owning store) → super-admin audience.
        // The store-admin bell wouldn't show this anyway, so we
        // mirror the create path.
        await this.notifySuperAdminsOfResponse(ticket);
        return;
      }

      // Look up admins of the owning store. A user with role
      // STORE_ADMIN is the audience here.
      const storeAdmins = await this.globalPrisma.users.findMany({
        where: {
          state: 'active',
          store_users: {
            some: { store_id: ticket.store_id },
          },
          user_roles: {
            some: { roles: { name: 'STORE_ADMIN' } },
          },
        },
        select: { id: true },
      });

      if (storeAdmins.length === 0) {
        this.logger.warn(
          `pqr.response_sent: no store-admin for store_id=${ticket.store_id}`,
        );
        return;
      }

      await this.globalPrisma.notifications.createMany({
        data: storeAdmins.map((u) => ({
          store_id: ticket.store_id,
          type: 'pqr_update' as any,
          severity: 'info' as any,
          title: `Tu PQRS ${ticket.ticket_number} recibió respuesta`,
          body: `El equipo de soporte respondió: ${ticket.title}.`,
          data: {
            kind: 'pqr.response_sent',
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            target_user_id: u.id,
          },
        })),
      });

      this.logger.log(
        `pqr.response_sent: notified ${storeAdmins.length} store-admin(s) for ${ticket.ticket_number}`,
      );
    } catch (err) {
      this.logger.error(
        `pqr.response_sent: failed to dispatch in-app notifications — ${
          err instanceof Error ? err.stack : err
        }`,
      );
    }
  }

  private async notifySuperAdminsOfResponse(ticket: {
    id: number;
    ticket_number: string;
    title: string;
  }) {
    const superAdmins = await this.globalPrisma.users.findMany({
      where: {
        state: 'active',
        user_roles: { some: { roles: { name: 'SUPER_ADMIN' } } },
      },
      select: { id: true },
    });
    if (superAdmins.length === 0) return;
    await this.globalPrisma.notifications.createMany({
      data: superAdmins.map((u) => ({
        store_id: null,
        type: 'pqr_update' as any,
        severity: 'info' as any,
        title: `PQRS ${ticket.ticket_number} respondió (sin tienda)`,
        body: ticket.title,
        data: {
          kind: 'pqr.response_sent',
          ticket_id: ticket.id,
          ticket_number: ticket.ticket_number,
          target_user_id: u.id,
        },
      })),
    });
  }
}
