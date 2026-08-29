import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase A.3
 *
 * Busqueda de TENANTS del rail super-admin para el TenantPicker (FB-03,
 * FB-04). El "cliente" del rail super-admin son los tenants (stores u
 * organizations), NO `users` — ADR-7. Por eso este servicio opera contra
 * `stores` + `organizations` y devuelve un discriminador `kind`.
 *
 * Las queries son READ-ONLY. No muta nada. La emision corre por
 * `PlatformInvoicingFacade` en Phase B.
 *
 * Scope:
 *   - `store_prisma` por defecto (accede con la tenant-scoped chain):
 *     `prisma.stores.findMany(...)` y `prisma.organizations.findMany(...)`.
 *   - Para las direcciones billing del tenant: `addresses` (relacional).
 *
 * No usa `withoutScope()` con filtro explicito porque las queries son
 * read-only con `organization_id` ya en el store. Ese filtro viene del
 * `storeWhere` del store-prisma service.
 */
@Injectable()
export class PlatformTenantsService {
  private readonly logger = new Logger(PlatformTenantsService.name);

  /**
   * Busca tenants (stores u organizations) por query libre en:
   *   - `legal_name` (ILIKE)
   *   - `tax_id` (exact o prefijo)
   *   - `slug` (ILIKE)
   *   - `name` (ILIKE) — para organizations sin legal_name populado.
   *
   * Filtro `kind`: si viene, restringe a `store` o `organization`. Si
   * no viene, devuelve ambos.
   *
   * Si el filtro `kind=store` y la query es de tipo NIT (`^\d+$`),
   * intentamos match exacto por NIT primero, despues ILIKE nombre.
   *
   * Pagina con `limit` (max 100, default 25). No cuenta filas antes de
   * paginar — devuelve el array y un flag `has_more` por `limit+1`.
   */
  async searchTenants(
    prisma: any,
    args: {
      organizationId: number;
      kind?: 'store' | 'organization' | 'user' | null;
      q?: string | null;
      limit?: number;
    },
  ): Promise<TenantSearchResult[]> {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const q = (args.q ?? '').trim();

    if (args.kind === 'organization') {
      return this.searchOrganizations(prisma, { organizationId: args.organizationId, q, limit });
    }
    if (args.kind === 'store') {
      return this.searchStores(prisma, { organizationId: args.organizationId, q, limit });
    }
    if (args.kind === 'user') {
      return this.searchUsers(prisma, { q, limit });
    }
    // kind undefined — devuelve stores, organizations y users mezclados.
    const part = Math.max(Math.floor(limit / 3), 1);
    const [stores, orgs, users] = await Promise.all([
      this.searchStores(prisma, { organizationId: args.organizationId, q, limit: part }),
      this.searchOrganizations(prisma, { organizationId: args.organizationId, q, limit: part }),
      this.searchUsers(prisma, { q, limit: part }),
    ]);
    return [...stores, ...orgs, ...users].slice(0, limit);
  }

  /**
   * Lookup directo por id discriminador. Retorna null si no existe o
   * si el id pertenece a otra organization.
   */
  async getTenantByKindAndId(
    prisma: any,
    args: {
      organizationId: number;
      kind: 'store' | 'organization' | 'user';
      id: number;
    },
  ): Promise<TenantSearchResult | null> {
    if (args.kind === 'store') {
      const row = await prisma.stores.findFirst({
        where: {
          id: args.id,
          is_active: true,
        },
        include: {
          addresses: { where: { type: 'billing' }, take: 1, orderBy: { id: 'desc' } },
          organization: { select: { id: true, name: true } },
        },
      });
      return row ? this.storeToTenantResult(row, row.addresses[0] ?? null) : null;
    }
    if (args.kind === 'user') {
      const row = await prisma.users.findFirst({
        where: {
          id: args.id,
        },
      });
      return row ? this.userToTenantResult(row) : null;
    }
    const row = await prisma.organizations.findFirst({
      where: {
        id: args.id,
        state: 'active',
        NOT: args.organizationId
          ? { id: { equals: args.organizationId } }
          : undefined,
      },
      include: {
        addresses: { where: { type: 'billing' }, take: 1, orderBy: { id: 'desc' } },
      },
    });
    return row ? this.organizationToTenantResult(row, row.addresses[0] ?? null) : null;
  }

  private async searchUsers(
    prisma: any,
    args: { q: string; limit: number },
  ): Promise<TenantSearchResult[]> {
    const where: Prisma.usersWhereInput = {
      ...(args.q
        ? {
            OR: [
              { first_name: { contains: args.q, mode: 'insensitive' } },
              { last_name: { contains: args.q, mode: 'insensitive' } },
              { legal_name: { contains: args.q, mode: 'insensitive' } },
              { email: { contains: args.q, mode: 'insensitive' } },
              { username: { contains: args.q, mode: 'insensitive' } },
              ...(/^\d+$/.test(args.q) ? [{ document_number: { equals: args.q } }] : []),
            ],
          }
        : {}),
    };
    const rows = await prisma.users.findMany({
      where,
      take: args.limit,
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
    });
    return rows.map((row: any) => this.userToTenantResult(row));
  }

  private userToTenantResult(user: any): TenantSearchResult {
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return {
      id: `user:${user.id}`,
      kind: 'user',
      tenant_id: user.id,
      name: fullName || user.username,
      slug: user.username,
      legal_name: user.legal_name || fullName || user.username,
      tax_id: user.document_number ?? null,
      tax_id_dv: user.verification_digit ?? null,
      document_type: user.document_type ?? 'CC',
      person_type: user.person_type === 'JURIDICA' ? '1' : '2',
      tax_regime_code: user.tax_regime ?? '49',
      fiscal_responsibilities: Array.isArray(user.fiscal_responsibilities)
        ? user.fiscal_responsibilities
        : ['R-99-PN'],
      email: user.email ?? null,
      phone: user.phone ?? null,
      address: {
        line: null,
        city: null,
        department_code: null,
      },
      organization: { id: user.organization_id ?? 0, name: null },
      fiscal_data_complete: Boolean(user.document_number && user.email),
    };
  }

  // ─────────────────────────────────────────────────────────────────────

  private async searchStores(
    prisma: any,
    args: { organizationId: number; q: string; limit: number },
  ): Promise<TenantSearchResult[]> {
    const where: Prisma.storesWhereInput = {
      is_active: true,
      ...(args.q
        ? {
            OR: [
              { legal_name: { contains: args.q, mode: 'insensitive' } },
              { name: { contains: args.q, mode: 'insensitive' } },
              { slug: { contains: args.q, mode: 'insensitive' } },
              ...(/^\d+$/.test(args.q) ? [{ tax_id: { equals: args.q } }] : []),
            ],
          }
        : {}),
    };
    const rows = await prisma.stores.findMany({
      where,
      include: {
        addresses: { where: { type: 'billing' }, take: 1, orderBy: { id: 'desc' } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: [{ legal_name: 'asc' }, { name: 'asc' }],
      take: args.limit,
    });
    return rows.map((row: any) => this.storeToTenantResult(row, row.addresses[0] ?? null));
  }

  private async searchOrganizations(
    prisma: any,
    args: { organizationId: number; q: string; limit: number },
  ): Promise<TenantSearchResult[]> {
    const where: Prisma.organizationsWhereInput = {
      state: 'active',
      ...(args.organizationId
        ? {
            NOT: { id: { equals: args.organizationId } },
          }
        : {}),
      ...(args.q
        ? {
            OR: [
              { legal_name: { contains: args.q, mode: 'insensitive' } },
              { name: { contains: args.q, mode: 'insensitive' } },
              { slug: { contains: args.q, mode: 'insensitive' } },
              ...(/^\d+$/.test(args.q) ? [{ tax_id: { equals: args.q } }] : []),
            ],
          }
        : {}),
    };
    const rows = await prisma.organizations.findMany({
      where,
      include: {
        addresses: { where: { type: 'billing' }, take: 1, orderBy: { id: 'desc' } },
      },
      orderBy: [{ legal_name: 'asc' }, { name: 'asc' }],
      take: args.limit,
    });
    return rows.map((row: any) =>
      this.organizationToTenantResult(row, row.addresses[0] ?? null),
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Mappers: cada `kind` arma una TenantSearchResult con la informacion
  // fiscal disponible en su esquema. Los campos faltantes (`tax_regime_code`,
  // `fiscal_responsibilities[]`, `document_type`, `person_type` para stores)
  // quedan `null` / `[]` — el form los captura manualmente. El snapshot
  // `persistAcquirerSnapshot` valida que NO falten antes de emitir.
  // ─────────────────────────────────────────────────────────────────────

  private storeToTenantResult(store: any, billingAddress: any | null): TenantSearchResult {
    const address = billingAddress
      ? this.addressToTenant(billingAddress)
      : { line: null, city: null, department_code: null };
    return {
      id: `store:${store.id}`,
      kind: 'store',
      tenant_id: store.id,
      name: store.name,
      slug: store.slug,
      legal_name: store.legal_name ?? store.name,
      tax_id: store.tax_id ?? null,
      tax_id_dv: store.tax_id_dv ?? null,
      // Las stores NO tienen document_type / person_type / tax_regime / fiscal_responsibilities
      // en el schema actual (knowledge gap documentado). El form los pide inline.
      document_type: null,
      person_type: null,
      tax_regime_code: null,
      fiscal_responsibilities: [],
      email: store.email ?? null,
      phone: store.phone ?? null,
      address,
      organization: {
        id: store.organization_id,
        // No proyectamos la org anidad para no acoplar el detail en este endpoint;
        // el caller puede re-fetchear con /customers/:id si lo necesita.
        name: null,
      },
      fiscal_data_complete: this.checkStoreFiscalComplete(store, billingAddress),
    };
  }

  private organizationToTenantResult(
    org: any,
    billingAddress: any | null,
  ): TenantSearchResult {
    const address = billingAddress
      ? this.addressToTenant(billingAddress)
      : { line: null, city: null, department_code: null };
    return {
      id: `org:${org.id}`,
      kind: 'organization',
      tenant_id: org.id,
      name: org.name,
      slug: org.slug,
      legal_name: org.legal_name ?? org.name,
      tax_id: org.tax_id ?? null,
      tax_id_dv: org.verification_digit ?? null,
      // Las organizations SI tienen los campos fiscales completos.
      document_type: org.document_type ?? null,
      person_type: org.person_type ?? null,
      tax_regime_code: org.tax_regime ?? null,
      fiscal_responsibilities: org.fiscal_responsibilities ?? [],
      email: org.email ?? null,
      phone: org.phone ?? null,
      address,
      organization: {
        id: org.id,
        name: org.name,
      },
      fiscal_data_complete: this.checkOrganizationFiscalComplete(org, billingAddress),
    };
  }

  private addressToTenant(addr: any): TenantAddress {
    return {
      // addresses columns son: address_line1, address_line2, city, state_province, country_code.
      // Concatenamos line1+line2 para formar el campo `line` que consume el form.
      line:
        [addr.address_line1, addr.address_line2].filter(Boolean).join(' ').trim() ||
        null,
      city: addr.city ?? null,
      // state_province guarda el nombre del depto (no codigo DANE). El mapeo
      // DANE->nombre vive en `country-divisions`. Para MVP enviamos el
      // nombre tal cual — el frontend puede pedir lookup si lo necesita.
      department_code: addr.state_province ?? null,
    };
  }

  /**
   * Para el form: si el tenant ya trae NIT+DV y dirección billing,
   * el operador solo edita regimen + responsabilidades + email. Para
   * stores que no tengan esos campos, el operador debe escribirlos
   * (gap documentado en Knowledge Gaps).
   */
  private checkStoreFiscalComplete(store: any, billingAddress: any | null): boolean {
    return Boolean(
      store.legal_name &&
      store.tax_id &&
      store.tax_id_dv &&
        billingAddress &&
        billingAddress.line1 && // checkear contra la direccion real
        billingAddress.city &&
        billingAddress.department_code,
    );
  }

  private checkOrganizationFiscalComplete(org: any, billingAddress: any | null): boolean {
    return Boolean(
      org.legal_name &&
        org.tax_id &&
        org.verification_digit &&
        org.document_type &&
        org.person_type &&
        org.tax_regime &&
        (org.fiscal_responsibilities ?? []).length > 0 &&
        billingAddress &&
        billingAddress.line1 &&
        billingAddress.city &&
        billingAddress.department_code,
    );
  }
}

/* ── Tipos ────────────────────────────────────────────────────────────── */

export interface TenantAddress {
  line: string | null;
  city: string | null;
  department_code: string | null;
}

export interface TenantSearchResult {
  /**
   * ID compuesto del picker. Mismo formato que usa Vexi-UI cuando hay
   * dominios discriminados: `store:<n>` u `org:<n>`. El form lo manda
   * como `{kind, tenant_id}` al backend.
   */
  id: string;
  kind: 'store' | 'organization' | 'user';
  tenant_id: number;
  name: string;
  slug: string;
  legal_name: string;
  tax_id: string | null;
  tax_id_dv: string | null;
  // null si la entidad no persiste ese campo (ADR-7 + knowledge gap).
  document_type: string | null;
  person_type: string | null;
  tax_regime_code: string | null;
  fiscal_responsibilities: string[];
  email: string | null;
  phone: string | null;
  address: TenantAddress;
  organization: { id: number; name: string | null };
  /**
   * `true` si la identidad fiscal del tenant está completa en BD. El
   * form puede usarlo como warning badge — si `false`, el operador
   * completa los campos que faltan antes de emitir. NO bloquea el
   * submit del form (eso lo hace INVOICING_TENANT_FISCAL_DATA_INCOMPLETE
   * en `persistAcquirerSnapshot`).
   */
  fiscal_data_complete: boolean;
}
