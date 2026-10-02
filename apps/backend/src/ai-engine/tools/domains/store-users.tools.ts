import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { StoreUserManagementService } from '../../../domains/store/store-users/store-user-management.service';

/**
 * Familia store-users de Vex (paso 8 del plan vex-agent).
 *
 * Wrappers finos sobre `StoreUserManagementService` (los endpoints
 * `store/users/management*`); sin SQL directo. El scope tenant lo resuelve
 * el servicio.
 *
 * Cadena: list_store_users/get_store_user (lecturas habilitantes) →
 * invite_store_user (crea con rol operativo) → assign_store_user_roles
 * (reemplaza los role_ids). La contraseña temporal la pide el agente al
 * usuario (fuerte: mayúscula, minúscula, número y símbolo) y nunca viaja
 * en el preview ni en el resumen.
 *
 * Permisos verificados en `store-users.controller.ts`.
 */

export interface StoreUserToolDeps {
  storeUserManagementService: StoreUserManagementService;
}

const PERM_READ = 'store:users:read';
const PERM_CREATE = 'store:users:create';
const PERM_UPDATE = 'store:users:update';

const ASSIGNABLE_ROLES = [
  'manager',
  'supervisor',
  'employee',
  'cashier',
  'carrier',
  'waiter',
  'kitchen',
] as const;

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
  domain = 'store-users',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

function clampLimit(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function userLabel(u: Record<string, any>): string {
  const name =
    [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
    u.email ||
    `#${u.id}`;
  return `${name} <${u.email ?? 'sin correo'}>`;
}

function isEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

export function createStoreUserTools(
  deps: StoreUserToolDeps,
): RegisteredTool[] {
  return [
    // ─── list_store_users (READ) ─────────────────────────────────
    {
      name: 'list_store_users',
      version: '1',
      domain: 'store-users',
      readOnly: true,
      description:
        'Lista usuarios de la tienda con filtros opcionales (search, role, state) y paginación (page, limit máx 100). Úsala para "quién trabaja aquí" o como lectura habilitante antes de proponer assign_store_user_roles.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Texto a buscar.' },
          role: {
            type: 'string',
            description: 'Filtra por rol (ej. cashier, waiter).',
          },
          state: { type: 'string', description: 'Estado del usuario.' },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        for (const key of ['search', 'role', 'state']) {
          if (typeof args[key] === 'string' && args[key].trim()) {
            query[key] = args[key].trim();
          }
        }
        const result = await deps.storeUserManagementService.findAll(
          query as any,
        );
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── get_store_user (READ) ───────────────────────────────────
    {
      name: 'get_store_user',
      version: '1',
      domain: 'store-users',
      readOnly: true,
      description:
        'Lee el detalle de un usuario de la tienda: roles, estado y panel asignado. Cadena obligatoria antes de assign_store_user_roles.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'ID del usuario.' },
        },
        required: ['user_id'],
      },
      requiredPermissions: [PERM_READ],
      handler: guard(async (args) => {
        const id = toPositiveInt(args.user_id);
        if (id === null) {
          return {
            error: `user_id inválido: ${String(args.user_id)}.`,
            next_step: 'Pasa el ID numérico del usuario.',
          };
        }
        const found = await deps.storeUserManagementService.findOne(id);
        return found as unknown as Record<string, any>;
      }),
    },

    // ─── invite_store_user (WRITE) ───────────────────────────────
    {
      name: 'invite_store_user',
      version: '1',
      domain: 'store-users',
      description:
        'Crea un usuario de tienda (first_name, last_name, email único, password fuerte con mayúscula/minúscula/número/símbolo; opcionales username, phone y role operativo: manager, supervisor, employee, cashier, carrier, waiter, kitchen; por defecto employee). La contraseña nunca se muestra en el preview.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string', description: 'Nombres.' },
          last_name: { type: 'string', description: 'Apellidos.' },
          email: {
            type: 'string',
            description: 'Correo único del usuario.',
          },
          password: {
            type: 'string',
            description:
              'Contraseña temporal fuerte (mayúscula, minúscula, número y símbolo).',
          },
          username: { type: 'string', description: 'Usuario (opcional).' },
          phone: { type: 'string', description: 'Teléfono (opcional).' },
          role: {
            type: 'string',
            enum: [...ASSIGNABLE_ROLES],
            description: 'Rol operativo (por defecto employee).',
          },
        },
        required: ['first_name', 'last_name', 'email', 'password'],
      },
      requiredPermissions: [PERM_CREATE],
      requiresConfirmation: true,
      preview: async (args) => {
        if (typeof args?.first_name !== 'string' || !args.first_name.trim()) {
          return previewError('Invitar usuario', 'first_name es obligatorio.');
        }
        if (typeof args?.last_name !== 'string' || !args.last_name.trim()) {
          return previewError('Invitar usuario', 'last_name es obligatorio.');
        }
        if (!isEmail(args?.email)) {
          return previewError(
            'Invitar usuario',
            'email debe ser un correo válido y único.',
          );
        }
        if (
          typeof args?.password !== 'string' ||
          args.password.length < 8
        ) {
          return previewError(
            'Invitar usuario',
            'password debe tener al menos 8 caracteres (fuerte: mayúscula, minúscula, número y símbolo).',
          );
        }
        if (
          args?.role !== undefined &&
          !(ASSIGNABLE_ROLES as readonly string[]).includes(args.role)
        ) {
          return previewError(
            'Invitar usuario',
            `role debe ser uno de: ${(ASSIGNABLE_ROLES as readonly string[]).join(', ')}.`,
          );
        }
        return {
          status: 'ok',
          target: `Invitar a ${args.first_name.trim()} ${args.last_name.trim()} <${args.email.trim()}>`,
          changes: [
            {
              field: 'email',
              label: 'Correo',
              from: null,
              to: args.email.trim(),
            },
            {
              field: 'role',
              label: 'Rol',
              from: null,
              to: args?.role ?? 'employee',
            },
            {
              field: 'password',
              label: 'Contraseña',
              from: null,
              to: 'temporal (no se muestra)',
            },
          ],
          message:
            'El usuario nace activo; dile la contraseña temporal por un canal seguro.',
          domain: 'store-users',
        };
      },
      handler: guard(async (args) => {
        if (
          typeof args?.first_name !== 'string' ||
          !args.first_name.trim() ||
          typeof args?.last_name !== 'string' ||
          !args.last_name.trim()
        ) {
          return {
            error: 'first_name y last_name son obligatorios.',
            next_step: 'Pasa el nombre completo del usuario.',
          };
        }
        if (!isEmail(args?.email)) {
          return {
            error: `email inválido: ${String(args?.email)}.`,
            next_step: 'Pasa un correo válido y único.',
          };
        }
        if (typeof args?.password !== 'string' || !args.password) {
          return {
            error: 'password es obligatorio.',
            next_step: 'Pide una contraseña temporal fuerte al usuario.',
          };
        }
        const dto: Record<string, any> = {
          first_name: args.first_name.trim(),
          last_name: args.last_name.trim(),
          email: args.email.trim(),
          password: args.password,
        };
        for (const key of ['username', 'phone', 'role']) {
          if (args?.[key] !== undefined && args?.[key] !== null) {
            dto[key] =
              typeof args[key] === 'string' ? args[key].trim() : args[key];
          }
        }
        const created = await deps.storeUserManagementService.create(
          dto as any,
        );
        const row = created as unknown as Record<string, any>;
        return {
          resumen: `Usuario ${userLabel({ ...dto, ...row })} creado.`,
          user_id: row.id,
          resultado: { ...row, password: undefined },
        };
      }),
    },

    // ─── assign_store_user_roles (WRITE) ─────────────────────────
    {
      name: 'assign_store_user_roles',
      version: '1',
      domain: 'store-users',
      description:
        'Reemplaza los roles de un usuario de la tienda (user_id + role_ids no vacío). Cadena: get_store_user para ver los roles actuales.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'ID del usuario.' },
          role_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'IDs de roles que reemplazan a los actuales.',
          },
        },
        required: ['user_id', 'role_ids'],
      },
      requiredPermissions: [PERM_UPDATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.user_id);
        if (id === null) {
          return previewError(
            'Asignar roles',
            'user_id inválido: consíguelo con list_store_users.',
          );
        }
        if (
          !Array.isArray(args?.role_ids) ||
          args.role_ids.length === 0 ||
          !args.role_ids.every((v: unknown) => toPositiveInt(v) !== null)
        ) {
          return previewError(
            'Asignar roles',
            'role_ids debe ser un arreglo no vacío de IDs positivos.',
          );
        }
        let current = 'actuales';
        let subject = `usuario #${id}`;
        try {
          const found = (await deps.storeUserManagementService.findOne(
            id,
          )) as unknown as Record<string, any>;
          if (found) {
            subject = userLabel(found);
            const roles = found.roles ?? found.store_roles ?? [];
            if (Array.isArray(roles) && roles.length > 0) {
              current = roles
                .map((r: any) => r?.name ?? `#${r?.id}`)
                .join(', ');
            }
          }
        } catch {
          // Sujeto genérico: el handler re-verifica la existencia.
        }
        return {
          status: 'warning',
          target: `Asignar roles a ${subject}`,
          changes: [
            {
              field: 'role_ids',
              label: 'Roles',
              from: current,
              to: args.role_ids.map(Number).join(', '),
            },
          ],
          message: 'Reemplaza los roles actuales; revisa antes de aprobar.',
          domain: 'store-users',
        };
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args?.user_id);
        if (id === null) {
          return {
            error: 'user_id inválido.',
            next_step: 'Consíguelo con list_store_users.',
          };
        }
        if (
          !Array.isArray(args?.role_ids) ||
          args.role_ids.length === 0 ||
          !args.role_ids.every((v: unknown) => toPositiveInt(v) !== null)
        ) {
          return {
            error: 'role_ids debe ser un arreglo no vacío de IDs positivos.',
            next_step: 'Pasa los IDs de los roles a asignar.',
          };
        }
        const updated = await deps.storeUserManagementService.updateRoles(
          id,
          { role_ids: args.role_ids.map(Number) } as any,
        );
        const row = updated as unknown as Record<string, any>;
        return {
          resumen: `Roles actualizados para el usuario #${row.id ?? id}.`,
          user_id: row.id ?? id,
          resultado: row,
        };
      }),
    },
  ];
}
