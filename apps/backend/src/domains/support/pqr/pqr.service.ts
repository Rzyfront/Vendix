import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreatePqrPublicDto } from './dto/create-pqr-public.dto';
import { PqrQueryDto } from './dto/pqr-query.dto';
import { UpdatePqrDto } from './dto/update-pqr.dto';
import { UpdatePqrStatusDto } from './dto/update-pqr-status.dto';
import { AddPqrCommentDto } from './dto/add-pqr-comment.dto';
import { AssignPqrDto } from './dto/assign-pqr.dto';
import {
  Prisma,
  ticket_category_enum,
  ticket_priority_enum,
  ticket_status_enum,
} from '@prisma/client';

/* ────────────────────────────── Event payloads ────────────────────────────── */

export interface PqrCreatedEvent {
  ticket: {
    id: number;
    ticket_number: string;
    title: string;
    description: string;
    category: string;
  };
  contact: {
    name: string;
    email: string;
    phone?: string;
    pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM';
  };
  ip: string;
}

/**
 * Emitted when an admin posts a non-internal comment on a PQR (treated as an
 * official response). The email listener uses the description to recover the
 * requester email and sends the comment content.
 */
export interface PqrResponseSentEvent {
  ticket_id: number;
  ticket_number: string;
  description: string;
  comment_content: string;
  author_name: string;
  new_status?: ticket_status_enum;
}

/**
 * Emitted when the ticket status transitions to RESOLVED or CLOSED. The email
 * listener notifies the requester that their PQR has been answered/closed.
 */
export interface PqrStatusChangedEvent {
  ticket_id: number;
  ticket_number: string;
  description: string;
  old_status: ticket_status_enum;
  new_status: ticket_status_enum;
  resolution_summary?: string;
}

/* ───────────────────────────── Public view DTOs ───────────────────────────── */

/**
 * Sanitized payload returned by `GET /pqr/:ticket_number` to anonymous users.
 * Never includes description, tags, IP, or assignee info.
 */
export interface PublicPqrView {
  ticket_number: string;
  title: string;
  status: ticket_status_enum;
  pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  created_at: Date | null;
  updated_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  public_responses: Array<{
    id: number;
    content: string;
    author_name: string;
    author_type: string;
    created_at: Date | null;
  }>;
}

/* ───────────────────────────────── Service ────────────────────────────────── */

@Injectable()
export class PqrService {
  private readonly logger = new Logger(PqrService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Creates a PQR (Petición / Queja / Reclamo) ticket against the
   * Vendix platform organization. The ticket is routed to the global
   * admin inbox (admin@vendix.online) via the email service listener.
   */
  async createPublic(dto: CreatePqrPublicDto, ip: string) {
    // 1. Resolve the owning organization.
    //
    // Two flows reach this endpoint:
    //   a) Anonymous storefront visitor — no session, no org context.
    //      The ticket is parked under the platform org `orgVendix` so
    //      the super-admin can still triage it. (Legacy default.)
    //   b) Authenticated store-admin / org-admin / super-admin — the
    //      DTO carries `organization_id` (and optionally `store_id`).
    //      We honor that and the org-admin PQR view can then filter
    //      by `organization_id` without leaking cross-tenant data.
    let owningOrgId: number;
    if (dto.organization_id) {
      owningOrgId = dto.organization_id;
    } else {
      const orgVendix = await this.globalPrisma.organizations.findFirst({
        where: { is_platform: true },
      });
      if (!orgVendix) {
        throw new VendixHttpException(ErrorCodes.SUP_PQR_001);
      }
      owningOrgId = orgVendix.id;
    }
    // 2. Resolve the requesting user. When `organization_id` is set
    //    we still attribute the action to `anon-pqr` because the
    //    visitor email lives in the description (legacy workaround);
    //    for authenticated flows a future change can pass the real
    //    `user_id` here. Leaving the seeder user keeps the FK happy.
    const anonUser = await this.globalPrisma.users.findFirst({
      where: { email: 'anon-pqr@vendix.online' },
    });
    if (!anonUser) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_002);
    }

    // 2. Generate a PQR-prefixed ticket number (PQR-{orgId}-{counter})
    const ticketNumber = await this.generatePqrNumber(owningOrgId);

    // 3. Build the description with metadata (PQR type + IP + contact)
    const description = this.formatDescription(dto);

    // 4. Map PQR type → ticket category enum (PETITION, COMPLAINT, CLAIM)
    const category = this.mapPqrType(dto.pqr_type);

    // 5. Create the ticket. `organization_id` is the requester's org
    // (or `orgVendix` for anonymous visitors). `store_id` is set when
    // the requester is a single store — the org-admin table uses this
    // to render the "Tienda" column without a fragile join.
    const ticket = await this.globalPrisma.support_tickets.create({
      data: {
        ticket_number: ticketNumber,
        organization_id: owningOrgId,
        store_id: dto.store_id ?? null,
        created_by_user_id: anonUser.id,
        title: dto.subject,
        description,
        category,
        // Use the requester's urgency hint when present (validated to
        // P1-P4 by the DTO), otherwise default to P3 (medium).
        priority: dto.priority ?? ticket_priority_enum.P3,
        status: ticket_status_enum.NEW,
        source_channel: 'public_form',
        tags: ['pqr', dto.pqr_type.toLowerCase(), `ip:${ip}`],
      },
    });
    this.logger.log(
      `PQR created: ${ticket.ticket_number} (${dto.pqr_type}) from ${dto.email}`,
    );

    // 6. Emit event so the email listener can notify admin
    const payload: PqrCreatedEvent = {
      ticket: {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category as string,
      },
      contact: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        pqr_type: dto.pqr_type,
      },
      ip,
    };
    this.eventEmitter.emit('pqr.created', payload);

    return ticket;
  }

  /**
   * Returns a sanitized view of a PQR for anonymous tracking. Only public
   * (non-internal) comments are exposed. Throws SUP_PQR_003 if the ticket
   * is missing or belongs to a different organization.
   */
  async findByTicketNumberPublic(ticketNumber: string): Promise<PublicPqrView> {
    const orgVendix = await this.globalPrisma.organizations.findFirst({
      where: { is_platform: true },
      select: { id: true },
    });
    if (!orgVendix) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_001);
    }

    const ticket = await this.globalPrisma.support_tickets.findUnique({
      where: { ticket_number: ticketNumber },
      select: {
        id: true,
        ticket_number: true,
        title: true,
        status: true,
        category: true,
        priority: true,
        organization_id: true,
        created_at: true,
        updated_at: true,
        resolved_at: true,
        closed_at: true,
        comments: {
          where: { is_internal: false },
          orderBy: { created_at: 'asc' },
          select: {
            id: true,
            content: true,
            author_name: true,
            author_type: true,
            created_at: true,
          },
        },
      },
    });

    if (!ticket || ticket.organization_id !== orgVendix.id) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }

    return {
      ticket_number: ticket.ticket_number,
      title: ticket.title,
      status: ticket.status,
      pqr_type: ticket.category as 'PETITION' | 'COMPLAINT' | 'CLAIM',
      priority: ticket.priority as PublicPqrView['priority'],
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      resolved_at: ticket.resolved_at,
      closed_at: ticket.closed_at,
      public_responses: ticket.comments,
    };
  }

  /* ──────────────────────────── Admin operations ─────────────────────────── */

  /**
   * Lists PQRs (paginated, filtered). Always scoped to the Vendix platform
   * organization since PQRs are platform-wide, not per-store.
   */
  async adminFindAll(query: PqrQueryDto) {
    const orgVendix = await this.getPlatformOrgOrThrow();

    const where: Prisma.support_ticketsWhereInput = {
      organization_id: orgVendix.id,
      // PQR filter: only tickets that originated from the public PQR form.
      // tags contains 'pqr' (set in createPublic). This prevents mixing
      // regular store support tickets with PQRs in the admin view.
      tags: { has: 'pqr' },
    };

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.pqr_type) where.category = query.pqr_type as ticket_category_enum;
    if (query.assigned_to_user_id) {
      where.assigned_to_user_id = query.assigned_to_user_id;
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { ticket_number: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.date_from || query.date_to) {
      where.created_at = {};
      if (query.date_from) where.created_at.gte = new Date(query.date_from);
      if (query.date_to) where.created_at.lte = new Date(query.date_to);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [total, data] = await Promise.all([
      this.globalPrisma.support_tickets.count({ where }),
      this.globalPrisma.support_tickets.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
        include: {
          assigned_to: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: data.map((t) => this.toAdminView(t)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async adminGetStats() {
    const orgVendix = await this.getPlatformOrgOrThrow();
    const where: Prisma.support_ticketsWhereInput = {
      organization_id: orgVendix.id,
      tags: { has: 'pqr' },
    };

    const [total, byStatus, byType, byPriority, recent24h] =
      await Promise.all([
        this.globalPrisma.support_tickets.count({ where }),
        this.globalPrisma.support_tickets.groupBy({
          by: ['status'],
          where,
          _count: true,
        }),
        this.globalPrisma.support_tickets.groupBy({
          by: ['category'],
          where,
          _count: true,
        }),
        this.globalPrisma.support_tickets.groupBy({
          by: ['priority'],
          where,
          _count: true,
        }),
        this.globalPrisma.support_tickets.count({
          where: {
            ...where,
            created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    const flatten = (rows: Array<{ _count: number } & Record<string, unknown>>) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        const key = Object.keys(r).find((k) => k !== '_count') as string;
        acc[key] = r._count;
        return acc;
      }, {});

    return {
      success: true,
      data: {
        total,
        recent_24h: recent24h,
        by_status: flatten(byStatus as any),
        by_type: flatten(byType as any),
        by_priority: flatten(byPriority as any),
      },
    };
  }

  async adminFindOne(id: number) {
    const orgVendix = await this.getPlatformOrgOrThrow();

    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: { id, organization_id: orgVendix.id, tags: { has: 'pqr' } },
      include: {
        assigned_to: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        comments: {
          orderBy: { created_at: 'asc' },
          include: {
            author: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
        status_history: {
          orderBy: { created_at: 'desc' },
          include: {
            changed_by: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }

    const requester = this.parseRequester(ticket.description);

    return {
      success: true,
      data: {
        ...this.toAdminView(ticket),
        description: ticket.description,
        requester_name: requester.name,
        requester_email: requester.email,
        requester_phone: requester.phone,
        comments: ticket.comments,
        status_history: ticket.status_history,
      },
    };
  }

  async adminUpdate(id: number, dto: UpdatePqrDto, userId: number) {
    const orgVendix = await this.getPlatformOrgOrThrow();

    const existing = await this.globalPrisma.support_tickets.findFirst({
      where: { id, organization_id: orgVendix.id, tags: { has: 'pqr' } },
      select: { id: true },
    });
    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }

    const updated = await this.globalPrisma.support_tickets.update({
      where: { id },
      data: {
        priority: dto.priority,
        assigned_to_user_id: dto.assigned_to_user_id,
        tags: dto.tags,
        updated_at: new Date(),
      },
    });
    this.logger.log(`PQR ${updated.ticket_number} updated by user ${userId}`);

    return { success: true, data: this.toAdminView(updated) };
  }

  async adminUpdateStatus(
    id: number,
    dto: UpdatePqrStatusDto,
    userId: number,
  ) {
    const orgVendix = await this.getPlatformOrgOrThrow();

    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: { id, organization_id: orgVendix.id, tags: { has: 'pqr' } },
    });
    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }

    const updateData: Prisma.support_ticketsUncheckedUpdateInput = {
      status: dto.status,
      updated_at: new Date(),
    };
    if (dto.status === ticket_status_enum.RESOLVED) {
      updateData.resolved_at = new Date();
      if (dto.resolution_summary) {
        updateData.resolution_summary = dto.resolution_summary;
      }
    } else if (dto.status === ticket_status_enum.CLOSED) {
      updateData.closed_at = new Date();
      if (dto.resolution_summary) {
        updateData.resolution_summary = dto.resolution_summary;
      }
    }
    if (!ticket.first_response_at && dto.status !== ticket_status_enum.NEW) {
      updateData.first_response_at = new Date();
    }

    const updated = await this.globalPrisma.support_tickets.update({
      where: { id },
      data: updateData,
    });

    // Status history
    await this.globalPrisma.support_status_history.create({
      data: {
        ticket_id: id,
        old_status: ticket.status,
        new_status: dto.status,
        change_reason: dto.change_reason,
        change_notes: dto.resolution_summary,
        changed_by_user_id: userId,
        created_at: new Date(),
      },
    });

    // Emit events
    this.eventEmitter.emit('pqr.status_changed', {
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      description: ticket.description,
      old_status: ticket.status,
      new_status: dto.status,
      resolution_summary: dto.resolution_summary,
    } satisfies PqrStatusChangedEvent);

    if (
      dto.status === ticket_status_enum.RESOLVED ||
      dto.status === ticket_status_enum.CLOSED
    ) {
      this.eventEmitter.emit('pqr.response_sent', {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        description: ticket.description,
        comment_content: dto.resolution_summary || '',
        author_name: 'Equipo Vendix',
        new_status: dto.status,
      } satisfies PqrResponseSentEvent);
    }

    this.logger.log(
      `PQR ${ticket.ticket_number} status: ${ticket.status} → ${dto.status}`,
    );

    return { success: true, data: this.toAdminView(updated) };
  }

  async adminAssign(id: number, dto: AssignPqrDto, userId: number) {
    const orgVendix = await this.getPlatformOrgOrThrow();

    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: { id, organization_id: orgVendix.id, tags: { has: 'pqr' } },
    });
    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }

    const updated = await this.globalPrisma.support_tickets.update({
      where: { id },
      data: {
        assigned_to_user_id: dto.assigned_to_user_id,
        status:
          ticket.status === ticket_status_enum.NEW
            ? ticket_status_enum.OPEN
            : ticket.status,
        updated_at: new Date(),
      },
      include: {
        assigned_to: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    await this.globalPrisma.support_status_history.create({
      data: {
        ticket_id: id,
        old_status: ticket.status,
        new_status: updated.status,
        change_reason: `Assigned to user ${dto.assigned_to_user_id}${
          dto.notes ? ': ' + dto.notes : ''
        }`,
        changed_by_user_id: userId,
        created_at: new Date(),
      },
    });

    this.logger.log(
      `PQR ${ticket.ticket_number} assigned to user ${dto.assigned_to_user_id}`,
    );

    return { success: true, data: this.toAdminView(updated) };
  }

  async adminAddComment(
    id: number,
    dto: AddPqrCommentDto,
    userId: number,
  ) {
    const orgVendix = await this.getPlatformOrgOrThrow();

    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: { id, organization_id: orgVendix.id, tags: { has: 'pqr' } },
    });
    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }

    const user = await this.globalPrisma.users.findUnique({
      where: { id: userId },
      select: { id: true, first_name: true, last_name: true },
    });
    const authorName = user
      ? `${user.first_name} ${user.last_name}`.trim() || `Admin #${userId}`
      : `Admin #${userId}`;

    const isInternal = dto.is_internal !== false; // default true
    const shouldNotify =
      dto.notify_requester ?? !isInternal; // non-internal → notify

    const comment = await this.globalPrisma.support_comments.create({
      data: {
        ticket_id: id,
        content: dto.content,
        is_internal: isInternal,
        author_id: userId,
        author_type: 'admin',
        author_name: authorName,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Stamp first_response_at if this is the first admin response
    if (!ticket.first_response_at && !isInternal) {
      await this.globalPrisma.support_tickets.update({
        where: { id },
        data: { first_response_at: new Date() },
      });
    }

    if (shouldNotify) {
      this.eventEmitter.emit('pqr.response_sent', {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        description: ticket.description,
        comment_content: dto.content,
        author_name: authorName,
        new_status: ticket.status,
      } satisfies PqrResponseSentEvent);
    }

    this.logger.log(
      `Comment added to PQR ${ticket.ticket_number} (internal=${isInternal})`,
    );

    return { success: true, data: comment };
  }

  /* ──────────────────────────────── Helpers ─────────────────────────────── */

  /**
   * Parses the structured PQR description to recover the original requester
   * info. The format produced by `formatDescription` is:
   *
   * **Tipo:** Petición
   * **Nombre:** Ada Lovelace
   * **Email:** ada@example.com
   * **Teléfono:** +57 300 123 4567
   *
   * ---
   *
   * <description>
   */
  private parseRequester(description: string): {
    name: string;
    email: string;
    phone?: string;
  } {
    const lines = description.split('\n');
    let name = '';
    let email = '';
    let phone: string | undefined;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('**Nombre:**')) {
        name = line.replace('**Nombre:**', '').trim();
      } else if (line.startsWith('**Email:**')) {
        email = line.replace('**Email:**', '').trim();
      } else if (line.startsWith('**Teléfono:**')) {
        phone = line.replace('**Teléfono:**', '').trim();
      } else if (line === '---') {
        break; // stop at separator
      }
    }
    if (!email) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_007);
    }
    return { name, email, phone };
  }

  /**
   * Builds a Prisma `where` fragment that scopes to the Vendix platform org
   * AND filters to PQR-only tickets (those tagged with 'pqr').
   */
  private async getPlatformOrgOrThrow() {
    const org = await this.globalPrisma.organizations.findFirst({
      where: { is_platform: true },
      select: { id: true },
    });
    if (!org) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_001);
    }
    return org;
  }

  /**
   * Generates a ticket number in the format PQR-{orgId}-{counter}.
   * Counts the existing PQR tickets and increments by 1.
   */
  private async generatePqrNumber(orgId: number): Promise<string> {
    const count = await this.globalPrisma.support_tickets.count({
      where: {
        organization_id: orgId,
        ticket_number: { startsWith: 'PQR-' },
      },
    });
    const padded = String(count + 1).padStart(5, '0');
    return `PQR-${orgId}-${padded}`;
  }

  /**
   * Formats the PQR description with structured metadata at the top
   * for easy reading in the admin inbox and reliable recovery via
   * `parseRequester`.
   */
  private formatDescription(dto: CreatePqrPublicDto): string {
    const labels: Record<string, string> = {
      PETITION: 'Petición',
      COMPLAINT: 'Queja',
      CLAIM: 'Reclamo',
    };
    const lines = [
      `**Tipo:** ${labels[dto.pqr_type]}`,
      `**Nombre:** ${dto.name}`,
      `**Email:** ${dto.email}`,
      dto.phone ? `**Teléfono:** ${dto.phone}` : null,
      '',
      '---',
      '',
      dto.description,
    ].filter((l) => l !== null);
    return lines.join('\n');
  }

  /**
   * Maps the PQR type to the ticket category enum. The enum supports
   * PETITION, COMPLAINT, CLAIM natively (added via the prisma schema
   * migration that ships with this feature).
   */
  private mapPqrType(
    pqrType: 'PETITION' | 'COMPLAINT' | 'CLAIM',
  ): ticket_category_enum {
    return pqrType as ticket_category_enum;
  }

  /**
   * Normalizes a support_tickets row to the admin-facing PQR shape.
   * Trims Prisma-specific fields that don't belong in the API contract.
   */
  private toAdminView(t: {
    id: number;
    ticket_number: string;
    title: string;
    status: ticket_status_enum;
    category: string;
    priority: string;
    assigned_to?: {
      id: number;
      email: string | null;
      first_name: string;
      last_name: string;
    } | null;
    created_at: Date | null;
    updated_at: Date | null;
    resolved_at?: Date | null;
    closed_at?: Date | null;
    first_response_at?: Date | null;
  }) {
    return {
      id: t.id,
      ticket_number: t.ticket_number,
      title: t.title,
      status: t.status,
      pqr_type: t.category as 'PETITION' | 'COMPLAINT' | 'CLAIM',
      priority: t.priority,
      assigned_to: t.assigned_to
        ? {
            id: t.assigned_to.id,
            email: t.assigned_to.email,
            name: `${t.assigned_to.first_name} ${t.assigned_to.last_name}`.trim(),
          }
        : null,
      created_at: t.created_at,
      updated_at: t.updated_at,
      resolved_at: t.resolved_at ?? null,
      closed_at: t.closed_at ?? null,
      first_response_at: t.first_response_at ?? null,
    };
  }
}