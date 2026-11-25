import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@common/context/request-context.service';

/**
 * QUI-1061 — disponibilidad de una cuenta bancaria en una tienda.
 *
 * Una cuenta está disponible en la tienda S de la organización O cuando:
 *   1. es una cuenta DE LA TIENDA (`store_id = S`), o
 *   2. es una cuenta DE LA ORGANIZACIÓN (`store_id` NULL) y
 *      - está disponible en todas las tiendas (`available_in_all_stores`), o
 *      - está asignada explícitamente a S (`bank_account_stores`).
 *
 * Una cuenta de OTRA tienda nunca está disponible: ni se ve ni bloquea.
 *
 * Es el ÚNICO predicado de pertenencia para selectores (POS, ecommerce,
 * reembolsos, prepagos, pagos sin asignar) y para la validación del cobro.
 * `bankAccountAvailableInStoreWhere` (consulta) e `isBankAccountAvailableInStore`
 * (fila ya cargada) deben decir siempre lo mismo.
 */
export function bankAccountAvailableInStoreWhere(
  store_id: number,
  organization_id?: number,
): Prisma.bank_accountsWhereInput {
  return {
    ...(organization_id !== undefined && { organization_id }),
    OR: [
      { store_id },
      { store_id: null, available_in_all_stores: true },
      { store_id: null, store_assignments: { some: { store_id } } },
    ],
  };
}

export interface BankAccountAvailabilityRow {
  organization_id: number;
  store_id: number | null;
  available_in_all_stores?: boolean | null;
  store_assignments?: ReadonlyArray<{ store_id: number }> | null;
}

/** Proyección mínima para evaluar `isBankAccountAvailableInStore`. */
export const BANK_ACCOUNT_AVAILABILITY_SELECT = {
  organization_id: true,
  store_id: true,
  available_in_all_stores: true,
  store_assignments: { select: { store_id: true } },
} as const;

export function isBankAccountAvailableInStore(
  account: BankAccountAvailabilityRow,
  store_id: number,
  organization_id: number,
): boolean {
  if (account.organization_id !== organization_id) return false;
  if (account.store_id !== null) return account.store_id === store_id;
  // `available_in_all_stores` ausente (fila sin la columna seleccionada) se
  // trata como `true`: es el default de la columna y lo que ya eran todas las
  // cuentas de organización antes de QUI-1061.
  if (account.available_in_all_stores !== false) return true;
  return (account.store_assignments ?? []).some((a) => a.store_id === store_id);
}

/**
 * ¿El usuario del contexto puede administrar cuentas de ORGANIZACIÓN?
 * Nivel organización = super admin, owner, rol `admin` (rol de organización:
 * solo lo asigna un actor de organización, ver `ASSIGNABLE_SYSTEM_ROLES` en
 * `common/utils/role-scope.util.ts`) o sesión del panel ORG_ADMIN.
 */
export function canManageOrganizationBankAccounts(
  context: Pick<RequestContext, 'is_super_admin' | 'is_owner' | 'roles' | 'app_type'> | undefined,
): boolean {
  if (!context) return false;
  if (context.is_super_admin || context.is_owner) return true;
  if (context.app_type === 'ORG_ADMIN') return true;
  return (context.roles ?? []).some((role) => role === 'owner' || role === 'admin');
}

export type BankAccountFiscalScope = 'STORE' | 'ORGANIZATION';

/**
 * Reglas de administración de cuentas para la tienda del contexto, según el
 * `fiscal_scope` de la organización (resuelto SIEMPRE con
 * `FiscalScopeService.getFiscalScope`, el resolvedor canónico):
 * - STORE: cada tienda registra y administra sus propias cuentas.
 * - ORGANIZATION: la organización es dueña de las cuentas; crear, editar y
 *   asignar cuentas de organización exige `can_manage_organization_accounts`.
 */
export interface BankAccountPolicy {
  organization_id: number;
  store_id: number;
  fiscal_scope: BankAccountFiscalScope;
  can_manage_organization_accounts: boolean;
}

export async function resolveBankAccountPolicy(
  fiscal_scope_service: {
    getFiscalScope(organization_id: number): Promise<BankAccountFiscalScope>;
  },
  params: {
    organization_id: number;
    store_id: number;
    context: Parameters<typeof canManageOrganizationBankAccounts>[0];
  },
): Promise<BankAccountPolicy> {
  const fiscal_scope = await fiscal_scope_service.getFiscalScope(
    params.organization_id,
  );
  return {
    organization_id: params.organization_id,
    store_id: params.store_id,
    fiscal_scope,
    can_manage_organization_accounts: canManageOrganizationBankAccounts(
      params.context,
    ),
  };
}

/**
 * ¿Puede el contexto modificar (editar, cerrar, reactivar, asignar) esta
 * cuenta?
 * - Scope ORGANIZATION: un usuario con permisos de organización puede
 *   modificar tanto las cuentas de organización (`store_id = null`) como las
 *   cuentas heredadas de cualquier sucursal de la organización (necesario para
 *   consolidar o cerrar duplicados tras migrar de STORE → ORGANIZATION). Un
 *   admin de tienda solo puede modificar cuentas heredadas de su propia tienda.
 * - Scope STORE: cada tienda modifica sus propias cuentas; para cuentas de
 *   organización heredadas (`store_id = null`) se conserva el comportamiento
 *   previo (cualquier tienda en la que esté disponible).
 */
export function canModifyBankAccount(
  account: { store_id: number | null },
  policy: BankAccountPolicy,
): boolean {
  if (policy.fiscal_scope === 'ORGANIZATION') {
    if (policy.can_manage_organization_accounts) {
      return true;
    }
    return account.store_id !== null && account.store_id === policy.store_id;
  }
  if (account.store_id !== null) return account.store_id === policy.store_id;
  return true;
}

/**
 * Extrae el id numérico de `bank_accounts` de una entrada de
 * `custom_config.accounts`, tolerando las tres formas que conviven en
 * producción (`{ id }`, `{ bank_account_id }`, `{ legacy: { ... } }`).
 * Devuelve `null` para entradas legacy sin FK.
 */
export function extractBankTransferAccountEntryId(entry: unknown): number | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const nested =
    e['legacy'] != null && typeof e['legacy'] === 'object'
      ? (e['legacy'] as Record<string, unknown>)
      : {};
  const candidate =
    e['bank_account_id'] ?? e['id'] ?? nested['bank_account_id'] ?? nested['id'];
  if (candidate === undefined || candidate === null || candidate === '') {
    return null;
  }
  const id = Number(candidate);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Recolecta todos los `bank_accounts.id` únicos presentes en
 * `custom_config.accounts` de un método `bank_transfer`.
 */
export function collectBankTransferAccountIds(customConfig: unknown): number[] {
  if (
    !customConfig ||
    typeof customConfig !== 'object' ||
    Array.isArray(customConfig)
  ) {
    return [];
  }
  const accounts = (customConfig as Record<string, unknown>)['accounts'];
  if (!Array.isArray(accounts)) return [];
  const ids: number[] = [];
  for (const entry of accounts) {
    const id = extractBankTransferAccountEntryId(entry);
    if (id !== null && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Filtra las entradas de `custom_config.accounts` con FK numérica contra el
 * conjunto de `bank_accounts.id` activos y disponibles para la tienda.
 * Las entradas legacy sin id se conservan para mantener compatibilidad con
 * cobros previos.
 */
export function filterBankTransferConfigAccounts<
  T extends Record<string, any> | null | undefined,
>(customConfig: T, allowedAccountIds: ReadonlySet<number>): T {
  if (
    !customConfig ||
    typeof customConfig !== 'object' ||
    Array.isArray(customConfig)
  ) {
    return customConfig;
  }
  const accounts = customConfig['accounts'];
  if (!Array.isArray(accounts)) return customConfig;

  const filtered = accounts.filter((entry) => {
    const id = extractBankTransferAccountEntryId(entry);
    if (id === null) return true;
    return allowedAccountIds.has(id);
  });

  return {
    ...customConfig,
    accounts: filtered,
  } as T;
}

/**
 * En la pantalla administrativa de Contabilidad → Bancos:
 * - Scope STORE: cada tienda ve solo las cuentas disponibles en su tienda
 *   (propias + heredadas de organización asignadas a ella).
 * - Scope ORGANIZATION + usuario de organización: ve todas las cuentas de la
 *   organización para poder administrar asignaciones entre sucursales y ver
 *   avisos de números repetidos tras cambiar de scope.
 * - Scope ORGANIZATION + admin de tienda: ve solo las asignadas a su tienda.
 */
export function canViewAllOrganizationBankAccounts(
  policy: BankAccountPolicy,
): boolean {
  return (
    policy.fiscal_scope === 'ORGANIZATION' &&
    policy.can_manage_organization_accounts
  );
}

export interface BankAccountDuplicateWarningItem {
  id: number;
  name: string;
  bank_name: string;
  store_id: number | null;
  store_name: string | null;
  status: string;
}

export interface BankAccountDuplicateWarning {
  account_number: string;
  accounts: BankAccountDuplicateWarningItem[];
}

/**
 * Detecta números de cuenta repetidos entre cuentas activas/inactivas (no
 * cerradas) de la organización. Se usa como aviso no bloqueante cuando una
 * organización opera en scope ORGANIZATION y trae cuentas previas por tienda.
 */
export function buildDuplicateBankAccountWarnings(
  accounts: ReadonlyArray<{
    id: number;
    name: string;
    bank_name: string;
    account_number: string;
    store_id: number | null;
    status: string;
    store?: { id: number; name: string } | null;
  }>,
): BankAccountDuplicateWarning[] {
  const byNumber = new Map<
    string,
    { displayNumber: string; items: BankAccountDuplicateWarningItem[] }
  >();

  for (const acc of accounts) {
    if (acc.status === 'closed') continue;
    const key = acc.account_number.trim();
    if (!key) continue;
    const group = byNumber.get(key) ?? {
      displayNumber: acc.account_number,
      items: [],
    };
    group.items.push({
      id: acc.id,
      name: acc.name,
      bank_name: acc.bank_name,
      store_id: acc.store_id,
      store_name: acc.store?.name ?? null,
      status: acc.status,
    });
    byNumber.set(key, group);
  }

  const warnings: BankAccountDuplicateWarning[] = [];
  for (const group of byNumber.values()) {
    if (group.items.length > 1) {
      warnings.push({
        account_number: group.displayNumber,
        accounts: group.items,
      });
    }
  }
  return warnings;
}
