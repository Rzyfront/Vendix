import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { SettingsService } from '../../../domains/store/settings/settings.service';
import { StoreRolesService } from '../../../domains/store/roles/store-roles.service';
import { FiscalStatusService } from '@common/services/fiscal-status.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { FiscalScopeMigrationService } from '@common/services/fiscal-scope-migration.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';

/**
 * Familia settings-admin de Vexi (pasos 7+12, track B). 6 reads P0
 * (`readOnly: true`) + 2 reads P1 (F-89, F-93) + 5 writes con confirmación
 * (F-84, F-86, F-90, F-91, F-94).
 *
 * Contratos que respeta esta familia:
 * - Branding NO editable vía Vexi: `get_store_settings` lo devuelve como una
 *   sección más de lectura; no existe write que lo toque en esta familia.
 * - `update_fiscal_data` NUNCA defaultea `tax_regime`: el patch lleva
 *   exactamente las llaves recibidas; el régimen se deriva de
 *   `tax_responsibilities` en el resolvedor, no en el tool.
 * - `assign_role_permissions` NUNCA otorga `superadmin:*` ni nada fuera de
 *   `store:*`: preview y handler resuelven ids→nombres y rechazan antes de
 *   tocar el service. Solo admin: exige `store:users:update`, que el registry
 *   filtra por permisos del invocante.
 * - Scopes resueltos por `OperatingScopeService`/`FiscalScopeService`, nunca
 *   duplicados en el tool (ver skills `vendix-operating-scope` y
 *   `vendix-fiscal-scope`); la migración pasa por
 *   `FiscalScopeMigrationService` (blockers, force+reason, auditoría).
 * - Permisos verificados en controllers: `store:settings:*` en
 *   `settings.controller.ts`, `store:settings:fiscal_status:*` en
 *   `fiscal-status.controller.ts`, `store:users:*` en
 *   `store-roles.controller.ts`, `organization:settings:fiscal_scope:write`
 *   en `organization/settings/fiscal-scope.controller.ts` (preview+apply).
 * - Cadenas read→write: fiscal-data←F-83(+F-85), wizard←F-85,
 *   roles←F-87/F-88/F-89, migrate←F-92/F-93. Todo handler re-verifica sus
 *   precondiciones: el preview es proyección, no transacción.
 */

export interface SettingsAdminToolDeps {
  settingsService: SettingsService;
  fiscalStatusService: FiscalStatusService;
  rolesService: StoreRolesService;
  fiscalScopeService: FiscalScopeService;
  operatingScopeService: OperatingScopeService;
  fiscalScopeMigrationService: FiscalScopeMigrationService;
}

const PERM_SETTINGS_READ = 'store:settings:read';
const PERM_FISCAL_DATA_READ = 'store:settings:fiscal_data:read';
const PERM_FISCAL_DATA_WRITE = 'store:settings:fiscal_data:write';
const PERM_FISCAL_STATUS_READ = 'store:settings:fiscal_status:read';
const PERM_FISCAL_STATUS_WRITE = 'store:settings:fiscal_status:write';
const PERM_USERS_READ = 'store:users:read';
const PERM_USERS_UPDATE = 'store:users:update';
const PERM_FISCAL_SCOPE_WRITE = 'organization:settings:fiscal_scope:write';

/**
 * Secciones de primer nivel de `StoreSettings`
 * (`store-settings.interface.ts`). `_schema_version` se excluye: es
 * versionado interno del migrador, no configuración consultable.
 */
const SETTINGS_SECTIONS = [
  'branding',
  'fonts',
  'publication',
  'ecommerce',
  'panel_ui',
  'accounting_flows',
  'module_flows',
  'fiscal_status',
  'fiscal_data',
  'invoicing',
  'services',
  'reservations',
  'availability',
  'operations',
  'dispatch',
  'restaurant',
  'membership',
  'vexi',
  'promotions',
  'general',
  'inventory',
  'checkout',
  'notifications',
  'pos',
  'receipts',
  'app',
] as const;

const FISCAL_AREAS = ['invoicing', 'accounting', 'payroll'] as const;
type FiscalArea = (typeof FISCAL_AREAS)[number];

const isFiscalArea = (value: unknown): value is FiscalArea =>
  typeof value === 'string' &&
  (FISCAL_AREAS as readonly string[]).includes(value);

function describeError(error: any): string {
  const detail = error?.response?.message ?? error?.message ?? String(error);
  return Array.isArray(detail) ? detail.join('; ') : String(detail);
}

const guard =
  (
    fn: (
      args: Record<string, any>,
      context: ToolExecutionContext,
    ) => Promise<Record<string, any>>,
  ) =>
  async (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<string> => {
    try {
      return JSON.stringify(await fn(args ?? {}, context));
    } catch (error: any) {
      return JSON.stringify({ error: describeError(error) });
    }
  };

function previewError(
  target: string,
  message: string,
  domain: string,
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

/** Llaves escribibles de `fiscal_data` aceptadas por F-84. */
const FISCAL_DATA_FIELDS = [
  'nit',
  'nit_dv',
  'tax_id',
  'tax_id_dv',
  'nit_type',
  'legal_name',
  'person_type',
  'tax_regime',
  'ciiu',
  'fiscal_address',
  'country',
  'department',
  'city',
  'tax_responsibilities',
  'vat_periodicity',
  'tax_scheme',
  'is_withholding_agent',
  'is_self_withholder',
  'municipality_code',
  'ciiu_code',
] as const;

const FISCAL_DATA_LABELS: Record<string, string> = {
  nit: 'NIT',
  nit_dv: 'Dígito de verificación',
  tax_id: 'NIT',
  tax_id_dv: 'Dígito de verificación',
  nit_type: 'Tipo de documento',
  legal_name: 'Razón social',
  person_type: 'Tipo de persona',
  tax_regime: 'Régimen tributario',
  ciiu: 'CIIU',
  fiscal_address: 'Dirección fiscal',
  country: 'País',
  department: 'Departamento',
  city: 'Ciudad',
  tax_responsibilities: 'Responsabilidades',
  vat_periodicity: 'Periodicidad de IVA',
  tax_scheme: 'Esquema tributario DIAN',
  is_withholding_agent: 'Agente retenedor',
  is_self_withholder: 'Autorretenedor',
  municipality_code: 'Código de municipio',
  ciiu_code: 'Código CIIU',
};

const FISCAL_AREA_LABELS: Record<FiscalArea, string> = {
  invoicing: 'Facturación',
  accounting: 'Contabilidad',
  payroll: 'Nómina',
};

/**
 * Extrae el patch fiscal de los args: solo llaves conocidas y definidas.
 * NUNCA inyecta `tax_regime` ni ningún otro default: lo ausente sigue
 * ausente y el resolvedor deriva el régimen de `tax_responsibilities`.
 */
function extractFiscalPatch(
  args: Record<string, any>,
): Record<string, unknown> | null {
  const known = new Set<string>(FISCAL_DATA_FIELDS);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value !== undefined && known.has(key)) patch[key] = value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function formatFiscalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.join(', ') || '(vacío)';
  if (value === null || value === undefined || value === '') return '(vacío)';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return value;
}

function isValidRoleId(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && (value as number) > 0
  );
}

function parseIdArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = value.map((v) => Number(v));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
  return [...new Set(ids)];
}

export function createSettingsAdminTools(
  deps: SettingsAdminToolDeps,
): RegisteredTool[] {
  function requireOrganizationId(context: ToolExecutionContext) {
    if (!context.organization_id) {
      return {
        error:
          'Sin organización en contexto: el estado fiscal se consulta siempre dentro de una sesión autenticada.',
        next_step:
          'Reintenta dentro de una sesión de tienda autenticada; el alcance fiscal se deriva de su organización.',
      };
    }
    return null;
  }

  return [
    // ─── F-82: get_store_settings ──────────────────────────────────
    {
      name: 'get_store_settings',
      version: '1',
      domain: 'settings-admin',
      readOnly: true,
      description:
        'Lee la configuración de la tienda por secciones (general, checkout, pos, receipts, inventory, branding, panel_ui, restaurant, vexi, etc.). Acepta `sections` para devolver solo las pedidas; sin el parámetro devuelve todas. Branding es solo lectura por esta vía: el asistente no edita identidad visual. Úsala para "cómo está configurado X" o antes de explicar cualquier comportamiento de la tienda.',
      parameters: {
        type: 'object',
        properties: {
          sections: {
            type: 'array',
            items: { type: 'string', enum: [...SETTINGS_SECTIONS] },
            description:
              'Secciones a devolver. Omitido devuelve todas las secciones.',
          },
        },
      },
      requiredPermissions: [PERM_SETTINGS_READ],
      handler: guard(async (args) => {
        const requested: unknown = args.sections;
        if (requested !== undefined && requested !== null) {
          if (!Array.isArray(requested) || requested.length === 0) {
            return {
              error: 'El parámetro sections debe ser un arreglo no vacío.',
              next_step: `Pide solo secciones válidas: ${SETTINGS_SECTIONS.join(', ')}.`,
            };
          }
          const valid = new Set<string>(SETTINGS_SECTIONS);
          const unknownSections = requested.filter(
            (s) => typeof s !== 'string' || !valid.has(s),
          );
          if (unknownSections.length > 0) {
            return {
              error: `Secciones desconocidas: ${unknownSections.join(', ')}.`,
              next_step: `Pide solo secciones válidas: ${SETTINGS_SECTIONS.join(', ')}.`,
            };
          }
        }
        const settings = (await deps.settingsService.getSettings()) as unknown as Record<
          string,
          unknown
        >;
        if (requested === undefined || requested === null) return { settings };
        const filtered: Record<string, unknown> = {};
        for (const section of requested as string[]) {
          filtered[section] = settings[section] ?? null;
        }
        return { settings: filtered };
      }),
    },

    // ─── F-83: get_fiscal_data ─────────────────────────────────────
    {
      name: 'get_fiscal_data',
      version: '1',
      domain: 'settings-admin',
      readOnly: true,
      description:
        'Lee la identidad fiscal (NIT, dígito de verificación, razón social, dirección fiscal, municipio, responsabilidades, régimen, CIIU, tipo de persona) ya resuelta según el alcance fiscal: bajo ORGANIZATION devuelve el bloque de la organización, bajo STORE el de la tienda. Úsala para "cuál es el NIT", "qué responsabilidades tiene" o antes de explicar cualquier cifra fiscal.',
      parameters: {
        type: 'object',
        properties: {},
      },
      requiredPermissions: [PERM_FISCAL_DATA_READ],
      handler: guard(async (_args, context) => {
        const fiscal_data = await deps.settingsService.getFiscalData();
        return {
          organization_id: context.organization_id ?? null,
          store_id: context.store_id ?? null,
          fiscal_data: fiscal_data ?? null,
        };
      }),
    },

    // ─── F-85: get_fiscal_status ───────────────────────────────────
    {
      name: 'get_fiscal_status',
      version: '1',
      domain: 'settings-admin',
      readOnly: true,
      description:
        'Lee el estado fiscal por área (invoicing, accounting, payroll): INACTIVE, WIP, ACTIVE o LOCKED, con motivos de bloqueo y fechas. Acepta `area` para filtrar un área. Es la señal confiable de "este comercio ya hizo el trabajo fiscal" — no la confundas con fiscal_data parcialmente diligenciado. Úsala para "estamos activos en facturación" o antes de proponer cualquier emisión.',
      parameters: {
        type: 'object',
        properties: {
          area: {
            type: 'string',
            enum: [...FISCAL_AREAS],
            description:
              'Área fiscal a consultar. Omitida devuelve las tres áreas.',
          },
        },
      },
      requiredPermissions: [PERM_FISCAL_STATUS_READ],
      handler: guard(async (args, context) => {
        const missing = requireOrganizationId(context);
        if (missing) return missing;
        if (args.area !== undefined && !isFiscalArea(args.area)) {
          return {
            error: `Área fiscal desconocida: ${String(args.area)}.`,
            next_step: `Pide un área válida: ${FISCAL_AREAS.join(', ')}.`,
          };
        }
        const read = await deps.fiscalStatusService.read(
          context.organization_id as number,
          context.store_id ?? null,
        );
        const project = (block: Record<string, any>) => {
          const areas: Record<string, unknown> = {};
          for (const area of FISCAL_AREAS) {
            if (args.area !== undefined && area !== args.area) continue;
            const a = block?.[area] ?? {};
            areas[area] = {
              state: a.state ?? 'INACTIVE',
              locked_reasons: a.locked_reasons ?? [],
              activated_at: a.activated_at ?? null,
              locked_at: a.locked_at ?? null,
            };
          }
          return areas;
        };
        const result: Record<string, unknown> = {
          organization_id: read.organization_id,
          store_id: read.store_id,
          fiscal_scope: read.fiscal_scope,
          areas: project(read.fiscal_status as Record<string, any>),
        };
        if (read.store_statuses) {
          result.store_statuses = read.store_statuses.map((s) => ({
            store_id: s.store_id,
            store_name: s.store_name,
            areas: project(s.fiscal_status as Record<string, any>),
          }));
        }
        return result;
      }),
    },

    // ─── F-87: list_store_roles ────────────────────────────────────
    {
      name: 'list_store_roles',
      version: '1',
      domain: 'settings-admin',
      readOnly: true,
      description:
        'Lista los roles visibles de la tienda (sistema + organización heredados + tienda) con sus permisos, alcance derivado y conteo de usuarios, más el resumen del panel (totales por alcance). Úsala para "qué roles hay", "quién puede X" o como primer paso de la auditoría "¿por qué no veo X?"; el detalle de un rol se lee con get_role_permissions.',
      parameters: {
        type: 'object',
        properties: {},
      },
      requiredPermissions: [PERM_USERS_READ],
      handler: guard(async () => {
        const [roles, stats] = await Promise.all([
          deps.rolesService.findAll(),
          deps.rolesService.getStats(),
        ]);
        return { roles, stats };
      }),
    },

    // ─── F-88: get_role_permissions ────────────────────────────────
    {
      name: 'get_role_permissions',
      version: '1',
      domain: 'settings-admin',
      readOnly: true,
      description:
        'Lee el detalle de un rol: permisos asignados (ids + etiquetas), total y usuarios con el rol asignado. Recibe `role_id` (ver ids en list_store_roles) e `include_users` (por defecto true). Úsala para "qué puede hacer el Cajero" o "quién tiene este rol".',
      parameters: {
        type: 'object',
        properties: {
          role_id: {
            type: 'number',
            description: 'ID del rol (ver list_store_roles).',
          },
          include_users: {
            type: 'boolean',
            description:
              'Incluye los usuarios con el rol asignado. Por defecto true.',
          },
        },
        required: ['role_id'],
      },
      requiredPermissions: [PERM_USERS_READ],
      handler: guard(async (args) => {
        const role_id = Number(args.role_id);
        if (!Number.isInteger(role_id) || role_id <= 0) {
          return {
            error: `role_id inválido: ${String(args.role_id)}.`,
            next_step:
              'Pasa el ID numérico del rol; consíguelo con list_store_roles.',
          };
        }
        const include_users = args.include_users !== false;
        const [role, permissions] = await Promise.all([
          deps.rolesService.findOne(role_id),
          deps.rolesService.getRolePermissions(role_id),
        ]);
        const result: Record<string, unknown> = {
          role: {
            id: role.id,
            name: role.name,
            description: role.description,
            scope: role.scope,
            is_system_role: role.is_system_role,
            permissions: role.permissions,
            users_count: role._count?.user_roles ?? null,
          },
          permission_ids: permissions.permission_ids,
          total_permissions: permissions.total_permissions,
        };
        if (include_users) {
          result.users = await deps.rolesService.listRoleUsers(role_id);
        }
        return result;
      }),
    },

    // ─── F-92: get_fiscal_scope ────────────────────────────────────
    {
      name: 'get_fiscal_scope',
      version: '1',
      domain: 'settings-admin',
      readOnly: true,
      description:
        'Lee los alcances de la organización: fiscal (STORE = cada tienda su propio NIT; ORGANIZATION = un NIT consolidado) y operativo (STORE = tiendas aisladas; ORGANIZATION = datos compartidos), más si la combinación es inválida (operativo STORE con fiscal ORGANIZATION). Úsala para "facturamos por tienda o consolidado" o antes de explicar reportes por NIT.',
      parameters: {
        type: 'object',
        properties: {},
      },
      requiredPermissions: [PERM_SETTINGS_READ],
      handler: guard(async (_args, context) => {
        const missing = requireOrganizationId(context);
        if (missing) return missing;
        const organization_id = context.organization_id as number;
        const [fiscal_scope, operating_scope] = await Promise.all([
          deps.fiscalScopeService.getFiscalScope(organization_id),
          deps.operatingScopeService.getOperatingScope(organization_id),
        ]);
        return {
          organization_id,
          fiscal_scope,
          operating_scope,
          invalid_combination:
            operating_scope === 'STORE' && fiscal_scope === 'ORGANIZATION',
          meaning:
            fiscal_scope === 'ORGANIZATION'
              ? 'La organización factura con un solo NIT consolidado.'
              : 'Cada tienda factura con su propio NIT.',
        };
      }),
    },

    // ─── F-84: update_fiscal_data (write) ────────────────────────────
    {
      name: 'update_fiscal_data',
      version: '1',
      domain: 'settings-admin',
      description:
        'Actualiza la identidad fiscal de la tienda (NIT, razón social, dirección fiscal, responsabilidades, régimen, CIIU, municipio). Cadena: lee primero get_fiscal_data (F-83) y get_fiscal_status (F-85). Solo lleva las llaves recibidas: nunca inventa ni defaultea el régimen tributario. Bajo alcance fiscal ORGANIZATION el service rechaza (el dato vive en la organización).',
      parameters: {
        type: 'object',
        properties: {
          nit: { type: 'string', description: 'NIT sin dígito de verificación.' },
          nit_dv: { type: 'string', description: 'Dígito de verificación.' },
          tax_id: { type: 'string', description: 'Alias de NIT.' },
          tax_id_dv: { type: 'string', description: 'Alias del DV.' },
          nit_type: {
            type: 'string',
            enum: ['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'],
          },
          legal_name: { type: 'string', description: 'Razón social.' },
          person_type: { type: 'string', enum: ['NATURAL', 'JURIDICA'] },
          tax_regime: {
            type: 'string',
            enum: ['COMUN', 'SIMPLIFICADO', 'GRAN_CONTRIBUYENTE'],
            description:
              'Solo si el usuario lo declaró explícitamente. Ausente se deja ausente.',
          },
          ciiu: { type: 'string' },
          fiscal_address: { type: 'string' },
          country: { type: 'string' },
          department: { type: 'string' },
          city: { type: 'string' },
          tax_responsibilities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Códigos RUT, ej. ["O-13", "O-48"].',
          },
          vat_periodicity: {
            type: 'string',
            enum: ['monthly', 'bimonthly', 'four_monthly'],
          },
          tax_scheme: { type: 'string' },
          is_withholding_agent: { type: 'boolean' },
          is_self_withholder: { type: 'boolean' },
          municipality_code: { type: 'string' },
          ciiu_code: { type: 'string' },
        },
      },
      requiredPermissions: [PERM_FISCAL_DATA_WRITE],
      requiresConfirmation: true,
      preview: async (args) => {
        const patch = extractFiscalPatch(args ?? {});
        if (!patch) {
          return previewError(
            'Identidad fiscal',
            'Sin cambios: pasa al menos un campo fiscal (nit, legal_name, tax_responsibilities, fiscal_address, municipality_code, …).',
            'settings-admin',
          );
        }
        let current: Record<string, any> = {};
        try {
          current =
            ((await deps.settingsService.getFiscalData()) as Record<
              string,
              any
            >) ?? {};
        } catch (error: any) {
          return previewError(
            'Identidad fiscal',
            `No se pudo leer la identidad actual: ${describeError(error)}.`,
            'settings-admin',
          );
        }
        const subject =
          (patch.legal_name as string) ||
          current.legal_name ||
          (patch.nit as string) ||
          (patch.tax_id as string) ||
          current.nit ||
          current.tax_id ||
          'Identidad fiscal';
        return {
          status: 'ok',
          target: `Identidad fiscal de ${subject}`,
          changes: Object.entries(patch).map(([field, to]) => ({
            field,
            label: FISCAL_DATA_LABELS[field] ?? field,
            from: formatFiscalValue(current[field]),
            to: formatFiscalValue(to),
          })),
          domain: 'settings-admin',
        };
      },
      handler: guard(async (args) => {
        const patch = extractFiscalPatch(args ?? {});
        if (!patch) {
          return {
            error: 'Sin cambios: pasa al menos un campo fiscal.',
            next_step:
              'Lee get_fiscal_data (F-83) y reintenta con los campos a corregir.',
          };
        }
        const fiscal_data = await deps.settingsService.updateFiscalData(patch);
        return { updated: true, fiscal_data: fiscal_data ?? null };
      }),
    },

    // ─── F-86: start_fiscal_wizard (write) ────────────────────────────
    {
      name: 'start_fiscal_wizard',
      version: '1',
      domain: 'settings-admin',
      description:
        'Inicia el asistente de activación fiscal en las áreas pedidas (invoicing, accounting, payroll): las pasa a WIP con su secuencia de pasos. Cadena: lee primero get_fiscal_status (F-85). Un área LOCKED no se puede reiniciar.',
      parameters: {
        type: 'object',
        properties: {
          selected_areas: {
            type: 'array',
            items: { type: 'string', enum: [...FISCAL_AREAS] },
            description: 'Áreas a activar. Al menos una.',
          },
        },
        required: ['selected_areas'],
      },
      requiredPermissions: [PERM_FISCAL_STATUS_WRITE],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const areas = args?.selected_areas;
        if (!Array.isArray(areas) || areas.length === 0) {
          return previewError(
            'Activación fiscal',
            'Pasa al menos un área: invoicing, accounting, payroll.',
            'settings-admin',
          );
        }
        const unknown = areas.filter((a) => !isFiscalArea(a));
        if (unknown.length > 0) {
          return previewError(
            'Activación fiscal',
            `Áreas desconocidas: ${unknown.join(', ')}.`,
            'settings-admin',
          );
        }
        if (!context.organization_id) {
          return previewError(
            'Activación fiscal',
            'Sin organización en contexto: el wizard se inicia dentro de una sesión autenticada.',
            'settings-admin',
          );
        }
        let read: any;
        try {
          read = await deps.fiscalStatusService.read(
            context.organization_id,
            context.store_id ?? null,
          );
        } catch (error: any) {
          return previewError(
            'Activación fiscal',
            `No se pudo leer el estado fiscal: ${describeError(error)}.`,
            'settings-admin',
          );
        }
        const locked = (areas as FiscalArea[]).filter(
          (a) => read?.fiscal_status?.[a]?.state === 'LOCKED',
        );
        if (locked.length > 0) {
          return previewError(
            'Activación fiscal',
            `No se puede reiniciar: ${locked.map((a) => FISCAL_AREA_LABELS[a]).join(', ')} está(n) LOCKED (ya tienen registros fiscales).`,
            'settings-admin',
          );
        }
        const unique = [...new Set(areas as FiscalArea[])];
        return {
          status: 'ok',
          target: `Activación fiscal: ${unique.map((a) => FISCAL_AREA_LABELS[a]).join(', ')}`,
          changes: unique.map((area) => ({
            field: area,
            label: FISCAL_AREA_LABELS[area],
            from: read?.fiscal_status?.[area]?.state ?? 'INACTIVE',
            to: 'WIP',
          })),
          domain: 'settings-admin',
        };
      },
      handler: guard(async (args, context) => {
        const areas = args?.selected_areas;
        if (
          !Array.isArray(areas) ||
          areas.length === 0 ||
          areas.some((a) => !isFiscalArea(a))
        ) {
          return {
            error: 'Áreas inválidas: usa invoicing, accounting y/o payroll.',
            next_step: 'Lee get_fiscal_status (F-85) y reintenta.',
          };
        }
        if (!context.organization_id) {
          return {
            error: 'Sin organización en contexto.',
            next_step: 'Reintenta dentro de una sesión autenticada.',
          };
        }
        const read = await deps.fiscalStatusService.read(
          context.organization_id,
          context.store_id ?? null,
        );
        const locked = (areas as FiscalArea[]).filter(
          (a) =>
            (read?.fiscal_status as Record<string, any>)?.[a]?.state ===
            'LOCKED',
        );
        if (locked.length > 0) {
          return {
            error: `Área(s) LOCKED: ${locked.join(', ')}.`,
            next_step:
              'Un área bloqueada ya tiene registros fiscales y no se reinicia.',
          };
        }
        const result = await deps.fiscalStatusService.startWizard({
          organization_id: context.organization_id,
          store_id: context.store_id ?? null,
          selected_areas: [...new Set(areas)] as FiscalArea[],
          changed_by_user_id: context.user_id ?? null,
        });
        return { started: true, fiscal_status: result ?? null };
      }),
    },

    // ─── F-89: list_available_permissions ─────────────────────────────
    {
      name: 'list_available_permissions',
      version: '1',
      domain: 'settings-admin',
      readOnly: true,
      description:
        'Lista los permisos activos asignables a roles de tienda (espacio store:*), con id, nombre y descripción. Acepta `search` para filtrar por texto. Úsala para "qué permisos existen" o como tercer paso de la cadena de roles (F-87/F-88/F-89) antes de proponer assign_role_permissions.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description:
              'Filtra por subcadena en nombre o descripción (insensible a mayúsculas).',
          },
        },
      },
      requiredPermissions: [PERM_USERS_READ],
      handler: guard(async (args) => {
        const permissions = await deps.rolesService.getAvailablePermissions();
        const term =
          typeof args.search === 'string' ? args.search.trim().toLowerCase() : '';
        const filtered = (permissions as Array<Record<string, any>>).filter(
          (p) =>
            !term ||
            String(p.name ?? '')
              .toLowerCase()
              .includes(term) ||
            String(p.description ?? '')
              .toLowerCase()
              .includes(term),
        );
        return {
          permissions: filtered.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description ?? null,
            path: p.path ?? null,
            method: p.method ?? null,
          })),
          total: filtered.length,
        };
      }),
    },

    // ─── F-90: assign_role_permissions (write, solo admin) ─────────────
    {
      name: 'assign_role_permissions',
      version: '1',
      domain: 'settings-admin',
      description:
        'Otorga permisos store:* a un rol de tienda editable (solo admin: exige store:users:update). Cadena: list_store_roles (F-87) → get_role_permissions (F-88) → list_available_permissions (F-89) para resolver ids. NUNCA otorga superadmin:* ni nada fuera de store:*: esos ids se rechazan antes de tocar el service. Roles de sistema u organización son de solo lectura desde la tienda.',
      parameters: {
        type: 'object',
        properties: {
          role_id: {
            type: 'number',
            description: 'ID del rol (ver list_store_roles).',
          },
          permission_ids: {
            type: 'array',
            items: { type: 'number' },
            description:
              'IDs a otorgar (ver list_available_permissions). Solo store:*.',
          },
        },
        required: ['role_id', 'permission_ids'],
      },
      requiredPermissions: [PERM_USERS_UPDATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const role_id = Number(args?.role_id);
        const permission_ids = parseIdArray(args?.permission_ids);
        if (!isValidRoleId(role_id)) {
          return previewError(
            'Asignar permisos',
            'role_id inválido: consíguelo con list_store_roles (F-87).',
            'settings-admin',
          );
        }
        if (!permission_ids) {
          return previewError(
            'Asignar permisos',
            'permission_ids debe ser un arreglo no vacío de IDs numéricos.',
            'settings-admin',
          );
        }
        let role: any;
        let available: Array<Record<string, any>>;
        let current: { permission_ids: number[]; total_permissions: number };
        try {
          [role, available, current] = await Promise.all([
            deps.rolesService.findOne(role_id),
            deps.rolesService.getAvailablePermissions(),
            deps.rolesService.getRolePermissions(role_id),
          ]);
        } catch (error: any) {
          return previewError(
            'Asignar permisos',
            `No se pudo leer el rol o sus permisos: ${describeError(error)}.`,
            'settings-admin',
          );
        }
        const byId = new Map(
          (available as Array<Record<string, any>>).map((p) => [Number(p.id), p]),
        );
        const unknown = permission_ids.filter((id) => !byId.has(id));
        if (unknown.length > 0) {
          return previewError(
            `Rol ${role?.name ?? role_id}`,
            `IDs no asignables a roles de tienda: ${unknown.join(', ')}. Solo se otorgan permisos store:* activos (ver F-89); superadmin:* jamás se otorga por esta vía.`,
            'settings-admin',
          );
        }
        const nonStore = permission_ids.filter(
          (id) => !String(byId.get(id)?.name ?? '').startsWith('store:'),
        );
        if (nonStore.length > 0) {
          return previewError(
            `Rol ${role?.name ?? role_id}`,
            `Rechazado: ${nonStore.map((id) => byId.get(id)?.name ?? id).join(', ')} no es store:*. Nunca se otorga superadmin:* ni permisos fuera del espacio de tienda.`,
            'settings-admin',
          );
        }
        const already = new Set(current.permission_ids ?? []);
        const fresh = permission_ids.filter((id) => !already.has(id));
        if (fresh.length === 0) {
          return previewError(
            `Rol ${role?.name ?? role_id}`,
            'El rol ya tiene todos esos permisos: no hay nada que otorgar.',
            'settings-admin',
          );
        }
        return {
          status: 'warning',
          target: `Rol ${role?.name ?? role_id}`,
          changes: [
            {
              field: 'permission_ids',
              label: 'Permisos otorgados',
              from: current.total_permissions ?? already.size,
              to: (current.total_permissions ?? already.size) + fresh.length,
            },
          ],
          message: `Se otorgan: ${fresh.map((id) => byId.get(id)?.name).join(', ')}.`,
          domain: 'settings-admin',
        };
      },
      handler: guard(async (args) => {
        const role_id = Number(args?.role_id);
        const permission_ids = parseIdArray(args?.permission_ids);
        if (!isValidRoleId(role_id) || !permission_ids) {
          return {
            error: 'role_id o permission_ids inválidos.',
            next_step:
              'Resuelve ids con list_store_roles (F-87) y list_available_permissions (F-89).',
          };
        }
        const available = (await deps.rolesService.getAvailablePermissions()) as Array<
          Record<string, any>
        >;
        const byId = new Map(available.map((p) => [Number(p.id), p]));
        const rejected = permission_ids.filter(
          (id) =>
            !byId.has(id) || !String(byId.get(id)?.name ?? '').startsWith('store:'),
        );
        if (rejected.length > 0) {
          return {
            error: `Rechazado: ${rejected.join(', ')} no es otorgable (solo store:* activos; superadmin:* jamás).`,
            next_step:
              'Pide solo IDs de list_available_permissions (F-89).',
          };
        }
        const updated = await deps.rolesService.assignPermissions(role_id, {
          permission_ids,
        } as any);
        return {
          assigned: true,
          role_id,
          role_name: (updated as any)?.name ?? null,
          permission_ids,
        };
      }),
    },

    // ─── F-91: create_store_role (write) ───────────────────────────────
    {
      name: 'create_store_role',
      version: '1',
      domain: 'settings-admin',
      description:
        'Crea un rol personalizado de tienda con nombre (2-50 caracteres) y descripción opcional. Cadena: list_store_roles (F-87) para verificar que el nombre no colisione con un rol visible (sistema, heredado o de tienda). Los permisos se otorgan después con assign_role_permissions (F-90).',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Nombre único del rol (2-50 caracteres).',
          },
          description: {
            type: 'string',
            description: 'Descripción del rol.',
          },
        },
        required: ['name'],
      },
      requiredPermissions: [PERM_USERS_UPDATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const name = typeof args?.name === 'string' ? args.name.trim() : '';
        if (name.length < 2 || name.length > 50) {
          return previewError(
            'Crear rol',
            'El nombre del rol debe tener entre 2 y 50 caracteres.',
            'settings-admin',
          );
        }
        let roles: Array<Record<string, any>>;
        try {
          roles = (await deps.rolesService.findAll()) as Array<
            Record<string, any>
          >;
        } catch (error: any) {
          return previewError(
            `Rol ${name}`,
            `No se pudo verificar colisión de nombre: ${describeError(error)}.`,
            'settings-admin',
          );
        }
        const collision = roles.find(
          (r) => String(r.name ?? '').toLowerCase() === name.toLowerCase(),
        );
        if (collision) {
          return previewError(
            `Rol ${name}`,
            `Ya existe un rol visible con ese nombre (alcance ${collision.scope ?? 'desconocido'}): los nombres comparten espacio con sistema y heredados.`,
            'settings-admin',
          );
        }
        return {
          status: 'ok',
          target: `Rol ${name}`,
          changes: [
            { field: 'name', label: 'Nombre', from: null, to: name },
            ...(typeof args?.description === 'string' && args.description.trim()
              ? [
                  {
                    field: 'description',
                    label: 'Descripción',
                    from: null,
                    to: args.description.trim(),
                  },
                ]
              : []),
          ],
          message:
            'El rol nace sin permisos: otórgalos con assign_role_permissions (F-90).',
          domain: 'settings-admin',
        };
      },
      handler: guard(async (args) => {
        const name = typeof args?.name === 'string' ? args.name.trim() : '';
        if (name.length < 2 || name.length > 50) {
          return {
            error: 'El nombre del rol debe tener entre 2 y 50 caracteres.',
            next_step: 'Reintenta con un nombre válido y único en la tienda.',
          };
        }
        const roles = (await deps.rolesService.findAll()) as Array<
          Record<string, any>
        >;
        if (
          roles.some(
            (r) => String(r.name ?? '').toLowerCase() === name.toLowerCase(),
          )
        ) {
          return {
            error: `Ya existe un rol visible con el nombre "${name}".`,
            next_step: 'Elige otro nombre; revisa los existentes con F-87.',
          };
        }
        const created = await deps.rolesService.create({
          name,
          ...(typeof args?.description === 'string' && args.description.trim()
            ? { description: args.description.trim() }
            : {}),
        } as any);
        return {
          created: true,
          role: {
            id: (created as any)?.id ?? null,
            name: (created as any)?.name ?? name,
            description: (created as any)?.description ?? null,
            scope: (created as any)?.scope ?? null,
          },
        };
      }),
    },

    // ─── F-93: get_operating_scope ───────────────────────────────────
    {
      name: 'get_operating_scope',
      version: '1',
      domain: 'settings-admin',
      readOnly: true,
      description:
        'Lee el alcance operativo de la organización (STORE = tiendas aisladas; ORGANIZATION = datos operativos compartidos) más el fiscal para detectar la combinación inválida (operativo STORE con fiscal ORGANIZATION). Úsala para "las tiendas comparten inventario" o como segunda lectura de la cadena migrate←F-92/F-93 antes de proponer migrate_fiscal_scope.',
      parameters: {
        type: 'object',
        properties: {},
      },
      requiredPermissions: [PERM_SETTINGS_READ],
      handler: guard(async (_args, context) => {
        const missing = requireOrganizationId(context);
        if (missing) return missing;
        const organization_id = context.organization_id as number;
        const [operating_scope, fiscal_scope] = await Promise.all([
          deps.operatingScopeService.getOperatingScope(organization_id),
          deps.fiscalScopeService.getFiscalScope(organization_id),
        ]);
        return {
          organization_id,
          operating_scope,
          fiscal_scope,
          invalid_combination:
            operating_scope === 'STORE' && fiscal_scope === 'ORGANIZATION',
          meaning:
            operating_scope === 'ORGANIZATION'
              ? 'Las tiendas comparten datos operativos y contables bajo una sola organización.'
              : 'Cada tienda opera aislada: inventario, proveedores, compras y reportes por tienda.',
        };
      }),
    },

    // ─── F-94: migrate_fiscal_scope (write, confirmación fuerte) ───────
    {
      name: 'migrate_fiscal_scope',
      version: '1',
      domain: 'settings-admin',
      description:
        'Migra el alcance fiscal de la organización entre STORE (cada tienda su NIT) y ORGANIZATION (un NIT consolidado). Cadena: get_fiscal_scope (F-92) + get_operating_scope (F-93). Exige motivo (reason, mínimo 10 caracteres) y confirmación fuerte: el downgrade ORGANIZATION→STORE con blockers (facturas DIAN pendientes, periodos consolidados abiertos, tiendas sin NIT/DIAN) se bloquea salvo force explícito con motivo auditado. UP nunca se fuerza sobre combinación inválida.',
      parameters: {
        type: 'object',
        properties: {
          target_scope: {
            type: 'string',
            enum: ['STORE', 'ORGANIZATION'],
            description: 'Alcance fiscal destino.',
          },
          reason: {
            type: 'string',
            description:
              'Motivo del cambio (mínimo 10 caracteres, queda auditado).',
          },
          force: {
            type: 'boolean',
            description:
              'Forzar el downgrade con blockers (por defecto false). Solo DOWN.',
          },
        },
        required: ['target_scope', 'reason'],
      },
      requiredPermissions: [PERM_FISCAL_SCOPE_WRITE],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const target_scope = args?.target_scope;
        const reason =
          typeof args?.reason === 'string' ? args.reason.trim() : '';
        const force = args?.force === true;
        if (target_scope !== 'STORE' && target_scope !== 'ORGANIZATION') {
          return previewError(
            'Migración fiscal',
            'target_scope debe ser STORE u ORGANIZATION.',
            'settings-admin',
          );
        }
        if (reason.length < 10) {
          return previewError(
            `Migración fiscal → ${target_scope}`,
            'El motivo (reason) necesita mínimo 10 caracteres: queda en la auditoría del cambio.',
            'settings-admin',
          );
        }
        if (!context.organization_id || !context.user_id) {
          return previewError(
            `Migración fiscal → ${target_scope}`,
            'Sin organización o usuario en contexto: la migración se propone dentro de una sesión autenticada.',
            'settings-admin',
          );
        }
        let preview: any;
        try {
          preview = await deps.fiscalScopeMigrationService.proposeChange(
            context.organization_id,
            target_scope,
            context.user_id,
            reason,
          );
        } catch (error: any) {
          return previewError(
            `Migración fiscal → ${target_scope}`,
            `No se pudo previsualizar la migración: ${describeError(error)}.`,
            'settings-admin',
          );
        }
        const target = `Alcance fiscal ${preview.current_fiscal_scope} → ${preview.target_fiscal_scope}`;
        if (preview.direction === 'NOOP') {
          return previewError(
            target,
            'Sin cambios: el alcance destino es el actual.',
            'settings-admin',
          );
        }
        const blockers: Array<{ message: string }> = preview.blockers ?? [];
        const warnings: string[] = preview.warnings ?? [];
        if (blockers.length > 0 && !force) {
          return previewError(
            target,
            `Bloqueado por ${blockers.length} condición(es): ${blockers.map((b) => b.message).join(' | ')}. Resuélvelas o repropón con force=true y motivo explícito (el downgrade ORGANIZATION→STORE está bloqueado por defecto).`,
            'settings-admin',
          );
        }
        const consequence =
          preview.direction === 'DOWN'
            ? 'ADVERTENCIA: el downgrade separa la facturación por tienda; cada tienda activa necesita NIT propio y DIAN configurado.'
            : 'La consolidación unifica la facturación bajo el NIT de la organización.';
        return {
          status: 'warning',
          target,
          changes: [
            {
              field: 'fiscal_scope',
              label: 'Alcance fiscal',
              from: preview.current_fiscal_scope,
              to: preview.target_fiscal_scope,
            },
            ...(force && blockers.length > 0
              ? [
                  {
                    field: 'forced_blockers',
                    label: 'Blockers forzados',
                    from: blockers.length,
                    to: 0,
                  },
                ]
              : []),
          ],
          message: [
            consequence,
            `Motivo: ${reason}`,
            ...(blockers.length > 0
              ? [
                  `Se fuerzan ${blockers.length} blocker(s) (quedan en auditoría): ${blockers.map((b) => b.message).join(' | ')}.`,
                ]
              : []),
            ...warnings,
          ].join(' '),
          domain: 'settings-admin',
        };
      },
      handler: guard(async (args, context) => {
        const target_scope = args?.target_scope;
        const reason =
          typeof args?.reason === 'string' ? args.reason.trim() : '';
        const force = args?.force === true;
        if (target_scope !== 'STORE' && target_scope !== 'ORGANIZATION') {
          return {
            error: 'target_scope debe ser STORE u ORGANIZATION.',
            next_step: 'Reintenta con un alcance destino válido.',
          };
        }
        if (reason.length < 10) {
          return {
            error: 'El motivo (reason) necesita mínimo 10 caracteres.',
            next_step: 'Describe por qué se migra; queda en la auditoría.',
          };
        }
        if (!context.organization_id || !context.user_id) {
          return {
            error: 'Sin organización o usuario en contexto.',
            next_step: 'Reintenta dentro de una sesión autenticada.',
          };
        }
        const preview = await deps.fiscalScopeMigrationService.proposeChange(
          context.organization_id,
          target_scope,
          context.user_id,
          reason,
        );
        if (preview.direction === 'NOOP') {
          return {
            error: 'Sin cambios: el alcance destino es el actual.',
            next_step: 'Verifica con get_fiscal_scope (F-92).',
          };
        }
        if (preview.blockers.length > 0 && !force) {
          return {
            error: `Bloqueado por ${preview.blockers.length} condición(es): ${preview.blockers.map((b) => b.message).join(' | ')}.`,
            next_step:
              'Resuelve los blockers o repropón con force=true y motivo explícito.',
          };
        }
        const result = await deps.fiscalScopeMigrationService.applyChange(
          context.organization_id,
          target_scope,
          context.user_id,
          reason,
          force,
        );
        return {
          migrated: true,
          previous_fiscal_scope: result.previous_fiscal_scope,
          new_fiscal_scope: result.new_fiscal_scope,
          forced: result.forced,
          audit_log_id: result.audit_log_id,
          applied_at: result.applied_at,
        };
      }),
    },
  ];
}
