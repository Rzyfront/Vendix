import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { user_state_enum } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ResolveCustomerDto } from './dto/resolve-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AuditResource } from '../../../common/audit/audit.service';
import * as bcrypt from 'bcrypt';
import { toTitleCase } from '@common/utils/format.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { computeNitDv, normalizeNit } from '../../../common/utils/nit.util';

/**
 * Columnas de `users` que NUNCA pueden salir por la API de clientes.
 *
 * El módulo lee la tabla `users` completa —los clientes de una tienda SON
 * usuarios— y ninguna de estas consultas declaraba `select` ni `omit`, así que
 * `GET /store/customers` y `GET /store/customers/:id` devolvían la fila entera:
 * el hash bcrypt de la contraseña y el secreto TOTP viajaban al navegador de
 * cualquiera con permiso `customers:read`.
 *
 * Un hash bcrypt no es una contraseña, pero es material para atacarla sin
 * límite de intentos y sin dejar rastro en `failed_login_attempts`; el secreto
 * TOTP directamente permite generar el segundo factor. `locked_until` y
 * `failed_login_attempts` se van con ellos porque describen el estado del
 * candado de la cuenta, que es información de seguridad y no de facturación.
 *
 * Se aplica en el SERVICIO y no en el controlador a propósito: los mismos
 * métodos los consumen checkout, mesas y el buscador del POS, y una limpieza
 * puesta en la capa HTTP dejaría fuera a esos tres caminos.
 *
 * NO se aplica a las consultas internas de autenticación —que sí necesitan el
 * hash— porque ésas viven en `AuthService` sobre su propio cliente Prisma.
 */
const CUSTOMER_PRIVATE_COLUMNS = {
  password: true,
  two_factor_secret: true,
  failed_login_attempts: true,
  locked_until: true,
} as const;

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
   * Separa el NIT de su dígito de verificación SIN fundirlos nunca.
   *
   * `normalizeDocument()` borra el guion junto con puntos y espacios, y en un
   * NIT ese guion no es ruido: es la frontera entre el número y su DV. Sobre
   * `900123456-8` deja `9001234568`, y a partir de ahí el número y el DV son
   * indistinguibles — se persiste un `document_number` de 10 dígitos con el DV
   * pegado y un `verification_digit` calculado sobre ese número inflado. En el
   * XML eso sale como `cbc:CompanyID` erróneo con un `@schemeID` que la DIAN
   * recomputa distinto, y el documento se rechaza habiendo gastado el
   * consecutivo.
   *
   * Por eso el número CRUDO (tal como lo escribió el comerciante) es la fuente:
   * si trae guion, la frontera es explícita y manda. Si no lo trae, el número
   * es el NIT íntegro y el DV es el del campo aparte. No se adivina: un NIT sin
   * guion que "parezca" traer el DV pegado se rechaza con un mensaje que lo
   * explica, en vez de recortarle un dígito por suposición.
   */
  private splitNitAndDv(
    rawNumber: string | null | undefined,
    normalizedNumber: string,
    providedDv: string | null | undefined,
  ): { number: string | null; dv: string | null; mismatch: boolean } {
    const raw = (rawNumber ?? '').trim();
    const dv = (providedDv ?? '').trim();
    const nitInput = raw.includes('-')
      ? raw
      : normalizedNumber + (dv ? `-${dv}` : '');
    const result = normalizeNit(nitInput);

    // El número traía el DV pegado Y además vino un DV aparte: si no son el
    // mismo dígito, el comerciante declaró dos verdades distintas.
    const inlineConflict =
      raw.includes('-') && !!dv && result.provided_dv !== null && result.provided_dv !== dv;

    return {
      number: result.number || null,
      dv: result.dv || null,
      mismatch:
        inlineConflict || (result.provided_dv !== null && result.dv_mismatch),
    };
  }

  /** Mensaje de DV que dice cuál es el correcto y por qué pudo fallar. */
  private nitDvMismatchMessage(nit: string, provided: string | null): string {
    const expected = computeNitDv(nit);
    return (
      `El dígito de verificación '${provided ?? ''}' no corresponde al NIT ` +
      `'${nit}': el módulo 11 de la DIAN da '${expected}'. Si escribiste el ` +
      `NIT con el DV pegado, sepáralos: el número va sin DV y el DV en su ` +
      `propio campo.`
    );
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
      document_type: args.documentType as any,
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
          // Treat archived customers as "no longer exists" so a guest with
          // the same email/phone can be created fresh instead of attaching
          // to an archived row.
          state: { not: user_state_enum.archived },
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
          state: { not: user_state_enum.archived },
        },
        select: { id: true },
      });
    }

    if (!existing) {
      if (!normalizedEmail) return null;

      const customerRole = await this.prisma.roles.findFirst({
        where: { name: 'customer', organization_id: null, is_system_role: true },
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
   * QUI-723 — POS finalize-sale "resolver cliente" flow.
   *
   * Find an existing customer by email (priority) or by exact
   * (document_type, document_number), and create one only if neither matches.
   *
   * Distinct from `resolveGuestCustomerForCheckout`:
   *   1. Match priority is email-first, then document — NOT email/phone.
   *      Email wins because it's globally unique per org; document is the
   *      fallback when the cashier doesn't capture an email.
   *   2. The match is ORGANIZATION-scoped (mirrors `findByDocumentInOrganization`)
   *      so customers from sister stores don't collide.
   *   3. When the customer exists, updates are CONSERVATIVE: only null/empty
   *      fields on the existing row get filled. We never overwrite data the
   *      cashier previously confirmed ("si el cliente ya existe simplemente
   *      no hay que cambiarle nada" — dev lead spec).
   *   4. When no match is found, we delegate to `create()` so we inherit the
   *      username-uniqueness retry loop, NIT/DV split, password hashing, and
   *      the `customer.created` event.
   *
   * Returns the customer plus audit flags so the frontend can surface a
   * "cliente actualizado / creado" toast.
   */
  async findOrCreateByEmailOrDocument(
    storeId: number,
    dto: ResolveCustomerDto,
  ): Promise<{
    customer: any;
    was_created: boolean;
    was_updated: boolean;
    matched_by: 'email' | 'document' | null;
  }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { id: true, organization_id: true },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    const effectiveEmail = this.resolveCustomerEmail(dto.email);
    const normalizedDoc = this.normalizeDocument({
      type: dto.document_type ?? null,
      number: dto.document_number ?? null,
    });

    // Match 1 — email first (case-insensitive, org-scoped, archived excluded).
    let existing: any = null;
    let matched_by: 'email' | 'document' | null = null;

    if (effectiveEmail) {
      existing = await this.prisma.users.findFirst({
        where: {
          email: { equals: effectiveEmail, mode: 'insensitive' },
          organization_id: store.organization_id,
          user_roles: { some: { roles: { name: 'customer' } } },
          state: { not: user_state_enum.archived },
        },
        omit: CUSTOMER_PRIVATE_COLUMNS,
      });
      if (existing) matched_by = 'email';
    }

    // Match 2 — exact (document_type, document_number) only if no email match.
    // The type must match exactly: CC 123 ≠ NIT 123 even when the number
    // string is identical (DIAN fiscal identity).
    if (!existing && normalizedDoc.number && normalizedDoc.type) {
      existing = await this.findByDocumentInOrganization(
        store.organization_id,
        normalizedDoc.number,
        normalizedDoc.type,
      );
      if (existing) matched_by = 'document';
    }

    if (existing) {
      // Conservative partial update — see `buildConservativeUpdatePayload`.
      const updateData = this.buildConservativeUpdatePayload(existing, dto);

      let was_updated = false;
      if (Object.keys(updateData).length > 0) {
        await this.prisma.users.update({
          where: { id: existing.id },
          data: updateData,
        });
        was_updated = true;

        this.eventEmitter.emit('customer.updated', {
          store_id: store.id,
          customer_id: existing.id,
          email: existing.email,
          first_name: existing.first_name,
          // The fields the conservative update just filled — what the email
          // should highlight as "ahora sabemos esto de vos".
          updated_fields: Object.keys(updateData),
        });
      }

      // Idempotent: link the customer to this store if not yet linked.
      // Mirrors the guest-checkout pattern (`resolveGuestCustomerForCheckout:431`).
      try {
        await this.linkCustomerToStore(existing.id, storeId);
      } catch {
        // Link already exists or raced; ignore to keep the resolve idempotent.
      }

      // Merge update data into the returned customer so the response reflects
      // the POST-resolve state. Without this, the frontend would see a stale
      // `customer` when `was_updated: true` (the `existing` snapshot was
      // captured before the update ran).
      const resolved = was_updated
        ? ({ ...existing, ...updateData } as any)
        : existing;

      return {
        customer: resolved,
        was_created: false,
        was_updated,
        matched_by,
      };
    }

    // No match — delegate to `create()` so we inherit all its guards
    // (username uniqueness, NIT/DV split, password hashing, customer.created event).
    const created = await this.create(storeId, dto);

    return {
      customer: created,
      was_created: true,
      was_updated: false,
      matched_by: null,
    };
  }

  /**
   * QUI-723 — Build the partial-update payload for `findOrCreateByEmailOrDocument`.
   *
   * The dev lead's spec was unambiguous on this: when the customer already
   * exists we must NOT overwrite fields that were previously confirmed.
   * We only fill NULL or EMPTY fields on the existing row using values from
   * the incoming DTO.
   *
   * Email is intentionally excluded: if the existing customer matched the
   * incoming email, the strings already coincide (the lookup was
   * case-insensitive). Including it would also force an unnecessary
   * unique-constraint check.
   *
   * Document fields get the same canonicalization as `normalizeDocument()`
   * so a `cc 123.456` request matches an existing `CC123456` row and we
   * write it back in the same form.
   */
  private buildConservativeUpdatePayload(
    existing: {
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      document_type: string | null;
      document_number: string | null;
    },
    incoming: CreateCustomerDto,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    const fillIfEmpty = (
      existingValue: string | null,
      incomingValue: string | null | undefined,
      field: string,
      transform?: (s: string) => string,
    ) => {
      if (existingValue) return; // protect confirmed data
      if (!incomingValue) return;
      const trimmed = incomingValue.trim();
      if (!trimmed) return;
      data[field] = transform ? transform(trimmed) : trimmed;
    };

    fillIfEmpty(existing.first_name, incoming.first_name, 'first_name');
    fillIfEmpty(existing.last_name, incoming.last_name, 'last_name');
    fillIfEmpty(existing.phone, incoming.phone, 'phone');
    fillIfEmpty(
      existing.document_type,
      incoming.document_type,
      'document_type',
      (s) => s.toUpperCase(),
    );
    fillIfEmpty(
      existing.document_number,
      incoming.document_number,
      'document_number',
      (s) => s.toUpperCase().replace(/[\s\-.]/g, ''),
    );

    return data;
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
          // Skip archived rows so a new guest is created instead of attaching
          // to an archived customer with the same email/phone.
          state: { not: user_state_enum.archived },
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
          state: { not: user_state_enum.archived },
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
      where: { name: 'customer', organization_id: null, is_system_role: true },
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
          // Archived customers are not "in use" — allow re-creating a new
          // customer that re-uses the same email after the old row was
          // archived (mirrors the document dedup filter in
          // findByDocumentInOrganization).
          state: { not: user_state_enum.archived },
        },
      });

      if (existingUser) {
        // Pasamos `details.kind` para que el bulk service pueda generar
        // un mensaje específico ("este correo ya está tomado") y NO un
        // genérico "Resource conflict" en inglés.
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'El correo electrónico ya está registrado en la organización',
          { kind: 'email', value: effectiveEmail },
        );
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
        // Igual que el caso del email: el `details.kind` permite al bulk
        // service generar la acción sugerida ("usa otro documento") sin
        // hardcodear el copy aquí.
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe un cliente con este documento en la organización',
          {
            kind: 'document',
            value: normalizedDoc.number,
            type: normalizedDoc.type,
          },
        );
      }
    }

    // Find customer role
    const customerRole = await this.prisma.roles.findFirst({
      where: { name: 'customer', organization_id: null, is_system_role: true },
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

    // QUI-728 — DIAN Anexo Técnico 19 customer fiscal data. The DTO layer has
    // already validated the cross-field rules (JuridicaNameRule, NitDvMatches,
    // FiscalResponsibilityInCatalogRule); here we only translate the validated
    // payload into the canonical shape the UBL builder expects.
    const isJuridica = dto.person_type === 'JURIDICA';

    // Persona natural → first/last populated. Persona jurídica → both forced
    // to null so the UBL builder emits `cac:PartyLegalEntity/RegistrationName`
    // instead of `cac:Person/FirstName + FamilyName`.
    const formatted_first_name = isJuridica
      ? null
      : toTitleCase(dto.first_name || '') || null;
    const formatted_last_name = isJuridica
      ? null
      : toTitleCase(dto.last_name || '') || null;
    const formatted_legal_name = isJuridica
      ? (dto.legal_name?.trim() || null)
      : null;

    // NIT + verification_digit split. If the merchant typed a DV that
    // disagrees with computeNitDv(), DIAN will reject the document after
    // burning a fiscal consecutive; refuse BEFORE persisting. For non-NIT
    // document types we keep the previously-normalized pair (no DV split).
    let finalDocumentType: string | null = normalizedDoc.type;
    let finalDocumentNumber: string | null = normalizedDoc.number;
    let finalVerificationDigit: string | null = null;

    if (
      normalizedDoc.type === 'NIT' &&
      normalizedDoc.number
    ) {
      const nitResult = this.splitNitAndDv(
        dto.document_number,
        normalizedDoc.number,
        dto.verification_digit,
      );
      finalDocumentNumber = nitResult.number;
      finalVerificationDigit = nitResult.dv;

      if (nitResult.mismatch) {
        throw new VendixHttpException(
          ErrorCodes.CUSTOMER_NIT_DV_MISMATCH,
          this.nitDvMismatchMessage(
            nitResult.number ?? normalizedDoc.number,
            dto.verification_digit ?? null,
          ),
          { field: 'verification_digit' },
        );
      }
    }

    // Create user
    const user = await this.prisma.users.create({
      data: {
        email: effectiveEmail,
        password: hashedPassword,
        first_name: formatted_first_name ?? '',
        last_name: formatted_last_name ?? '',
        legal_name: formatted_legal_name,
        phone: this.normalizeOptionalString(dto.phone),
        document_type: finalDocumentType as any,
        document_number: finalDocumentNumber,
        verification_digit: finalVerificationDigit,
        tax_regime: this.normalizeOptionalString(dto.tax_regime) as any,
        person_type: this.normalizeOptionalString(dto.person_type) as any,
        fiscal_responsibilities: dto.fiscal_responsibilities ?? [],
        ciiu_code:
          dto.ciiu_code !== undefined
            ? this.normalizeOptionalString(dto.ciiu_code)
            : null,
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
      omit: CUSTOMER_PRIVATE_COLUMNS,
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
        omit: CUSTOMER_PRIVATE_COLUMNS,
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
    // Hide archived customers from POS lookup so they don't appear in the
    // top customers list (matches the `findAll` behavior).
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
        state: { not: user_state_enum.archived },
      },
      omit: CUSTOMER_PRIVATE_COLUMNS,
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
      omit: CUSTOMER_PRIVATE_COLUMNS,
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
    const effectiveVerificationDigit =
      dto.verification_digit !== undefined
        ? dto.verification_digit
        : user.verification_digit;

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

    // QUI-728 — NIT + verification_digit split. If the merchant typed a DV
    // that disagrees with computeNitDv(), refuse BEFORE persisting.
    let nextDocumentNumber: string | null | undefined = undefined;
    let nextVerificationDigit: string | null | undefined = undefined;
    if (
      isChangingDocument &&
      normalizedDoc.type === 'NIT' &&
      normalizedDoc.number
    ) {
      const nitResult = this.splitNitAndDv(
        dto.document_number ?? effectiveNumber,
        normalizedDoc.number,
        effectiveVerificationDigit,
      );
      nextDocumentNumber = nitResult.number;
      nextVerificationDigit = nitResult.dv;

      if (nitResult.mismatch) {
        throw new VendixHttpException(
          ErrorCodes.CUSTOMER_NIT_DV_MISMATCH,
          this.nitDvMismatchMessage(
            nitResult.number ?? normalizedDoc.number,
            effectiveVerificationDigit ?? null,
          ),
          { field: 'verification_digit' },
        );
      }
    }

    // QUI-728 — jurídica ↔ legal_name swap on update. When the persona type
    // changes JURIDICA → NATURAL we clear `legal_name`. When it switches the
    // other way we require `legal_name` (validated at DTO layer) and clear
    // first/last names so the UBL builder emits the right branch.
    const effectivePersonType =
      dto.person_type !== undefined ? dto.person_type : user.person_type;
    const nextIsJuridica = effectivePersonType === 'JURIDICA';

    // Persona switches NATURAL → JURIDICA on update: caller must include
    // `legal_name` (DTO enforces this). We also null first/last so the
    // existing natural name doesn't leak into the jurídica record.
    let firstNameUpdate: string | undefined = undefined;
    let lastNameUpdate: string | undefined = undefined;
    if (dto.person_type !== undefined && nextIsJuridica) {
      firstNameUpdate = '';
      lastNameUpdate = '';
    }

    return this.prisma.users.update({
      where: { id: user.id },
      data: {
        first_name: firstNameUpdate !== undefined ? firstNameUpdate : (dto.first_name ?? ''),
        last_name: lastNameUpdate !== undefined ? lastNameUpdate : (dto.last_name ?? ''),
        legal_name:
          dto.legal_name !== undefined
            ? (dto.legal_name?.trim() || null)
            : dto.person_type === 'NATURAL' && user.person_type === 'JURIDICA'
              ? null
              : undefined,
        phone: this.normalizeOptionalString(dto.phone),
        document_number:
          nextDocumentNumber !== undefined ? nextDocumentNumber : undefined,
        document_type:
          dto.document_type !== undefined ? (normalizedDoc.type as any) : undefined,
        verification_digit:
          nextVerificationDigit !== undefined ? nextVerificationDigit : undefined,
        tax_regime:
          dto.tax_regime !== undefined
            ? (this.normalizeOptionalString(dto.tax_regime) as any)
            : undefined,
        person_type:
          dto.person_type !== undefined
            ? (this.normalizeOptionalString(dto.person_type) as any)
            : undefined,
        fiscal_responsibilities:
          dto.fiscal_responsibilities !== undefined
            ? dto.fiscal_responsibilities
            : undefined,
        ciiu_code:
          dto.ciiu_code !== undefined
            ? this.normalizeOptionalString(dto.ciiu_code)
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
      omit: CUSTOMER_PRIVATE_COLUMNS,
    });
  }

  async remove(storeId: number, id: number) {
    // Soft archive: `users` is referenced by 30+ tables (orders, sales_orders,
    // invoices, refunds, store_users, user_roles, addresses, etc.) and a hard
    // delete explodes with FK violations as soon as the customer has any
    // history. Archiving keeps the row for audit, accounting and order
    // history, and the existing `state: { not: archived }` filter in `findAll`
    // hides archived customers from admin list views. `findOne` still returns
    // archived rows so admins can view, edit or restore them. This mirrors the
    // pattern in `org-suppliers.service.ts:343` and `org-users.service.ts:432`.
    const user = await this.findOne(storeId, id);

    if (user.state === user_state_enum.archived) {
      return user;
    }

    return this.prisma.users.update({
      where: { id: user.id },
      data: {
        state: user_state_enum.archived,
        updated_at: new Date(),
      },
      omit: CUSTOMER_PRIVATE_COLUMNS,
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
      // Treat archived customers as "no longer exists" for create-time dedup
      // so an admin can re-create a customer that was previously archived.
      state: { not: user_state_enum.archived },
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
      omit: CUSTOMER_PRIVATE_COLUMNS,
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
    // Do NOT re-activate an archived customer. An archived customer is gone
    // for purposes of "this store"; restoring them must be an explicit admin
    // action, not a side effect of the password-reset claim flow.
    if (
      user &&
      user.state !== user_state_enum.archived &&
      (user.state !== 'active' || !user.email_verified)
    ) {
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
        // Mirror findAll: archived customers do not count toward totals,
        // "this month" or "active" stats.
        state: { not: user_state_enum.archived },
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
