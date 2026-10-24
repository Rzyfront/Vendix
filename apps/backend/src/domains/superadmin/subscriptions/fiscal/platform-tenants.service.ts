import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DIAN_DEPARTMENTS,
  isDianDepartmentCode,
  resolveDianMunicipality,
} from '../../../store/invoicing/providers/dian-direct/constants/dian-geography';
import { DIAN_ID_TYPES } from '../../../store/invoicing/providers/dian-direct/constants/dian-document-types';
import {
  DIAN_DOCUMENT_TYPE_BY_NIT_TYPE,
  DIAN_PERSON_TYPE_BY_LABEL,
} from '../../../../common/helpers/organization-fiscal-columns.helper';
import { resolveVatResponsibility } from '../../../../common/helpers/vat-responsibility.helper';
import { normalizeFiscalResponsibilityCode } from '../../../../common/constants/fiscal-responsibilities';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase A.3
 *
 * Busqueda de ADQUIRIENTES del rail super-admin para el TenantPicker (FB-03,
 * FB-04). Cuatro fuentes, discriminadas por `kind`:
 *   - `store` / `organization` — tenants (ADR-7).
 *   - `user` — usuarios de la plataforma.
 *   - `customer` — clientes externos (`platform_customers`), alimentados por
 *     el upsert que corre al emitir a un `customer.kind = 'external'`.
 *
 * Las queries son READ-ONLY. No muta nada.
 *
 * CONVENCIONES DE SALIDA (las del emisor DIAN de plataforma y del frontend
 * `PERSON_TYPE_OPTIONS`):
 *   - `document_type`: CÓDIGO DIAN ('31' NIT, '13' CC, ...), nunca la etiqueta.
 *   - `person_type`: '1' Persona Jurídica / '2' Persona Natural
 *     (`cbc:AdditionalAccountID`).
 *   - `tax_regime_code`: '48' responsable de IVA / '49' no responsable —
 *     DERIVADO de las responsabilidades declaradas (casilla 53), no copiado de
 *     un régimen COMUN/SIMPLIFICADO.
 *   - `fiscal_responsibilities`: códigos RUT normalizados (`O-13`, `R-99-PN`).
 * Lo que la fuente no persiste queda `null` / `[]`: nunca se inventa.
 */
@Injectable()
export class PlatformTenantsService {
  private readonly logger = new Logger(PlatformTenantsService.name);

  /**
   * Busca adquirientes por query libre. Filtro `kind`: si viene, restringe a
   * esa fuente; si no, mezcla las cuatro (reparto equitativo del `limit`).
   */
  async searchTenants(
    prisma: any,
    args: {
      organizationId: number;
      kind?: TenantKind | null;
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
    if (args.kind === 'customer') {
      return this.searchCustomers(prisma, { q, limit });
    }
    // kind undefined — devuelve las cuatro fuentes mezcladas.
    const part = Math.max(Math.floor(limit / 4), 1);
    const [stores, orgs, users, customers] = await Promise.all([
      this.searchStores(prisma, { organizationId: args.organizationId, q, limit: part }),
      this.searchOrganizations(prisma, { organizationId: args.organizationId, q, limit: part }),
      this.searchUsers(prisma, { q, limit: part }),
      this.searchCustomers(prisma, { q, limit: part }),
    ]);
    return [...stores, ...orgs, ...users, ...customers].slice(0, limit);
  }

  /**
   * Lookup directo por id discriminador. Retorna null si no existe o
   * si el id pertenece a otra organization.
   */
  async getTenantByKindAndId(
    prisma: any,
    args: {
      organizationId: number;
      kind: TenantKind;
      id: number;
    },
  ): Promise<TenantSearchResult | null> {
    if (args.kind === 'store') {
      const row = await prisma.stores.findFirst({
        where: {
          id: args.id,
          is_active: true,
        },
        include: STORE_INCLUDE,
      });
      return row ? this.storeToTenantResult(row) : null;
    }
    if (args.kind === 'user') {
      const row = await prisma.users.findFirst({
        where: {
          id: args.id,
        },
        include: USER_INCLUDE,
      });
      return row ? this.userToTenantResult(row) : null;
    }
    if (args.kind === 'customer') {
      const row = await prisma.platform_customers.findUnique({
        where: { id: args.id },
      });
      return row ? this.customerToTenantResult(row) : null;
    }
    const row = await prisma.organizations.findFirst({
      where: {
        id: args.id,
        state: 'active',
        NOT: args.organizationId
          ? { id: { equals: args.organizationId } }
          : undefined,
      },
      include: ORGANIZATION_INCLUDE,
    });
    return row ? this.organizationToTenantResult(row) : null;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Búsquedas por fuente
  // ─────────────────────────────────────────────────────────────────────

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
      include: USER_INCLUDE,
      take: args.limit,
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
    });
    return rows.map((row: any) => this.userToTenantResult(row));
  }

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
      include: STORE_INCLUDE,
      orderBy: [{ legal_name: 'asc' }, { name: 'asc' }],
      take: args.limit,
    });
    return rows.map((row: any) => this.storeToTenantResult(row));
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
      include: ORGANIZATION_INCLUDE,
      orderBy: [{ legal_name: 'asc' }, { name: 'asc' }],
      take: args.limit,
    });
    return rows.map((row: any) => this.organizationToTenantResult(row));
  }

  /**
   * Clientes externos (`platform_customers`): por documento exacto o prefijo
   * y por razón social / correo (contiene, sin distinguir mayúsculas). Los
   * facturados más recientemente primero.
   */
  private async searchCustomers(
    prisma: any,
    args: { q: string; limit: number },
  ): Promise<TenantSearchResult[]> {
    const q = args.q;
    const where: Prisma.platform_customersWhereInput = q
      ? {
          OR: [
            { tax_id: { startsWith: q.replace(/[.\s]/g, '') } },
            { legal_name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const rows = await prisma.platform_customers.findMany({
      where,
      orderBy: [
        { last_invoiced_at: { sort: 'desc', nulls: 'last' } },
        { legal_name: 'asc' },
      ],
      take: args.limit,
    });
    return rows.map((row: any) => this.customerToTenantResult(row));
  }

  // ─────────────────────────────────────────────────────────────────────
  // Mappers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Tienda → adquiriente. La identidad fiscal de la tienda vive repartida:
   * columnas de `stores` (NIT, DV, `nit_type`, municipio, departamento) y
   * `store_settings.settings.fiscal_data` (tipo de persona, casilla 53,
   * dirección fiscal). Bajo `fiscal_scope = ORGANIZATION` la tienda NO tiene
   * identidad propia: manda la de la organización (mismo criterio que
   * `SettingsService.getFiscalData`). Bajo alcance STORE, los huecos se heredan
   * de la organización SOLO si la tienda es la misma persona jurídica (sin NIT
   * propio o con el mismo NIT); una tienda con NIT distinto no hereda nada.
   */
  storeToTenantResult(store: any): TenantSearchResult {
    const org = store.organizations ?? null;
    const orgFiscalData = asRecord(org?.organization_settings?.settings)?.fiscal_data;
    const orgFd = asRecord(orgFiscalData);
    const storeFd = asRecord(asRecord(store.store_settings?.settings)?.fiscal_data);

    const orgScope = org?.fiscal_scope === 'ORGANIZATION';
    const storeTaxId = clean(store.tax_id);
    const orgTaxId = clean(org?.tax_id);
    const sameEntity = orgScope || !storeTaxId || (orgTaxId !== null && storeTaxId === orgTaxId);

    // Fuente principal y fuente de respaldo de `fiscal_data`.
    const primaryFd = orgScope ? orgFd : storeFd;
    const fallbackFd = !orgScope && sameEntity ? orgFd : null;

    const taxId = orgScope
      ? (orgTaxId ?? storeTaxId)
      : (storeTaxId ?? (sameEntity ? orgTaxId : null));
    const taxIdDv = orgScope
      ? (clean(org?.verification_digit) ?? clean(store.tax_id_dv))
      : (clean(store.tax_id_dv) ?? (sameEntity ? clean(org?.verification_digit) : null));

    const nitType = orgScope
      ? str(primaryFd, 'nit_type')
      : (clean(store.nit_type) ?? str(storeFd, 'nit_type'));
    let documentType = toDianDocumentType(nitType);
    if (!documentType && sameEntity) {
      documentType = toDianDocumentType(org?.document_type) ?? toDianDocumentType(str(orgFd, 'nit_type'));
    }
    // Sólo el NIT lleva DV: un DV registrado sin tipo declarado implica NIT.
    if (!documentType && taxId && taxIdDv) documentType = '31';

    const personType =
      toDianPersonType(str(primaryFd, 'person_type')) ??
      toDianPersonType(str(fallbackFd, 'person_type')) ??
      (sameEntity ? toDianPersonType(org?.person_type) : null) ??
      personTypeFromDocument(documentType);

    const declared = readResponsibilities(primaryFd);
    const responsibilities = declared.length
      ? declared
      : sameEntity
        ? (readResponsibilities(fallbackFd).length
            ? readResponsibilities(fallbackFd)
            : normalizeResponsibilities(org?.fiscal_responsibilities))
        : [];
    const taxRegimeCode =
      deriveTaxRegimeCode(responsibilities, str(primaryFd, 'tax_regime')) ??
      (sameEntity ? clean(org?.tax_regime) : null);

    const billing = pickAddress(store.addresses);
    const address = this.buildAddress(billing, {
      line: str(primaryFd, 'fiscal_address') ?? str(fallbackFd, 'fiscal_address'),
      city: str(primaryFd, 'city') ?? str(fallbackFd, 'city'),
      city_code:
        (orgScope ? null : clean(store.municipality_code)) ??
        str(primaryFd, 'municipality_code') ??
        str(fallbackFd, 'municipality_code'),
      department_code: orgScope ? null : clean(store.department_code),
      department_name: str(primaryFd, 'department') ?? str(fallbackFd, 'department'),
    });

    const result: TenantSearchResult = {
      id: `store:${store.id}`,
      kind: 'store',
      tenant_id: store.id,
      name: store.name,
      slug: store.slug,
      legal_name:
        (orgScope ? clean(org?.legal_name) : null) ??
        clean(store.legal_name) ??
        str(primaryFd, 'legal_name') ??
        store.name,
      tax_id: taxId,
      tax_id_dv: taxIdDv,
      document_type: documentType,
      person_type: personType,
      tax_regime_code: taxRegimeCode,
      fiscal_responsibilities: responsibilities,
      // `stores` no tiene columnas de correo/teléfono: el de la organización
      // es el contacto fiscal cuando la tienda es la misma entidad.
      email: clean(store.email) ?? (sameEntity ? clean(org?.email) : null),
      phone:
        clean(store.phone) ??
        clean(billing?.phone_number) ??
        (sameEntity ? clean(org?.phone) : null),
      address,
      organization: {
        // El campo de salida conserva el nombre `organization` (contrato HTTP
        // del picker, ADR-7) aunque la relación Prisma sea `organizations`.
        id: store.organization_id,
        name: org?.name ?? null,
      },
      fiscal_data_complete: false,
    };
    result.fiscal_data_complete = isAcquirerFiscalComplete(result);
    return result;
  }

  organizationToTenantResult(org: any): TenantSearchResult {
    const fd = asRecord(asRecord(org.organization_settings?.settings)?.fiscal_data);
    const documentType =
      toDianDocumentType(org.document_type) ?? toDianDocumentType(str(fd, 'nit_type'));
    const declared = normalizeResponsibilities(org.fiscal_responsibilities);
    const responsibilities = declared.length ? declared : readResponsibilities(fd);
    const billing = pickAddress(org.addresses);
    const address = this.buildAddress(billing, {
      line: str(fd, 'fiscal_address'),
      city: str(fd, 'city'),
      city_code: str(fd, 'municipality_code'),
      department_code: null,
      department_name: str(fd, 'department'),
    });

    const result: TenantSearchResult = {
      id: `org:${org.id}`,
      kind: 'organization',
      tenant_id: org.id,
      name: org.name,
      slug: org.slug,
      legal_name: clean(org.legal_name) ?? org.name,
      tax_id: clean(org.tax_id),
      tax_id_dv: clean(org.verification_digit),
      document_type: documentType,
      person_type:
        toDianPersonType(org.person_type) ??
        toDianPersonType(str(fd, 'person_type')) ??
        personTypeFromDocument(documentType),
      tax_regime_code:
        deriveTaxRegimeCode(responsibilities, str(fd, 'tax_regime')) ??
        clean(org.tax_regime),
      fiscal_responsibilities: responsibilities,
      email: clean(org.email),
      phone: clean(org.phone) ?? clean(billing?.phone_number),
      address,
      organization: {
        id: org.id,
        name: org.name,
      },
      fiscal_data_complete: false,
    };
    result.fiscal_data_complete = isAcquirerFiscalComplete(result);
    return result;
  }

  userToTenantResult(user: any): TenantSearchResult {
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    // Un usuario sin tipo declarado es persona natural (CC), no NIT.
    const documentType = toDianDocumentType(user.document_type) ?? '13';
    const responsibilities = normalizeResponsibilities(user.fiscal_responsibilities);
    const billing = pickAddress(user.addresses);
    const address = this.buildAddress(billing, {});

    const result: TenantSearchResult = {
      id: `user:${user.id}`,
      kind: 'user',
      tenant_id: user.id,
      name: fullName || user.username,
      slug: user.username,
      legal_name: user.legal_name || fullName || user.username,
      tax_id: clean(user.document_number),
      tax_id_dv: clean(user.verification_digit),
      document_type: documentType,
      person_type:
        toDianPersonType(user.person_type) ?? personTypeFromDocument(documentType),
      // `users.tax_regime` es el enum COMUN/SIMPLIFICADO/...; el contrato pide
      // el código '48'/'49' derivado de la casilla 53 (régimen como respaldo).
      tax_regime_code: deriveTaxRegimeCode(responsibilities, user.tax_regime),
      fiscal_responsibilities: responsibilities,
      email: clean(user.email),
      phone: clean(user.phone) ?? clean(billing?.phone_number),
      address,
      organization: { id: user.organization_id ?? null, name: null },
      fiscal_data_complete: false,
    };
    result.fiscal_data_complete = isAcquirerFiscalComplete(result);
    return result;
  }

  customerToTenantResult(row: any): TenantSearchResult {
    const result: TenantSearchResult = {
      id: `customer:${row.id}`,
      kind: 'customer',
      tenant_id: row.id,
      name: row.legal_name,
      slug: row.tax_id,
      legal_name: row.legal_name,
      tax_id: clean(row.tax_id),
      tax_id_dv: clean(row.tax_id_dv),
      document_type: clean(row.document_type),
      person_type: toDianPersonType(row.person_type),
      tax_regime_code: clean(row.tax_regime_code),
      fiscal_responsibilities: normalizeResponsibilities(row.fiscal_responsibilities),
      email: clean(row.email),
      phone: clean(row.phone),
      address: {
        line: clean(row.address_line),
        city: clean(row.city),
        city_code: clean(row.city_code),
        department_code: clean(row.department_code),
      },
      organization: { id: null, name: null },
      fiscal_data_complete: false,
    };
    result.fiscal_data_complete = isAcquirerFiscalComplete(result);
    return result;
  }

  /**
   * Dirección del adquiriente con códigos DIVIPOLA resueltos. La fila de
   * `addresses` manda; `fallback` (fiscal_data / columnas) llena lo que falte.
   * Columnas reales de `addresses`: address_line1/2, city, state_province,
   * municipality_code (NO existe `department_code`).
   */
  private buildAddress(
    addr: any | null,
    fallback: {
      line?: string | null;
      city?: string | null;
      city_code?: string | null;
      department_code?: string | null;
      department_name?: string | null;
    },
  ): TenantAddress {
    const line =
      (addr
        ? [addr.address_line1, addr.address_line2].filter(Boolean).join(' ').trim()
        : '') ||
      fallback.line ||
      null;
    const cityName = clean(addr?.city) ?? fallback.city ?? null;
    const municipalityCode = clean(addr?.municipality_code) ?? fallback.city_code ?? null;
    const departmentHint =
      toDianDepartmentCode(addr?.state_province) ??
      toDianDepartmentCode(fallback.department_code) ??
      toDianDepartmentCode(fallback.department_name);

    const resolved =
      municipalityCode || (cityName && departmentHint)
        ? resolveDianMunicipality({
            city_code: municipalityCode,
            city_name: cityName,
            department_code: departmentHint,
          })
        : null;

    return {
      line,
      city: resolved?.name ?? cityName,
      city_code: resolved?.code ?? municipalityCode,
      // Código DIVIPOLA del departamento: el del municipio resuelto, el
      // código/nombre declarado traducido al catálogo, o los 2 primeros
      // dígitos del municipio DANE.
      department_code:
        resolved?.department_code ??
        departmentHint ??
        toDianDepartmentCode(municipalityCode ? String(municipalityCode).slice(0, 2) : null),
    };
  }
}

/* ── Includes ─────────────────────────────────────────────────────────── */

const ADDRESS_PICK = {
  where: {
    OR: [
      { type: 'billing' as const },
      { type: 'legal' as const, is_primary: true },
    ],
  },
  orderBy: [{ is_primary: 'desc' as const }, { id: 'desc' as const }],
  take: 10,
};

const STORE_INCLUDE = {
  addresses: ADDRESS_PICK,
  store_settings: { select: { settings: true } },
  // model stores declara la relación como `organizations` (Prisma pluraliza);
  // `organization` no existe y rompía con PrismaClientValidationError → 500.
  organizations: {
    select: {
      id: true,
      name: true,
      legal_name: true,
      tax_id: true,
      verification_digit: true,
      document_type: true,
      person_type: true,
      tax_regime: true,
      fiscal_responsibilities: true,
      fiscal_scope: true,
      email: true,
      phone: true,
      organization_settings: { select: { settings: true } },
    },
  },
};

const ORGANIZATION_INCLUDE = {
  addresses: ADDRESS_PICK,
  organization_settings: { select: { settings: true } },
};

const USER_INCLUDE = {
  addresses: ADDRESS_PICK,
};

/* ── Helpers puros ────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function str(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = source?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Código DIVIPOLA de departamento desde un código ('11') o un nombre
 * ('Cundinamarca', 'Bogotá D.C.', 'valle del cauca'). Desconocido → `null`.
 */
export function toDianDepartmentCode(value: unknown): string | null {
  const v = clean(value);
  if (!v) return null;
  const padded = /^\d$/.test(v) ? `0${v}` : v;
  if (isDianDepartmentCode(padded)) return padded;
  const name = normalizeName(v);
  if (!name) return null;
  for (const [code, label] of Object.entries(DIAN_DEPARTMENTS)) {
    const target = normalizeName(label);
    if (name === target || name.startsWith(`${target} `)) return code;
  }
  return null;
}

/** Prefiere `billing`; sólo una `legal` primaria puede ser respaldo fiscal. */
function pickAddress(addresses: any[] | null | undefined): any | null {
  if (!Array.isArray(addresses) || !addresses.length) return null;
  return addresses.find((a) => a?.type === 'billing') ??
    addresses.find((a) => a?.type === 'legal' && a.is_primary === true) ?? null;
}

/**
 * Etiqueta (`NIT`, `CC`, `PA`, `NIT_EXTRANJERIA`, ...) o código → código DIAN.
 * Un código DIAN ya válido pasa tal cual; lo desconocido es `null`.
 */
export function toDianDocumentType(value: unknown): string | null {
  const v = clean(value)?.toUpperCase();
  if (!v) return null;
  if (/^\d{2}$/.test(v)) return v;
  return DIAN_ID_TYPES[v] ?? DIAN_DOCUMENT_TYPE_BY_NIT_TYPE[v] ?? (v === 'PP' ? '41' : null);
}

/** `JURIDICA`/`NATURAL` o '1'/'2' → '1' (Jurídica) / '2' (Natural). */
export function toDianPersonType(value: unknown): '1' | '2' | null {
  const v = clean(value)?.toUpperCase();
  if (!v) return null;
  if (v === '1' || v === '2') return v;
  const code = DIAN_PERSON_TYPE_BY_LABEL[v];
  return code === '1' || code === '2' ? code : null;
}

/** Documentos de persona natural (todos menos NIT y NIT extranjero) → '2'. */
function personTypeFromDocument(documentType: string | null): '1' | '2' | null {
  if (!documentType) return null;
  if (documentType === '31' || documentType === '50') return null;
  return '2';
}

function normalizeResponsibilities(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const code = normalizeFiscalResponsibilityCode(raw);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

function readResponsibilities(fd: Record<string, unknown> | null | undefined): string[] {
  return normalizeResponsibilities(fd?.tax_responsibilities);
}

/**
 * '48'/'49' derivado con el resolvedor canónico (la casilla 53 manda; el
 * régimen sólo cuando la lista está vacía). Sin ninguna señal → `null`.
 */
function deriveTaxRegimeCode(
  responsibilities: string[],
  taxRegime: unknown,
): '48' | '49' | null {
  const regime = clean(taxRegime);
  if (!responsibilities.length && !regime) return null;
  if (!responsibilities.length && (regime === '48' || regime === '49')) return regime;
  const res = resolveVatResponsibility({
    tax_responsibilities: responsibilities,
    tax_regime: regime ?? undefined,
  });
  if (res.indeterminate) return null;
  return res.responsible ? '48' : '49';
}

/**
 * Completitud fiscal del adquiriente para EMITIR sin capturar nada a mano:
 * identidad (razón social, documento, tipo de documento y de persona, DV si
 * NIT), calidad tributaria (régimen + casilla 53) y dirección con municipio y
 * departamento DIVIPOLA. Badge informativo: no bloquea el submit.
 */
export function isAcquirerFiscalComplete(r: TenantSearchResult): boolean {
  return Boolean(
    r.legal_name &&
      r.tax_id &&
      r.document_type &&
      r.person_type &&
      (r.document_type !== '31' || r.tax_id_dv) &&
      r.tax_regime_code &&
      r.fiscal_responsibilities.length > 0 &&
      r.address.line &&
      r.address.city_code &&
      r.address.department_code,
  );
}

/* ── Tipos ────────────────────────────────────────────────────────────── */

export type TenantKind = 'store' | 'organization' | 'user' | 'customer';

export interface TenantAddress {
  line: string | null;
  city: string | null;
  department_code: string | null;
  city_code?: string | null;
}

export interface TenantSearchResult {
  /**
   * ID compuesto del picker: `store:<n>`, `org:<n>`, `user:<n>` o
   * `customer:<n>`. El form lo manda como `{kind, tenant_id}` al backend
   * (un `customer` se emite como `kind: 'external'` con todos sus campos).
   */
  id: string;
  kind: TenantKind;
  tenant_id: number;
  name: string;
  slug: string;
  legal_name: string;
  tax_id: string | null;
  tax_id_dv: string | null;
  /** Código DIAN ('31', '13', ...). null si la fuente no lo persiste. */
  document_type: string | null;
  /** '1' Jurídica / '2' Natural. */
  person_type: string | null;
  /** '48' / '49'. */
  tax_regime_code: string | null;
  fiscal_responsibilities: string[];
  email: string | null;
  phone: string | null;
  address: TenantAddress;
  /** `customer`: `{ id: null, name: null }` (no pertenece a una organización). */
  organization: { id: number | null; name: string | null };
  /**
   * `true` si la identidad fiscal está completa en BD (ver
   * `isAcquirerFiscalComplete`). Badge del form; NO bloquea el submit.
   */
  fiscal_data_complete: boolean;
}
