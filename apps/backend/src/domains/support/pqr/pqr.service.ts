import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
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
    pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM' | 'SUGGESTION';
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
  /** Structured requester contact. Email is the canonical field
   *  used by listeners to send the response notification. Falls
   *  back to parsing `description` for legacy tickets that
   *  pre-date the structured columns. */
  requester_email?: string;
  requester_name?: string;
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
  pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM' | 'SUGGESTION';
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

    // 3. The description column now stores ONLY the visitor's typed
    // message. Legacy rows still carry the metadata block at the top
    // (parseRequester reads it on the read path). New rows get clean
    // prose so the detail page description card reads naturally
    // without the `**Tipo:** ... **Nombre:** ... ---` header.
    const description = dto.description;

    // 4. Map PQR type → ticket category enum (PETITION, COMPLAINT, CLAIM)
    const category = this.mapPqrType(dto.pqr_type);

    // 5. Create the ticket. `organization_id` is the requester's org
    // (or `orgVendix` for anonymous visitors). `store_id` is set when
    // the requester is a single store — the org-admin table uses this
    // to render the "Tienda" column without a fragile join.
    // Requester contact data lands in dedicated columns (when provided)
    // so the detail page can render the Solicitante card without
    // parsing the description. Legacy `name` / `email` / `phone` on
    // the DTO still work — they're the fallback when the structured
    // fields aren't sent.
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
        // Structured requester fields (preferred path)
        requester_first_name: dto.requester_first_name ?? null,
        requester_last_name: dto.requester_last_name ?? null,
        requester_email: dto.requester_email ?? dto.email,
        requester_phone: dto.requester_phone ?? dto.phone ?? null,
        requester_document_type: dto.requester_document_type ?? null,
        requester_document_num: dto.requester_document_num ?? null,
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
      pqr_type: ticket.category as 'PETITION' | 'COMPLAINT' | 'CLAIM' | 'SUGGESTION',
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
   * Builds the base `where` clause for any admin-scoped PQR query.
   *
   * Visibility model:
   *   - Store-admin: callerStoreId is set → MUST see only PQRS from
   *     their own store. PQRS from other stores of the same org are
   *     hidden (privacy: customer PII doesn't leak across stores).
   *   - Org-admin: callerStoreId is null → MUST see all PQRS in the
   *     org. They have oversight responsibility over every store.
   *   - Super-admin: callerOrgId is null OR callerStoreId is null AND
   *     the controller doesn't run this helper (super-admin has its
   *     own superAdminFindOne path that bypasses org scoping).
   *
   * Why a helper: the rule "store-scoped if store-id present, org-
   * scoped otherwise" needs to be applied consistently across list,
   * stats, single-fetch, update, and comment endpoints. Centralising
   * it here means a future tweak (e.g. switch to role-based scoping)
   * lands in one place.
   */
  private buildPqrScope(): Prisma.support_ticketsWhereInput {
    const callerOrgId = RequestContextService.getOrganizationId();
    const callerStoreId = RequestContextService.getStoreId();
    const where: Prisma.support_ticketsWhereInput = {
      tags: { has: 'pqr' },
    };
    if (callerStoreId) {
      // Store-scoped path — tie down to both org (defence in depth)
      // AND store. The org check is redundant when the JWT carries
      // both, but harmless: if a future change decouples store_id
      // from org_id we still respect the org boundary.
      where.organization_id = callerOrgId;
      where.store_id = callerStoreId;
    } else {
      // Org-scoped path — caller has no store context (org-admin or
      // platform operator). They see every PQRS in the org.
      where.organization_id = callerOrgId;
    }
    return where;
  }

  /**
   * Lists PQRs (paginated, filtered). Always scoped to the Vendix platform
   * organization since PQRs are platform-wide, not per-store.
   */
  async adminFindAll(query: PqrQueryDto) {
    const where = this.buildPqrScope();

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
    const where = this.buildPqrScope();

    const [
      total,
      byStatus,
      byType,
      byPriority,
      recent24h,
      unanswered,
    ] = await Promise.all([
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
      // PQRS that have NO admin response yet (public comment with
      // author_type='admin'). Powers the sidebar badge: once anyone
      // on the support team has answered, the row stops counting as
      // actionable. Scope is already applied via `where` so the count
      // respects store-scoped vs org-scoped visibility.
      this.globalPrisma.support_tickets.count({
        where: {
          ...where,
          comments: {
            none: {
              author_type: 'admin',
              is_internal: false,
            },
          },
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
        unanswered_count: unanswered,
        by_status: flatten(byStatus as any),
        by_type: flatten(byType as any),
        by_priority: flatten(byPriority as any),
      },
    };
  }

  async adminFindOne(id: number) {
    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: {
        ...this.buildPqrScope(),
        id,
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

    // Prefer the structured requester columns when they're populated
    // (rows created after the schema migration). Legacy rows fall back
    // to the parsed values from the description block.
    const firstName = ticket.requester_first_name?.trim() || '';
    const lastName = ticket.requester_last_name?.trim() || '';
    const structuredName =
      [firstName, lastName].filter(Boolean).join(' ').trim() ||
      ticket.requester_email?.trim() ||
      '';
    const email =
      ticket.requester_email?.trim() ||
      requester.email ||
      '';
    const phone = ticket.requester_phone?.trim() || requester.phone;

    return {
      success: true,
      data: {
        ...this.toAdminView(ticket),
        description: ticket.description,
        requester_name: structuredName || requester.name,
        requester_first_name: firstName || undefined,
        requester_last_name: lastName || undefined,
        requester_email: email,
        requester_phone: phone,
        requester_document_type:
          ticket.requester_document_type?.trim() || undefined,
        requester_document_num:
          ticket.requester_document_num?.trim() || undefined,
        comments: ticket.comments,
        status_history: ticket.status_history,
      },
    };
  }

  /**
   * Super-admin variant of adminFindOne — same shape and response
   * mapper, but does NOT scope by `callerOrgId`. The super-admin
   * platform-wide oversight view must see PQRs from every tenant,
   * so the org filter is intentionally absent.
   *
   * PQR rows are still discriminated from generic support tickets
   * by the category enum OR the legacy `tags: { has: 'pqr' }` tag
   * (whichever was set on creation — see comment on the OR clause
   * below). Keeps the super-admin controller out of the business
   * of hand-rolling Prisma queries with exotic include shapes that
   * can blow up at runtime if the client/DB drift on a new enum
   * value.
   */
  async superAdminFindOne(id: number) {
    try {
      const ticket = await this.globalPrisma.support_tickets.findFirst({
        where: {
          id,
          // PQR rows are tagged with 'pqr' by createPublic() (see
          // pqr.service.ts line 177). This is the canonical, stable
          // discriminator — we previously tried layering a category
          // enum IN (...) check on top, but the running Prisma client
          // (v7.4.1 in the container) crashed with PrismaClientValidationError
          // because SUGGESTION wasn't in the deployed DB enum until the
          // 20260627101500 migration runs. To keep the deployed build
          // working regardless of migration state, we rely on the tags
          // discriminator alone. Migration can add the enum-side
          // check back once it's deployed everywhere.
          tags: { has: 'pqr' },
        },
        // Intentionally NOT including organization / store here — the
        // mapping layer below only needs assigned_to + comments +
        // status_history to render the admin view. Avoids pulling
        // extra joins that aren't required by the response shape.
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

      // Reuse the same response shape as adminFindOne so the frontend
      // gets an identical contract for store-admin and super-admin
      // GET /:id responses.
      const requester = this.parseRequester(ticket.description);
      const firstName = ticket.requester_first_name?.trim() || '';
      const lastName = ticket.requester_last_name?.trim() || '';
      const structuredName =
        [firstName, lastName].filter(Boolean).join(' ').trim() ||
        ticket.requester_email?.trim() ||
        '';
      const email =
        ticket.requester_email?.trim() || requester.email || '';
      const phone = ticket.requester_phone?.trim() || requester.phone;

      return {
        success: true as const,
        data: {
          ...this.toAdminView(ticket),
          description: ticket.description,
          requester_name: structuredName || requester.name,
          requester_first_name: firstName || undefined,
          requester_last_name: lastName || undefined,
          requester_full_name: structuredName,
          requester_email: email,
          requester_phone: phone,
          requester_document_type:
            ticket.requester_document_type?.trim() || undefined,
          requester_document_num:
            ticket.requester_document_num?.trim() || undefined,
          comments: ticket.comments,
          status_history: ticket.status_history,
        },
      };
    } catch (err) {
      if (err instanceof VendixHttpException) {
        throw err;
      }
      console.error(
        `[superAdminFindOne] id=${id} crashed:`,
        err instanceof Error ? err.stack : err,
      );
      throw err;
    }
  }

  /**
   * Allows the store-admin to fix typos in title / description /
   * requester fields of a PQR they just created. Guarded by status:
   * once the support team has picked it up (status !== NEW), edits
   * are blocked so the audit trail stays clean and the SLA timer
   * doesn't get reset by accidental saves. Super-admin callers set
   * `bypassStatusGuard: true` — the support team is the source of
   * truth for these rows and may need to correct contact data even
   * after the ticket is in flight.
   *
   * Audit: inserts a row in `support_status_history` with the diff so
   * the History card on the detail page can render "Editó X → Y" with
   * the original values. The diff uses simple `field: 'old' → 'new'`
   * lines joined by `; `.
   */
  async editContent(
    id: number,
    patch: {
      title?: string;
      description?: string;
      requester_first_name?: string | null;
      requester_last_name?: string | null;
      requester_email?: string | null;
      requester_phone?: string | null;
      requester_document_type?: string | null;
      requester_document_num?: string | null;
    },
    userId: number,
    opts: { bypassStatusGuard?: boolean } = {},
  ) {
    const orgVendix = await this.getPlatformOrgOrThrow();

    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: {
        ...this.buildPqrScope(),
        id,
      },
    });
    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }
    // Hard guard: editing is only allowed while the ticket hasn't
    // been touched by the support team. Once they reply or change
    // status, the ticket becomes part of an SLA-tracked conversation
    // and arbitrary edits would corrupt the audit trail. Super-admin
    // callers can opt out because they ARE the support team.
    if (!opts.bypassStatusGuard && ticket.status !== ticket_status_enum.NEW) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_006);
    }

    // Compute a compact diff for the audit log before applying the
    // update — old vs new per changed field, skipping no-op patches.
    const changes: string[] = [];
    if (patch.title !== undefined && patch.title !== ticket.title) {
      changes.push(`title: "${ticket.title}" → "${patch.title}"`);
    }
    if (
      patch.description !== undefined &&
      patch.description !== ticket.description
    ) {
      changes.push(`description: ${ticket.description.length} → ${patch.description.length} chars`);
    }
    const fieldPairs: Array<[string, string | null | undefined]> = [
      ['requester_first_name', ticket.requester_first_name],
      ['requester_last_name', ticket.requester_last_name],
      ['requester_email', ticket.requester_email],
      ['requester_phone', ticket.requester_phone],
      ['requester_document_type', ticket.requester_document_type],
      ['requester_document_num', ticket.requester_document_num],
    ];
    for (const [field, oldVal] of fieldPairs) {
      const newVal = patch[field as keyof typeof patch] as string | null | undefined;
      const normalized = newVal === undefined ? oldVal : newVal;
      if (normalized !== oldVal) {
        changes.push(`${field}: "${oldVal ?? ''}" → "${normalized ?? ''}"`);
      }
    }

    if (changes.length === 0) {
      return { success: true, data: { id, changed: 0 } };
    }

    const updated = await this.globalPrisma.support_tickets.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.requester_first_name !== undefined
          ? { requester_first_name: patch.requester_first_name }
          : {}),
        ...(patch.requester_last_name !== undefined
          ? { requester_last_name: patch.requester_last_name }
          : {}),
        ...(patch.requester_email !== undefined
          ? { requester_email: patch.requester_email }
          : {}),
        ...(patch.requester_phone !== undefined
          ? { requester_phone: patch.requester_phone }
          : {}),
        ...(patch.requester_document_type !== undefined
          ? { requester_document_type: patch.requester_document_type }
          : {}),
        ...(patch.requester_document_num !== undefined
          ? { requester_document_num: patch.requester_document_num }
          : {}),
        updated_at: new Date(),
      },
    });

    // Audit: status doesn't change, but we record the content edit as
    // a status_history entry so the History card surfaces "Edited by X
    // at Y" with the diff in change_notes. Same row schema re-used so
    // we don't need a parallel edit_log table.
    await this.globalPrisma.support_status_history.create({
      data: {
        ticket_id: id,
        old_status: ticket.status,
        new_status: ticket.status,
        change_reason: 'Edición de contenido por el solicitante',
        change_notes: changes.join('; '),
        changed_by_user_id: userId,
      },
    });

    this.logger.log(
      `PQR ${updated.ticket_number} content edited by user ${userId} (${changes.length} field${changes.length === 1 ? '' : 's'})`,
    );

    return { success: true, data: { id, changed: changes.length } };
  }

  async adminUpdate(id: number, dto: UpdatePqrDto, userId: number) {
    const orgVendix = await this.getPlatformOrgOrThrow();

    const existing = await this.globalPrisma.support_tickets.findFirst({
      where: {
        ...this.buildPqrScope(),
        id,
      },
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
        requester_email: ticket.requester_email ?? null,
        requester_name:
          (ticket.requester_first_name ?? '') +
          ' ' +
          (ticket.requester_last_name ?? ''),
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

  /**
   * Updates a comment's content. Restricted to the original author —
   * super-admin / store-admin can't edit each other's comments to keep
   * the conversation attribution intact. The audit row records who
   * edited and when so the History card surfaces the change.
   */
  async adminUpdateComment(
    id: number,
    commentId: number,
    content: string,
    userId: number,
  ) {
    // Mirror adminAddComment (commit 90588eea): drop the org-scope
    // OR filter. The previous where clause required the ticket to
    // belong to either the caller's org OR orgVendix, which silently
    // excluded tenant-scoped PQRs when called by super-admin
    // (callerOrgId is null/unrelated for them). The tag-based
    // discriminator alone is enough — super-admin by design reaches
    // every PQRS, and the authorship gate below still blocks
    // cross-role rewriting.
    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: { id, tags: { has: 'pqr' } },
      select: { id: true, ticket_number: true, status: true },
    });
    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }

    const comment = await this.globalPrisma.support_comments.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.ticket_id !== id) {
      throw new VendixHttpException(ErrorCodes.SUP_COMMENT_001);
    }

    // Authorship gate — only the original author can edit. Prevents a
    // store-admin from rewriting a super-admin's response (or vice
    // versa). The support_status_history row that follows records the
    // edit so the History card stays truthful.
    if (comment.author_id !== userId) {
      throw new VendixHttpException(ErrorCodes.SUP_COMMENT_002);
    }

    // Note: the previous "public comments are immutable" gate
    // (SUP_COMMENT_003, blocking edits to is_internal=false rows) has
    // been removed intentionally. The super-admin now needs to be able
    // to fix typos and refine wording in responses that were already
    // sent to the requester. The trade-off (potential inbox vs.
    // on-record discrepancy) is documented in the commit message —
    // the History card records every edit so the audit trail stays
    // complete, and the customer does NOT receive a re-notification
    // email (the edit is silent from their inbox perspective).

    const updated = await this.globalPrisma.support_comments.update({
      where: { id: commentId },
      data: {
        content,
        updated_at: new Date(),
      },
    });

    // Append a status_history row noting the edit. We piggyback on the
    // existing schema (no separate edit_log table) — the History card
    // surfaces "Comentario editado por X a las Y" via change_reason.
    //
    // old_status is nullable (no status transition happened — this is a
    // comment edit, not a status change); new_status is NOT NULL per
    // schema, so we re-use the ticket's current status to satisfy the
    // constraint without fabricating a status transition that didn't
    // occur.
    await this.globalPrisma.support_status_history.create({
      data: {
        ticket_id: id,
        old_status: null,
        new_status: ticket.status,
        change_reason: `Comentario editado por ${comment.author_name ?? `Admin #${userId}`}`,
        change_notes: `${comment.content.length} → ${content.length} chars`,
        changed_by_user_id: userId,
      },
    });

    this.logger.log(
      `Comment ${commentId} on PQR ${ticket.ticket_number} edited by user ${userId}`,
    );

    return { success: true, data: updated };
  }

  async adminAddComment(
    id: number,
    dto: AddPqrCommentDto,
    userId: number,
  ) {
    // NOTE: we previously scoped by organization_id: orgVendix.id here
    // assuming platform-wide PQRs only ever live under the Vendix
    // platform org. That's only true for /api/public/pqr (anonymous
    // storefront submissions with no tenant context). Store-admin
    // "Nueva solicitud" creates PQRS under the owning org (e.g.
    // Nike's org_id=6), which the previous filter excluded — so
    // super-admin writes silently 404'd on tenant-scoped PQRS even
    // though superAdminFindOne happily returned them.
    //
    // Mirror the read path: any row with tag 'pqr' is fair game.
    // The frontend is the source of truth for tenant boundary (a
    // store-admin writing to a Nike-owned PQRS is blocked upstream
    // by org-scope guards; super-admin reaches everything by design).
    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: { id, tags: { has: 'pqr' } },
    });
    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.SUP_PQR_003);
    }

    // orgVendix is still needed for the requester-notification lookup
    // below — fetch it lazily so we don't pay the round trip on the
    // happy path where no notification fires.
    let orgVendix: { id: number } | null = null;

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
        requester_email: ticket.requester_email ?? null,
        requester_name:
          (ticket.requester_first_name ?? '') +
          ' ' +
          (ticket.requester_last_name ?? ''),
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
    // No longer throw on missing legacy email — new PQRs (post-fix)
    // don't encode the requester block in the description because the
    // data lives in dedicated columns (requester_email etc.). The
    // caller falls back to those columns when this returns empty
    // values, so an empty result is the correct "use the columns"
    // signal here.
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
   * Generates a ticket number in the format PQRS-{orgId}-{counter}.
   *
   * Counts ALL PQR-shaped tickets under the org — both legacy `PQR-*`
   * numbers (issued before the visible UI rename) and new `PQRS-*`
   * numbers — so the counter stays continuous. Existing tickets keep
   * their original `PQR-*` value (no data migration); only newly filed
   * tickets use the `PQRS-` prefix going forward.
   */
  private async generatePqrNumber(orgId: number): Promise<string> {
    const count = await this.globalPrisma.support_tickets.count({
      where: {
        organization_id: orgId,
        ticket_number: { startsWith: 'PQR' },
      },
    });
    const padded = String(count + 1).padStart(5, '0');
    return `PQRS-${orgId}-${padded}`;
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
   * PETITION, COMPLAINT, CLAIM, SUGGESTION natively (SUGGESTION added
   * via migration 20260627101500_add_pqr_suggestion_type).
   */
  private mapPqrType(
    pqrType: 'PETITION' | 'COMPLAINT' | 'CLAIM' | 'SUGGESTION',
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
      pqr_type: t.category as 'PETITION' | 'COMPLAINT' | 'CLAIM' | 'SUGGESTION',
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