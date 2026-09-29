import {
  RegisteredTool,
  ToolExecutionContext,
} from '../interfaces/tool.interface';
import { SettingsService } from '../../../domains/store/settings/settings.service';
import { StoreRolesService } from '../../../domains/store/roles/store-roles.service';
import { FiscalStatusService } from '@common/services/fiscal-status.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';

/**
 * Familia settings-admin de Vexi (paso 7, track B). Las 6 tools son de
 * LECTURA (`readOnly: true`): exponen configuración de tienda, identidad
 * fiscal, estado fiscal, roles y scopes sin mutar nada.
 *
 * Contratos que respeta esta familia:
 * - Branding NO editable vía Vexi: `get_store_settings` lo devuelve como una
 *   sección más de lectura; no existe write que lo toque en esta familia.
 * - Scopes resueltos por `OperatingScopeService`/`FiscalScopeService`, nunca
 *   duplicados en el tool (ver skills `vendix-operating-scope` y
 *   `vendix-fiscal-scope`).
 * - Permisos verificados en controllers (paso 7, verificación previa):
 *   `store:settings:read` y `store:settings:fiscal_data:read` en
 *   `settings.controller.ts`, `store:settings:fiscal_status:read` en
 *   `fiscal-status.controller.ts`, `store:users:read` en
 *   `store-roles.controller.ts`.
 */

export interface SettingsAdminToolDeps {
  settingsService: SettingsService;
  fiscalStatusService: FiscalStatusService;
  rolesService: StoreRolesService;
  fiscalScopeService: FiscalScopeService;
  operatingScopeService: OperatingScopeService;
}

const PERM_SETTINGS_READ = 'store:settings:read';
const PERM_FISCAL_DATA_READ = 'store:settings:fiscal_data:read';
const PERM_FISCAL_STATUS_READ = 'store:settings:fiscal_status:read';
const PERM_USERS_READ = 'store:users:read';

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
        'Lee la configuración de la tienda por secciones (general, checkout, pos, receipts, inventory, branding, panel_ui, restaurant, vexi, etc.). Acepta `sections` para devolver solo las pedidas; sin el parámetro devuelve todas. Branding es solo lectura por esta vía: Vexi no edita identidad visual. Úsala para "cómo está configurado X" o antes de explicar cualquier comportamiento de la tienda.',
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
  ];
}
