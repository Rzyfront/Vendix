import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { MembershipsService } from '../../../domains/store/memberships/memberships.service';
import { MembershipAccessService } from '../../../domains/store/membership-access/membership-access.service';
import { MembershipPlansService } from '../../../domains/store/membership-plans/membership-plans.service';

/**
 * Familia memberships de Vex (paso 8 del plan vex-agent).
 *
 * Wrappers finos sobre `MembershipsService` (venta y listado),
 * `MembershipPlansService` (planes) y `MembershipAccessService.validate`
 * (check-in); sin SQL directo. El scope tenant lo resuelven los
 * servicios (StorePrismaService).
 *
 * Cadena: list_membership_plans/list_memberships (lecturas habilitantes)
 * → sell_membership (nace en `pending_payment`, sin membresía viva sin
 * pago) → checkin_member (valida la credencial y registra el ingreso).
 * `checkin_member` escribe (bitácora de accesos + ocupación), por eso
 * exige confirmación; su preview no llama al servicio para no duplicar
 * el registro — describe lo que va a validar.
 *
 * Permisos verificados en `memberships.controller.ts`,
 * `membership-plans.controller.ts` y `membership-access.controller.ts`.
 */

export interface MembershipToolDeps {
  membershipsService: MembershipsService;
  membershipAccessService: MembershipAccessService;
  membershipPlansService: MembershipPlansService;
}

const PERM_MEMBERSHIPS_READ = 'store:memberships:read';
const PERM_MEMBERSHIPS_CREATE = 'store:memberships:create';
const PERM_ACCESS_CREATE = 'store:membership_access:create';
const PERM_PLANS_READ = 'store:membership_plans:read';

const MEMBERSHIP_STATUSES = [
  'active',
  'expired',
  'suspended',
  'frozen',
  'pending_payment',
  'cancelled',
] as const;
const CREDENTIAL_TYPES = ['qr', 'pin', 'external_ref'] as const;

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
  domain = 'memberships',
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

export function createMembershipTools(
  deps: MembershipToolDeps,
): RegisteredTool[] {
  return [
    // ─── list_membership_plans (READ) ────────────────────────────
    {
      name: 'list_membership_plans',
      version: '1',
      domain: 'memberships',
      readOnly: true,
      description:
        'Lista los planes de membresía de la tienda con paginación (page, limit máx 100). Úsala para "qué planes hay" o como lectura habilitante antes de proponer sell_membership.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_PLANS_READ],
      handler: guard(async (args) => {
        const result = await deps.membershipPlansService.findAll({
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        } as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── list_memberships (READ) ─────────────────────────────────
    {
      name: 'list_memberships',
      version: '1',
      domain: 'memberships',
      readOnly: true,
      description:
        'Lista membresías con filtros opcionales (search, status, customer_id, plan_id) y paginación (page, limit máx 100). Úsala para "quién está activo" o como lectura habilitante antes de proponer sell_membership.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Texto a buscar.' },
          status: {
            type: 'string',
            enum: [...MEMBERSHIP_STATUSES],
            description: 'Estado de la membresía.',
          },
          customer_id: { type: 'number', description: 'ID del cliente.' },
          plan_id: { type: 'number', description: 'ID del plan.' },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_MEMBERSHIPS_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        if (typeof args.search === 'string' && args.search.trim()) {
          query.search = args.search.trim();
        }
        if (
          typeof args.status === 'string' &&
          (MEMBERSHIP_STATUSES as readonly string[]).includes(args.status)
        ) {
          query.status = args.status;
        }
        for (const key of ['customer_id', 'plan_id']) {
          if (args[key] !== undefined) {
            const id = toPositiveInt(args[key]);
            if (id === null) {
              return {
                error: `${key} inválido: ${String(args[key])}.`,
                next_step: 'Pasa el ID numérico.',
              };
            }
            query[key] = id;
          }
        }
        const result = await deps.membershipsService.findAll(query as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── get_membership (READ) ───────────────────────────────────
    {
      name: 'get_membership',
      version: '1',
      domain: 'memberships',
      readOnly: true,
      description:
        'Lee el detalle de una membresía: estado, plan, vigencia y cliente.',
      parameters: {
        type: 'object',
        properties: {
          membership_id: {
            type: 'number',
            description: 'ID de la membresía.',
          },
        },
        required: ['membership_id'],
      },
      requiredPermissions: [PERM_MEMBERSHIPS_READ],
      handler: guard(async (args) => {
        const id = toPositiveInt(args.membership_id);
        if (id === null) {
          return {
            error: `membership_id inválido: ${String(args.membership_id)}.`,
            next_step: 'Pasa el ID numérico de la membresía.',
          };
        }
        const found = await deps.membershipsService.findOne(id);
        return found as unknown as Record<string, any>;
      }),
    },

    // ─── sell_membership (WRITE) ─────────────────────────────────
    {
      name: 'sell_membership',
      version: '1',
      domain: 'memberships',
      description:
        'Vende una membresía (customer_id + plan_id; opcionales period_start YYYY-MM-DD, auto_renew, notes). Nace en pending_payment: no hay membresía viva sin pago; el cobro la activa. Cadena: list_membership_plans para elegir el plan.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'number',
            description: 'ID del cliente (socio).',
          },
          plan_id: { type: 'number', description: 'ID del plan.' },
          period_start: {
            type: 'string',
            description: 'Inicio del periodo (YYYY-MM-DD, opcional).',
          },
          auto_renew: {
            type: 'boolean',
            description: 'Renovación automática (opcional).',
          },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['customer_id', 'plan_id'],
      },
      requiredPermissions: [PERM_MEMBERSHIPS_CREATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const customer_id = toPositiveInt(args?.customer_id);
        if (customer_id === null) {
          return previewError(
            'Vender membresía',
            'customer_id inválido: consigue el cliente en el módulo de clientes.',
          );
        }
        const plan_id = toPositiveInt(args?.plan_id);
        if (plan_id === null) {
          return previewError(
            'Vender membresía',
            'plan_id inválido: consíguelo con list_membership_plans.',
          );
        }
        let planName = `plan #${plan_id}`;
        try {
          const plan = (await deps.membershipPlansService.findOne(
            plan_id,
          )) as unknown as Record<string, any>;
          if (plan?.name) planName = String(plan.name);
        } catch (error: any) {
          return previewError(
            'Vender membresía',
            `No se pudo leer el plan #${plan_id}: ${describeError(error)}.`,
          );
        }
        return {
          status: 'ok',
          target: `Vender ${planName} al cliente #${customer_id}`,
          changes: [
            {
              field: 'customer_id',
              label: 'Cliente',
              from: null,
              to: `#${customer_id}`,
            },
            { field: 'plan', label: 'Plan', from: null, to: planName },
            {
              field: 'status',
              label: 'Estado inicial',
              from: null,
              to: 'pending_payment',
            },
          ],
          message:
            'La membresía nace en pending_payment; el cobro la activa.',
          domain: 'memberships',
        };
      },
      handler: guard(async (args) => {
        const customer_id = toPositiveInt(args?.customer_id);
        if (customer_id === null) {
          return {
            error: 'customer_id inválido.',
            next_step: 'Pasa el ID numérico del cliente.',
          };
        }
        const plan_id = toPositiveInt(args?.plan_id);
        if (plan_id === null) {
          return {
            error: 'plan_id inválido.',
            next_step: 'Consíguelo con list_membership_plans.',
          };
        }
        const dto: Record<string, any> = { customer_id, plan_id };
        for (const key of ['period_start', 'auto_renew', 'notes']) {
          if (args?.[key] !== undefined && args?.[key] !== null) {
            dto[key] = args[key];
          }
        }
        const created = await deps.membershipsService.create(dto as any);
        const row = created as unknown as Record<string, any>;
        return {
          resumen: `Membresía #${row.id ?? '?'} vendida (pending_payment).`,
          membership_id: row.id,
          resultado: row,
        };
      }),
    },

    // ─── checkin_member (WRITE) ──────────────────────────────────
    {
      name: 'checkin_member',
      version: '1',
      domain: 'memberships',
      description:
        'Registra el ingreso de un socio validando su credencial (credential_type qr|pin|external_ref + credential_value exacto; device_id opcional). Responde granted o el motivo de rechazo y deja el ingreso en la bitácora. Escribe bitácora y ocupación: exige confirmación.',
      parameters: {
        type: 'object',
        properties: {
          credential_type: {
            type: 'string',
            enum: [...CREDENTIAL_TYPES],
            description: 'Tipo de credencial: qr, pin o external_ref.',
          },
          credential_value: {
            type: 'string',
            description: 'Valor exacto de la credencial.',
          },
          device_id: {
            type: 'string',
            description: 'ID del dispositivo lector (opcional).',
          },
        },
        required: ['credential_type', 'credential_value'],
      },
      requiredPermissions: [PERM_ACCESS_CREATE],
      requiresConfirmation: true,
      preview: async (args) => {
        if (
          typeof args?.credential_type !== 'string' ||
          !(CREDENTIAL_TYPES as readonly string[]).includes(
            args.credential_type,
          )
        ) {
          return previewError(
            'Check-in de socio',
            'credential_type debe ser qr, pin o external_ref.',
          );
        }
        if (
          typeof args?.credential_value !== 'string' ||
          !args.credential_value.trim()
        ) {
          return previewError(
            'Check-in de socio',
            'credential_value es obligatorio y debe ser el valor exacto.',
          );
        }
        // Sin llamada al servicio: validar aquí duplicaría el registro de
        // ingreso (el validate escribe bitácora y consume ocupación).
        return {
          status: 'ok',
          target: `Check-in con credencial ${args.credential_type}`,
          changes: [
            {
              field: 'credential_type',
              label: 'Credencial',
              from: null,
              to: args.credential_type,
            },
            { field: 'access', label: 'Ingreso', from: null, to: 'registrado' },
          ],
          message:
            'Valida la credencial y registra el ingreso en la bitácora.',
          domain: 'memberships',
        };
      },
      handler: guard(async (args) => {
        if (
          typeof args?.credential_type !== 'string' ||
          !(CREDENTIAL_TYPES as readonly string[]).includes(
            args.credential_type,
          )
        ) {
          return {
            error: 'credential_type debe ser qr, pin o external_ref.',
            next_step: 'Pasa el tipo de credencial presentada.',
          };
        }
        if (
          typeof args?.credential_value !== 'string' ||
          !args.credential_value.trim()
        ) {
          return {
            error: 'credential_value es obligatorio.',
            next_step: 'Pasa el valor exacto de la credencial.',
          };
        }
        const dto: Record<string, any> = {
          credential_type: args.credential_type,
          credential_value: args.credential_value.trim(),
        };
        if (typeof args?.device_id === 'string' && args.device_id.trim()) {
          dto.device_id = args.device_id.trim();
        }
        const result = await deps.membershipAccessService.validate(dto as any);
        const row = result as unknown as Record<string, any>;
        const granted =
          row.granted === true || row.result === 'granted';
        return {
          resumen: granted
            ? `Ingreso concedido (${row.member_name ?? row.customer_name ?? 'socio'}).`
            : `Ingreso denegado: ${row.result ?? row.reason ?? 'sin motivo'}.`,
          granted,
          resultado: row,
        };
      }),
    },
  ];
}
