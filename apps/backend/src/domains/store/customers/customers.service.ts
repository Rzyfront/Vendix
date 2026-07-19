import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { user_state_enum } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AuditResource } from '../../../common/audit/audit.service';
import * as bcrypt from 'bcrypt';
import { toTitleCase } from '@common/utils/format.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private normalizeOptionalString(
    value?: string | null,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  /**
   * Normalize a Colombian DIAN document pair for both storage and lookup.
   *
   * - Type is uppercased + trimmed (e.g. `cc` → `CC`).
   * - Number is uppercased, trimmed, and stripped of separators (`. - space`).
   *   The trailing verification digit on NITs (`123456789-0`) is preserved as
   *   a single concatenated value so equality lookups work on the stored
   *   value regardless of whether the input used a hyphen.
   */
  private normalizeDocument(input: {
    type?: string | null;
    number?: string | null;
  }): { type: string | null; number: string | null } {
    const type = input.type ? input.type.trim().toUpperCase() : null;
    const number = input.number
      ? input.number.trim().toUpperCase().replace(/[\s\-.]/g, '')
      : null;
    return { type, number };
  }

  /**
   * Resuelve el email que se persistirá en `users.email` al crear/actualizar
   * un cliente. El correo es OPCIONAL: si el cliente no proporcionó uno,
   * devuelve `null` (no se generan placeholders ni correos falsos). El comercio
   * puede crear clientes sin email; la identificación se hace por documento,
   * teléfono o nombre.
   */
  private resolveCustomerEmail(
    email: string | null | undefined,
  ): string | null {
    const trimmed = (email ?? '').trim().toLowerCase();
    return trimmed ? trimmed : null;
  }

  /**
   * Genera un username único. Cuando hay email, deriva el base del local-part;
   * si no hay email, usa un seed alternativo (documento o nombre) y, en última
   * instancia, `cliente`. El contador del while garantiza unicidad real contra
   * la tabla `users`.
   */
  private async generateUniqueUsername(
    seed: string | null,
  ): Promise<string> {
    const rawBase = seed ? seed.split('@')[0] : '';
    // Eliminar caracteres especiales
    let baseUsername = rawBase.replace(/[^a-zA-Z0-9]/g, '');
    if (!baseUsername) {
      baseUsername = 'cliente';
    }

    let username = baseUsername;
    let counter = 1;

    while (true) {
      const existingUser = await this.prisma.users.findUnique({
        where: { username },
      });

      if (!existingUser) {
        return username;
      }

      username = `${baseUsername}${counter}`;
      counter++;
    }
  }

  private generateTemporaryPassword(length = 10): string {
    const charset =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; ++i) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      password += charset[randomIndex];
    }
    return password;
  }

  private async generateUnreachablePassword(): Promise<string> {
    const random = randomBytes(32).toString('hex');
    return bcrypt.hash(random, 12);
  }

  /**
   * Build the `users.create` payload for a guest customer (rol `customer`,
   * unreachable password, `pending_verification`, STORE_ECOMMERCE settings).
   * Single source of truth shared by `resolveGuestCustomerForCheckout`
   * (guest ecommerce checkout) and `resolveTableGuestCustomer` (QR dine-in),
   * so the guest-user shape never diverges between the two entry points.
   * `email` is nullable — the diner may identify by name + phone/document only.
   */
  private buildGuestUserData(args: {
    username: string;
    email: string | null;
    hashedPassword: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    documentType: string | null;
    documentNumber: string | null;
    organizationId: number;
    storeId: number;
    customerRoleId: number;
  }) {
    return {
      email: args.email,
      password: args.hashedPassword,
      first_name: args.firstName,
      last_name: args.lastName,
      phone: this.normalizeOptionalString(args.phone),
      document_type: args.documentType,
      document_number: args.documentNumber,
      username: args.username,
      email_verified: false,
      state: 'pending_verification' as const,
      organizations: { connect: { id: args.organizationId } },
      user_roles: {
        create: {
          role_id: args.customerRoleId,
        },
      },
      store_users: {
        create: {
          store_id: args.storeId,
        },
      },
      user_settings: {
        create: {
          app_type: 'STORE_ECOMMERCE' as const,
          config: {
            panel_ui: {
              profile: true,
              history: true,
              dashboard: true,
              favorites: true,
              orders: true,
              settings: true,
            },
          },
        },
      },
    };
  }

  async resolveGuestCustomerForCheckout(
    storeId: number,
    guest: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone?: string | null;
      document_type?: string | null;
      document_number?: string | null;
    } | null,
  ): Promise<{
    customer_id: number;
    was_created: boolean;
    was_updated: boolean;
  } | null> {
    if (!guest) return null;

    const normalizedEmail = guest.email?.toLowerCase().trim() || null;
    const normalizedPhone = guest.phone?.replace(/\s+/g, '').trim() || null;
    const normalizedDoc = this.normalizeDocument({
      type: guest.document_type ?? null,
      number: guest.document_number ?? null,
    });

    if (!normalizedEmail && !normalizedPhone) return null;

    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { id: true, organization_id: true },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    let existing: { id: number } | null = null;

    if (normalizedEmail) {
      existing = await this.prisma.users.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          store_users: { some: { store_id: storeId } },
          user_roles: { some: { roles: { name: 'customer' } } },
        },
        select: { id: true },
      });
    }

    if (!existing && normalizedPhone) {
      existing = await this.prisma.users.findFirst({
        where: {
          phone: normalizedPhone,
          store_users: { some: { store_id: storeId } },
          user_roles: { some: { roles: { name: 'customer' } } },
        },
        select: { id: true },
      });
    }

    if (!existing) {
      if (!normalizedEmail) return null;

      const customerRole = await this.prisma.roles.findFirst({
        where: { name: 'customer' },
      });

      if (!customerRole) {
        throw new VendixHttpException(ErrorCodes.CUST_CREATE_001);
      }

      const hashedPassword = await this.generateUnreachablePassword();
      const formattedFirstName =
        toTitleCase(guest.first_name ?? '') || 'Cliente';
      const formattedLastName =
        toTitleCase(guest.last_name ?? '') || 'Invitado';

      const buildUserData = (username: string) =>
        this.buildGuestUserData({
          username,
          email: normalizedEmail,
          hashedPassword,
          firstName: formattedFirstName,
          lastName: formattedLastName,
          phone: normalizedPhone,
          documentType: normalizedDoc.type,
          documentNumber: normalizedDoc.number,
          organizationId: store.organization_id,
          storeId: store.id,
          customerRoleId: customerRole.id,
        });

      let user: {
        id: number;
        first_name: string;
        last_name: string | null;
        email: string | null;
      };
      try {
        const username = await this.generateUniqueUsername(normalizedEmail);
        user = await this.prisma.users.create({
          data: buildUserData(username),
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        });
      } catch (error: any) {
        const isUsernameConflict =
          error?.code === 'P2002' &&
          Array.isArray(error?.meta?.target) &&
          error.meta.target.includes('username');

        if (!isUsernameConflict) throw error;

        const retryUsername =
          await this.generateUniqueUsername(normalizedEmail);
        user = await this.prisma.users.create({
          data: buildUserData(retryUsername),
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        });
      }

      this.eventEmitter.emit('customer.created', {
        store_id: store.id,
        customer_id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      });

      return {
        customer_id: user.id,
        was_created: true,
        was_updated: false,
      };
    }

    const data: Record<string, string> = {};
    if (guest.first_name?.trim()) {
      data.first_name = toTitleCase(guest.first_name);
    }
    if (guest.last_name?.trim()) {
      data.last_name = toTitleCase(guest.last_name);
    }
    if (normalizedPhone) {
      data.phone = normalizedPhone;
    }
    if (normalizedDoc.type) {
      data.document_type = normalizedDoc.type;
    }
    if (normalizedDoc.number) {
      data.document_number = normalizedDoc.number;
    }

    const hasUpdates = Object.keys(data).length > 0;
    if (hasUpdates) {
      await this.prisma.users.update({
        where: { id: existing.id },
        data,
      });
    }

    try {
      await this.linkCustomerToStore(existing.id, storeId);
    } catch {
      // El enlace ya existe o se creó en paralelo; ignorar para mantener idempotencia.
    }

    return {
      customer_id: existing.id,
      was_created: false,
      was_updated: hasUpdates,
    };
  }

  /**
   * Resolve (or create) a guest `users` row (rol `customer`) for a diner who
   * identifies at a restaurant table (QR dine-in "cliente presentado").
   *
   * Unlike `resolveGuestCustomerForCheckout`, the email is OPTIONAL: a diner
   * is identified by name plus phone/document. Dedupe order:
   *   1. by email (case-insensitive), when provided;
   *   2. else by phone, when provided;
   *   3. otherwise a fresh guest is created (identified by name only).
   *
   * The created row mirrors the guest-checkout shape via `buildGuestUserData`
   * (unreachable password, `state: 'pending_verification'`,
   * `email_verified: false`, org connect, rol customer, store link,
   * STORE_ECOMMERCE settings). Tenant-safe: uses the same `StorePrismaService`
   * as `resolveGuestCustomerForCheckout`.
   */
  async resolveTableGuestCustomer(
    store_id: number,
    data: {
      first_name: string;
      last_name?: string;
      phone?: string;
      email?: string;
      document_type?: string;
      document_number?: string;
    },
  ): Promise<{ customer_id: number; name: string; was_created: boolean }> {
    const normalizedEmail = data.email?.toLowerCase().trim() || null;
    const normalizedPhone = data.phone?.replace(/\s+/g, '').trim() || null;
    const normalizedDoc = this.normalizeDocument({
      type: data.document_type ?? null,
      number: data.document_number ?? null,
    });

    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: { id: true, organization_id: true },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    // Dedupe against store-scoped customer rows: email first (when present),
    // else phone. A diner without email or phone always creates a fresh row.
    let existing: {
      id: number;
      first_name: string;
      last_name: string | null;
    } | null = null;

    if (normalizedEmail) {
      existing = await this.prisma.users.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          store_users: { some: { store_id } },
          user_roles: { some: { roles: { name: 'customer' } } },
        },
        select: { id: true, first_name: true, last_name: true },
      });
    }

    if (!existing && normalizedPhone) {
      existing = await this.prisma.users.findFirst({
        where: {
          phone: normalizedPhone,
          store_users: { some: { store_id } },
          user_roles: { some: { roles: { name: 'customer' } } },
        },
        select: { id: true, first_name: true, last_name: true },
      });
    }

    if (existing) {
      return {
        customer_id: existing.id,
        name: [existing.first_name, existing.last_name]
          .filter(Boolean)
          .join(' ')
          .trim(),
        was_created: false,
      };
    }

    const customerRole = await this.prisma.roles.findFirst({
      where: { name: 'customer' },
    });

    if (!customerRole) {
      throw new VendixHttpException(ErrorCodes.CUST_CREATE_001);
    }

    const hashedPassword = await this.generateUnreachablePassword();
    const formattedFirstName = toTitleCase(data.first_name ?? '') || 'Cliente';
    const formattedLastName = toTitleCase(data.last_name ?? '') || 'Invitado';

    // Username seed: email → phone → document → first name. The while-counter
    // in `generateUniqueUsername` guarantees real uniqueness against `users`.
    const usernameSeed =
      normalizedEmail ??
      normalizedPhone ??
      normalizedDoc.number ??
      formattedFirstName;

    const buildUserData = (username: string) =>
      this.buildGuestUserData({
        username,
        email: normalizedEmail,
        hashedPassword,
        firstName: formattedFirstName,
        lastName: formattedLastName,
        phone: normalizedPhone,
        documentType: normalizedDoc.type,
        documentNumber: normalizedDoc.number,
        organizationId: store.organization_id,
        storeId: store.id,
        customerRoleId: customerRole.id,
      });

    let user: { id: number; first_name: string; last_name: string | null };
    try {
      const username = await this.generateUniqueUsername(usernameSeed);
      user = await this.prisma.users.create({
        data: buildUserData(username),
        select: { id: true, first_name: true, last_name: true },
      });
    } catch (error: any) {
      const isUsernameConflict =
        error?.code === 'P2002' &&
        Array.isArray(error?.meta?.target) &&
        error.meta.target.includes('username');

      if (!isUsernameConflict) throw error;

      const retryUsername = await this.generateUniqueUsername(usernameSeed);
      user = await this.prisma.users.create({
        data: buildUserData(retryUsername),
        select: { id: true, first_name: true, last_name: true },
      });
    }

    this.eventEmitter.emit('customer.created', {
      store_id: store.id,
      customer_id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: normalizedEmail,
    });

    return {
      customer_id: user.id,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim(),
      was_created: true,
    };
  }

  async create(storeId: number, dto: CreateCustomerDto) {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    // Email efectivo para plataforma. El correo es OPCIONAL: si el cliente no
    // proporcionó uno, queda `null` (no se generan placeholders ni correos
    // falsos). La identificación se hace por documento, teléfono o nombre.
    const effectiveEmail = this.resolveCustomerEmail(dto.email);

    // Solo verificamos duplicidad por email cuando realmente hay un email.
    // Sin email no aplica el chequeo de unicidad de correo.
    if (effectiveEmail) {
      const existingUser = await this.prisma.users.findFirst({
        where: {
          email: effectiveEmail,
          organization_id: store.organization_id,
        },
      });

      if (existingUser) {
        throw new VendixHttpException(ErrorCodes.SYS_CONFLICT_001);
      }
    }

    // Normalize document pair before any DB lookup so uniqueness, storage
    // and downstream queries all share the same canonical form.
    const normalizedDoc = this.normalizeDocument({
      type: dto.document_type ?? null,
      number: dto.document_number ?? null,
    });

    if (normalizedDoc.number && normalizedDoc.type) {
      const existingByDocument = await this.findByDocumentInOrganization(
        store.organization_id,
        normalizedDoc.number,
        normalizedDoc.type,
      );

      if (existingByDocument) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe un cliente con este documento en la organización',
        );
      }
    }

    // Find customer role
    const customerRole = await this.prisma.roles.findFirst({
      where: { name: 'customer' },
    });

    if (!customerRole) {
      throw new VendixHttpException(ErrorCodes.CUST_CREATE_001);
    }

    const password = this.generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(password, 12);
    // Semilla para el username: email si existe, si no documento, si no nombre.
    // El contador del while garantiza unicidad real contra la tabla `users`.
    const usernameSeed =
      effectiveEmail ?? normalizedDoc.number ?? dto.first_name ?? null;
    const username = await this.generateUniqueUsername(usernameSeed);

    // Convertir nombres a Title Case
    const formatted_first_name = toTitleCase(dto.first_name || '');
    const formatted_last_name = toTitleCase(dto.last_name || '');

    // Create user
    const user = await this.prisma.users.create({
      data: {
        email: effectiveEmail,
        password: hashedPassword,
        first_name: formatted_first_name,
        last_name: formatted_last_name,
        phone: this.normalizeOptionalString(dto.phone),
        document_type: normalizedDoc.type,
        document_number: normalizedDoc.number,
        tax_regime: this.normalizeOptionalString(dto.tax_regime),
        person_type: this.normalizeOptionalString(dto.person_type),
        ...(dto.is_withholding_agent != null
          ? { is_withholding_agent: dto.is_withholding_agent }
          : {}),
        username: username,
        email_verified: false,
        organizations: { connect: { id: store.organization_id } },
        user_roles: {
          create: {
            role_id: customerRole.id,
          },
        },
        store_users: {
          create: {
            store_id: store.id,
          },
        },
        user_settings: {
          create: {
            app_type: 'STORE_ECOMMERCE',
            config: {
              panel_ui: {
                profile: true,
                history: true,
                dashboard: true,
                favorites: true,
                orders: true,
                settings: true,
              },
            },
          },
        },
      },
      include: {
        user_roles: true,
        store_users: true,
      },
    });

    this.eventEmitter.emit('customer.created', {
      store_id: store.id,
      customer_id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
    });

    return user;
  }

  async findAll(
    storeId: number,
    query?: { search?: string; page?: number; limit?: number },
  ) {
    const { search, page = 1, limit = 20 } = query || {};
    const skip = (page - 1) * limit;

    const where: any = {
      store_users: {
        some: {
          store_id: storeId,
        },
      },
      user_roles: {
        some: {
          roles: {
            name: 'customer',
          },
        },
      },
      // Archived customers must not appear in admin list views. The endpoint
      // does not currently accept an explicit `state` filter, so we hide
      // archived records unconditionally. The single-record endpoints
      // (findOne / findByEmail) keep returning archived rows so admins can
      // edit or restore them.
      state: { not: user_state_enum.archived },
    };

    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { document_number: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          addresses: {
            where: { type: 'shipping' },
            orderBy: { is_primary: 'desc' },
          },
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Top-N clientes de la tienda ordenados por NÚMERO de órdenes `finished`.
   * Pensado para pre-mostrar en el buscador de clientes del POS.
   *
   * 1. Agrega órdenes finished por `customer_id` (store-scoped, ignora null).
   * 2. Carga los usuarios con la MISMA forma PosCustomer que `findAll`
   *    (rol customer + store link + direcciones shipping primarias).
   * 3. Devuelve el arreglo en el MISMO orden del ranking, cada item con
   *    `order_count` (= _count._all). Sin clientes con órdenes → `[]`.
   */
  async getTopCustomers(storeId: number, limit = 5) {
    const grouped = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        store_id: storeId,
        state: 'finished',
        customer_id: { not: null },
      },
      _count: { _all: true, customer_id: true },
      orderBy: { _count: { customer_id: 'desc' } },
      take: limit,
    });

    const ranking = grouped
      .filter((g) => g.customer_id != null)
      .map((g) => ({
        customer_id: g.customer_id as number,
        order_count: g._count._all,
      }));

    if (ranking.length === 0) {
      return [];
    }

    const customerIds = ranking.map((r) => r.customer_id);

    // Misma forma PosCustomer que `findAll`: rol customer + store link +
    // direcciones shipping ordenadas por is_primary. `users` no está scoped
    // por StorePrismaService (getter baseClient), de ahí el filtro manual.
    const users = await this.prisma.users.findMany({
      where: {
        id: { in: customerIds },
        store_users: {
          some: {
            store_id: storeId,
          },
        },
        user_roles: {
          some: {
            roles: {
              name: 'customer',
            },
          },
        },
      },
      include: {
        addresses: {
          where: { type: 'shipping' },
          orderBy: { is_primary: 'desc' },
        },
      },
    });

    const usersById = new Map(users.map((u) => [u.id, u]));

    // Preserva el orden del ranking del groupBy y adjunta order_count.
    return ranking
      .map((r) => {
        const user = usersById.get(r.customer_id);
        if (!user) return null;
        return { ...user, order_count: r.order_count };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  async findOne(storeId: number, id: number) {
    const user = await this.prisma.users.findFirst({
      where: {
        id,
        store_users: {
          some: {
            store_id: storeId,
          },
        },
        user_roles: {
          some: {
            roles: {
              name: 'customer',
            },
          },
        },
      },
      include: {
        addresses: {
          where: { type: 'shipping' },
          orderBy: { is_primary: 'desc' },
        },
      },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
    }

    return user;
  }

  async update(storeId: number, id: number, dto: UpdateCustomerDto) {
    const user = await this.findOne(storeId, id);

    // Effective document pair to validate: payload overrides take precedence;
    // when a payload field is undefined we fall back to the current stored value.
    const effectiveType =
      dto.document_type !== undefined ? dto.document_type : user.document_type;
    const effectiveNumber =
      dto.document_number !== undefined
        ? dto.document_number
        : user.document_number;

    const normalizedDoc = this.normalizeDocument({
      type: effectiveType ?? null,
      number: effectiveNumber ?? null,
    });

    // Only check uniqueness when caller actually changes type or number.
    const isChangingDocument =
      dto.document_type !== undefined || dto.document_number !== undefined;

    if (
      isChangingDocument &&
      normalizedDoc.number &&
      normalizedDoc.type &&
      user.organization_id
    ) {
      const conflict = await this.findByDocumentInOrganization(
        user.organization_id,
        normalizedDoc.number,
        normalizedDoc.type,
      );

      if (conflict && conflict.id !== user.id) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe un cliente con este documento en la organización',
        );
      }
    }

    return this.prisma.users.update({
      where: { id: user.id },
      data: {
        first_name: dto.first_name,
        last_name: dto.last_name,
        phone: this.normalizeOptionalString(dto.phone),
        document_number:
          dto.document_number !== undefined ? normalizedDoc.number : undefined,
        document_type:
          dto.document_type !== undefined ? normalizedDoc.type : undefined,
        tax_regime:
          dto.tax_regime !== undefined
            ? this.normalizeOptionalString(dto.tax_regime)
            : undefined,
        person_type:
          dto.person_type !== undefined
            ? this.normalizeOptionalString(dto.person_type)
            : undefined,
        is_withholding_agent:
          dto.is_withholding_agent !== undefined
            ? dto.is_withholding_agent
            : undefined,
        // Email opcional: si viene en el payload lo normalizamos (null cuando
        // queda vacío, sin placeholders). Si no viene (undefined) no se toca.
        email:
          dto.email !== undefined
            ? dto.email?.trim().toLowerCase() || null
            : undefined,
      },
    });
  }

  async remove(storeId: number, id: number) {
    const user = await this.findOne(storeId, id);

    // Check if user has orders or other dependencies that prevent deletion?
    // For now, standard delete might fail if foreign keys exist.
    // Prisma `users` delete might be too aggressive if cascade is not set up or set up to cascade.
    // Safe delete often means soft delete or check dependencies.
    // Given "CRUD Basico", I will attempt delete.

    return this.prisma.users.delete({
      where: { id: user.id },
    });
  }

  async findByDocumentInOrganization(
    organizationId: number,
    documentNumber: string,
    documentType?: string,
  ): Promise<any | null> {
    // Defensive normalization: callers may pass raw user input (POS lookup,
    // legacy clients, etc.). Stored values are normalized, so we must look
    // them up by the same canonical form.
    const normalized = this.normalizeDocument({
      type: documentType ?? null,
      number: documentNumber ?? null,
    });

    if (!normalized.number) {
      return null;
    }

    const where: any = {
      organization_id: organizationId,
      document_number: { equals: normalized.number, mode: 'insensitive' },
      user_roles: {
        some: {
          roles: {
            name: 'customer',
          },
        },
      },
    };

    if (normalized.type) {
      where.document_type = normalized.type;
    }

    return this.prisma.users.findFirst({
      where,
      include: {
        user_roles: true,
        store_users: true,
        addresses: {
          where: { type: 'shipping' },
          orderBy: { is_primary: 'desc' },
        },
      },
    });
  }

  async linkCustomerToStore(userId: number, storeId: number): Promise<void> {
    const existing = await this.prisma.store_users.findFirst({
      where: {
        user_id: userId,
        store_id: storeId,
      },
    });

    if (!existing) {
      await this.prisma.store_users.create({
        data: {
          user_id: userId,
          store_id: storeId,
        },
      });
    }
  }

  /**
   * Claim a pre-existing customer account for a store.
   *
   * Used when a customer was created in the POS / backoffice ("customers"
   * module) — state stays at pending_verification with a temp password
   * they don't know — and later tries to sign up on the ecommerce.
   * Instead of returning a generic 409, the register endpoint detects the
   * existing user, returns CUSTOMER_ALREADY_EXISTS_CLAIMABLE, and the
   * password-reset flow calls this method to:
   *   1. Link the user to the new store (linkCustomerToStore, idempotent)
   *   2. Activate the user (state active + email_verified true)
   *
   * Safe to call repeatedly — both sub-operations are idempotent.
   */
  async claimCustomerAccount(
    userId: number,
    storeId: number,
  ): Promise<{ activated: boolean }> {
    await this.linkCustomerToStore(userId, storeId);

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { state: true, email_verified: true },
    });

    let activated = false;
    if (user && (user.state !== 'active' || !user.email_verified)) {
      await this.prisma.users.update({
        where: { id: userId },
        data: {
          state: 'active',
          email_verified: true,
        },
      });
      activated = true;
    }

    return { activated };
  }

  async getStats(storeId: number) {
    try {
      // Get current month start date
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Get all customers for the store
      const where = {
        store_users: {
          some: {
            store_id: storeId,
          },
        },
        user_roles: {
          some: {
            roles: {
              name: 'customer',
            },
          },
        },
      };

      const [totalCustomers, newCustomersThisMonth] = await Promise.all([
        // Total customers count
        this.prisma.users.count({ where }),

        // New customers this month
        this.prisma.users.count({
          where: {
            ...where,
            created_at: {
              gte: currentMonthStart,
            },
          },
        }),
      ]);

      // Calculate active customers (customers who have made at least one order)
      const activeCustomers = await this.prisma.users.count({
        where: {
          ...where,
          orders: {
            some: {
              store_id: storeId,
            },
          },
        },
      });

      // Calculate total revenue from all customer orders
      const revenueResult = await this.prisma.orders.aggregate({
        where: {
          store_id: storeId,
          state: 'finished',
          customer_id: {
            not: null,
          },
        },
        _sum: {
          grand_total: true,
        },
      });

      const totalRevenue = revenueResult._sum.grand_total || 0;

      return {
        total_customers: totalCustomers,
        active_customers: activeCustomers,
        new_customers_this_month: newCustomersThisMonth,
        total_revenue: totalRevenue,
      };
    } catch (error) {
      throw new VendixHttpException(
        ErrorCodes.SYS_INTERNAL_001,
        'Error calculating customer stats',
      );
    }
  }
}
