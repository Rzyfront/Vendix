import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { AccountsReceivableService } from '../../../domains/store/accounts-receivable/accounts-receivable.service';
import { AccountsPayableService } from '../../../domains/store/accounts-payable/accounts-payable.service';

/**
 * Familia receivables-payables de Vex (paso 8 del plan vex-agent).
 *
 * Wrappers finos sobre `AccountsReceivableService` (cartera) y
 * `AccountsPayableService` (CxP); sin SQL directo. El scope tenant lo
 * resuelven los servicios (StorePrismaService).
 *
 * Cadena: list_receivables/get_receivable → collect_receivable (abono de
 * cartera) y list_payables/get_payable → pay_payable (pago a proveedor).
 * Los pagos re-verifican saldo y estado en el handler: el preview es
 * proyección, no transacción. El `user_id` del turno viaja como firmante
 * del pago, igual que `req.user.id` en los endpoints.
 *
 * Permisos verificados en `accounts-receivable.controller.ts` y
 * `accounts-payable.controller.ts`.
 */

export interface ReceivablesPayablesToolDeps {
  accountsReceivableService: AccountsReceivableService;
  accountsPayableService: AccountsPayableService;
}

const PERM_AR_READ = 'store:accounts_receivable:read';
const PERM_AR_PAYMENT = 'store:accounts_receivable:payment';
const PERM_AP_READ = 'store:accounts_payable:read';
const PERM_AP_PAYMENT = 'store:accounts_payable:payment';

const AR_STATUSES = ['open', 'partial', 'overdue', 'paid', 'written_off'] as const;
const PAYABLE_FINAL = ['paid', 'written_off'] as const;

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
  domain = 'receivables-payables',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

function clampLimit(value: unknown, fallback = 20): number {
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

function isDateOnly(value: unknown): value is string {
  return (
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  );
}

function arLabel(ar: Record<string, any>): string {
  const who =
    ar.customer_name ?? ar.customer?.name ?? `cliente #${ar.customer_id ?? '?'}`;
  return `CxC #${ar.id} — ${who}`;
}

function apLabel(ap: Record<string, any>): string {
  const who =
    ap.supplier_name ?? ap.supplier?.name ?? `proveedor #${ap.supplier_id ?? '?'}`;
  return `CxP #${ap.id} — ${who}`;
}

export function createReceivablesPayablesTools(
  deps: ReceivablesPayablesToolDeps,
): RegisteredTool[] {
  return [
    // ─── list_receivables (READ) ─────────────────────────────────
    {
      name: 'list_receivables',
      version: '1',
      domain: 'receivables-payables',
      readOnly: true,
      description:
        'Lista cuentas por cobrar con filtros opcionales (status, customer_id, search, date_from/date_to) y paginación (page, limit máx 100). Úsala para "quién nos debe" o como lectura habilitante antes de proponer collect_receivable.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: [...AR_STATUSES],
            description: 'Estado de la cuenta.',
          },
          customer_id: { type: 'number', description: 'ID del cliente.' },
          search: { type: 'string', description: 'Texto a buscar.' },
          date_from: { type: 'string', description: 'Desde (YYYY-MM-DD).' },
          date_to: { type: 'string', description: 'Hasta (YYYY-MM-DD).' },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 20, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_AR_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        if (
          typeof args.status === 'string' &&
          (AR_STATUSES as readonly string[]).includes(args.status)
        ) {
          query.status = args.status;
        }
        if (args.customer_id !== undefined) {
          const customer_id = toPositiveInt(args.customer_id);
          if (customer_id === null) {
            return {
              error: `customer_id inválido: ${String(args.customer_id)}.`,
              next_step: 'Pasa el ID numérico del cliente.',
            };
          }
          query.customer_id = customer_id;
        }
        if (typeof args.search === 'string' && args.search.trim()) {
          query.search = args.search.trim();
        }
        for (const key of ['date_from', 'date_to']) {
          if (args[key] !== undefined) {
            if (!isDateOnly(args[key])) {
              return {
                error: `${key} inválido: ${String(args[key])}.`,
                next_step: 'Usa formato YYYY-MM-DD.',
              };
            }
            query[key] = args[key];
          }
        }
        const result = await deps.accountsReceivableService.findAll(
          query as any,
        );
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── get_receivable (READ) ───────────────────────────────────
    {
      name: 'get_receivable',
      version: '1',
      domain: 'receivables-payables',
      readOnly: true,
      description:
        'Lee el detalle de una cuenta por cobrar: saldo, estado, vencimiento y abonos. Cadena obligatoria antes de collect_receivable.',
      parameters: {
        type: 'object',
        properties: {
          receivable_id: {
            type: 'number',
            description: 'ID de la cuenta por cobrar.',
          },
        },
        required: ['receivable_id'],
      },
      requiredPermissions: [PERM_AR_READ],
      handler: guard(async (args) => {
        const id = toPositiveInt(args.receivable_id);
        if (id === null) {
          return {
            error: `receivable_id inválido: ${String(args.receivable_id)}.`,
            next_step: 'Pasa el ID numérico de la cuenta.',
          };
        }
        const found = await deps.accountsReceivableService.findOne(id);
        return found as unknown as Record<string, any>;
      }),
    },

    // ─── collect_receivable (WRITE) ──────────────────────────────
    {
      name: 'collect_receivable',
      version: '1',
      domain: 'receivables-payables',
      description:
        'Registra un abono o pago total de una cuenta por cobrar (monto mayor que cero, sin exceder el saldo; payment_method, reference y notes opcionales). Cadena: get_receivable para confirmar saldo y estado.',
      parameters: {
        type: 'object',
        properties: {
          receivable_id: {
            type: 'number',
            description: 'ID de la cuenta por cobrar.',
          },
          amount: {
            type: 'number',
            description: 'Monto del abono (mayor que cero, <= saldo).',
          },
          payment_method: {
            type: 'string',
            description: 'Medio de pago (opcional).',
          },
          reference: { type: 'string', description: 'Referencia (opcional).' },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['receivable_id', 'amount'],
      },
      requiredPermissions: [PERM_AR_PAYMENT],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.receivable_id);
        if (id === null) {
          return previewError(
            'Cobrar cartera',
            'receivable_id inválido: consíguelo con list_receivables.',
          );
        }
        const amount = Number(args?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return previewError(
            'Cobrar cartera',
            'amount debe ser un número mayor que cero.',
          );
        }
        let ar: Record<string, any> | null;
        try {
          ar = (await deps.accountsReceivableService.findOne(
            id,
          )) as unknown as Record<string, any>;
        } catch (error: any) {
          return previewError(
            `CxC #${id}`,
            `No se pudo leer la cuenta: ${describeError(error)}.`,
          );
        }
        if (!ar) {
          return previewError(
            `CxC #${id}`,
            'La cuenta no existe o no es visible en esta tienda.',
          );
        }
        if ((PAYABLE_FINAL as readonly string[]).includes(ar.status)) {
          return previewError(
            arLabel(ar),
            `La cuenta ya está en "${ar.status}": no recibe más abonos.`,
          );
        }
        const balance = Number(ar.balance);
        if (Number.isFinite(balance) && amount > balance) {
          return previewError(
            arLabel(ar),
            `El abono ($${amount}) excede el saldo pendiente ($${balance}).`,
          );
        }
        return {
          status: 'ok',
          target: `Abonar $${amount} a ${arLabel(ar)}`,
          changes: [
            {
              field: 'balance',
              label: 'Saldo',
              from: Number.isFinite(balance) ? balance : 'actual',
              to: Number.isFinite(balance) ? balance - amount : 'menor',
            },
            { field: 'amount', label: 'Abono', from: null, to: amount },
          ],
          domain: 'receivables-payables',
        };
      },
      handler: guard(async (args, context) => {
        const id = toPositiveInt(args?.receivable_id);
        if (id === null) {
          return {
            error: 'receivable_id inválido.',
            next_step: 'Consíguelo con list_receivables.',
          };
        }
        const amount = Number(args?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return {
            error: 'amount debe ser mayor que cero.',
            next_step: 'Pasa el monto del abono.',
          };
        }
        if (!context.user_id) {
          return {
            error: 'Sin usuario en contexto: el pago necesita firmante.',
            next_step: 'Reintenta desde una sesión autenticada.',
          };
        }
        const ar = (await deps.accountsReceivableService.findOne(
          id,
        )) as unknown as Record<string, any>;
        if (!ar) {
          return {
            error: `La CxC #${id} no existe.`,
            next_step: 'Elige una cuenta existente con list_receivables.',
          };
        }
        if ((PAYABLE_FINAL as readonly string[]).includes(ar.status)) {
          return {
            error: `${arLabel(ar)} ya está en "${ar.status}".`,
            next_step: 'Lee el estado actual con get_receivable.',
          };
        }
        const balance = Number(ar.balance);
        if (Number.isFinite(balance) && amount > balance) {
          return {
            error: `El abono ($${amount}) excede el saldo pendiente ($${balance}).`,
            next_step: 'Ajusta el monto al saldo con get_receivable.',
          };
        }
        const dto: Record<string, any> = { amount };
        for (const key of ['payment_method', 'reference', 'notes']) {
          if (typeof args?.[key] === 'string' && args[key].trim()) {
            dto[key] = args[key].trim();
          }
        }
        const paid = await deps.accountsReceivableService.registerPayment(
          id,
          dto as any,
          context.user_id,
        );
        const row = paid as unknown as Record<string, any>;
        return {
          resumen: `Abono $${amount} registrado en ${arLabel(ar)}.`,
          receivable_id: id,
          resultado: row,
        };
      }),
    },

    // ─── list_payables (READ) ────────────────────────────────────
    {
      name: 'list_payables',
      version: '1',
      domain: 'receivables-payables',
      readOnly: true,
      description:
        'Lista cuentas por pagar con filtros opcionales (status, supplier_id, search, date_from/date_to) y paginación (page, limit máx 100). Úsala para "qué debemos a proveedores" o como lectura habilitante antes de proponer pay_payable.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: [...AR_STATUSES],
            description: 'Estado de la cuenta.',
          },
          supplier_id: { type: 'number', description: 'ID del proveedor.' },
          search: { type: 'string', description: 'Texto a buscar.' },
          date_from: { type: 'string', description: 'Desde (YYYY-MM-DD).' },
          date_to: { type: 'string', description: 'Hasta (YYYY-MM-DD).' },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 20, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_AP_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        if (
          typeof args.status === 'string' &&
          (AR_STATUSES as readonly string[]).includes(args.status)
        ) {
          query.status = args.status;
        }
        if (args.supplier_id !== undefined) {
          const supplier_id = toPositiveInt(args.supplier_id);
          if (supplier_id === null) {
            return {
              error: `supplier_id inválido: ${String(args.supplier_id)}.`,
              next_step: 'Pasa el ID numérico del proveedor.',
            };
          }
          query.supplier_id = supplier_id;
        }
        if (typeof args.search === 'string' && args.search.trim()) {
          query.search = args.search.trim();
        }
        for (const key of ['date_from', 'date_to']) {
          if (args[key] !== undefined) {
            if (!isDateOnly(args[key])) {
              return {
                error: `${key} inválido: ${String(args[key])}.`,
                next_step: 'Usa formato YYYY-MM-DD.',
              };
            }
            query[key] = args[key];
          }
        }
        const result = await deps.accountsPayableService.findAll(query as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── get_payable (READ) ──────────────────────────────────────
    {
      name: 'get_payable',
      version: '1',
      domain: 'receivables-payables',
      readOnly: true,
      description:
        'Lee el detalle de una cuenta por pagar: saldo, estado, vencimiento y pagos. Cadena obligatoria antes de pay_payable.',
      parameters: {
        type: 'object',
        properties: {
          payable_id: {
            type: 'number',
            description: 'ID de la cuenta por pagar.',
          },
        },
        required: ['payable_id'],
      },
      requiredPermissions: [PERM_AP_READ],
      handler: guard(async (args) => {
        const id = toPositiveInt(args.payable_id);
        if (id === null) {
          return {
            error: `payable_id inválido: ${String(args.payable_id)}.`,
            next_step: 'Pasa el ID numérico de la cuenta.',
          };
        }
        const found = await deps.accountsPayableService.findOne(id);
        return found as unknown as Record<string, any>;
      }),
    },

    // ─── pay_payable (WRITE) ─────────────────────────────────────
    {
      name: 'pay_payable',
      version: '1',
      domain: 'receivables-payables',
      description:
        'Registra un pago a proveedor en una cuenta por pagar (monto mayor que cero sin exceder el saldo; payment_method obligatorio: cash, bank_transfer o check; reference y notes opcionales). Cadena: get_payable para confirmar saldo y estado.',
      parameters: {
        type: 'object',
        properties: {
          payable_id: {
            type: 'number',
            description: 'ID de la cuenta por pagar.',
          },
          amount: {
            type: 'number',
            description: 'Monto del pago (mayor que cero, <= saldo).',
          },
          payment_method: {
            type: 'string',
            description: 'Medio de pago: cash, bank_transfer o check.',
          },
          reference: { type: 'string', description: 'Referencia (opcional).' },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['payable_id', 'amount', 'payment_method'],
      },
      requiredPermissions: [PERM_AP_PAYMENT],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.payable_id);
        if (id === null) {
          return previewError(
            'Pagar proveedor',
            'payable_id inválido: consíguelo con list_payables.',
          );
        }
        const amount = Number(args?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return previewError(
            'Pagar proveedor',
            'amount debe ser un número mayor que cero.',
          );
        }
        if (
          typeof args?.payment_method !== 'string' ||
          !args.payment_method.trim()
        ) {
          return previewError(
            'Pagar proveedor',
            'payment_method es obligatorio: cash, bank_transfer o check.',
          );
        }
        let ap: Record<string, any> | null;
        try {
          ap = (await deps.accountsPayableService.findOne(
            id,
          )) as unknown as Record<string, any>;
        } catch (error: any) {
          return previewError(
            `CxP #${id}`,
            `No se pudo leer la cuenta: ${describeError(error)}.`,
          );
        }
        if (!ap) {
          return previewError(
            `CxP #${id}`,
            'La cuenta no existe o no es visible en esta tienda.',
          );
        }
        if ((PAYABLE_FINAL as readonly string[]).includes(ap.status)) {
          return previewError(
            apLabel(ap),
            `La cuenta ya está en "${ap.status}": no recibe más pagos.`,
          );
        }
        const balance = Number(ap.balance);
        if (Number.isFinite(balance) && amount > balance) {
          return previewError(
            apLabel(ap),
            `El pago ($${amount}) excede el saldo pendiente ($${balance}).`,
          );
        }
        return {
          status: 'warning',
          target: `Pagar $${amount} en ${apLabel(ap)} vía ${args.payment_method.trim()}`,
          changes: [
            {
              field: 'balance',
              label: 'Saldo',
              from: Number.isFinite(balance) ? balance : 'actual',
              to: Number.isFinite(balance) ? balance - amount : 'menor',
            },
            { field: 'amount', label: 'Pago', from: null, to: amount },
          ],
          message: 'El dinero sale de la tienda; verifica el saldo antes.',
          domain: 'receivables-payables',
        };
      },
      handler: guard(async (args, context) => {
        const id = toPositiveInt(args?.payable_id);
        if (id === null) {
          return {
            error: 'payable_id inválido.',
            next_step: 'Consíguelo con list_payables.',
          };
        }
        const amount = Number(args?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return {
            error: 'amount debe ser mayor que cero.',
            next_step: 'Pasa el monto del pago.',
          };
        }
        if (
          typeof args?.payment_method !== 'string' ||
          !args.payment_method.trim()
        ) {
          return {
            error: 'payment_method es obligatorio.',
            next_step: 'Usa cash, bank_transfer o check.',
          };
        }
        if (!context.user_id) {
          return {
            error: 'Sin usuario en contexto: el pago necesita firmante.',
            next_step: 'Reintenta desde una sesión autenticada.',
          };
        }
        const ap = (await deps.accountsPayableService.findOne(
          id,
        )) as unknown as Record<string, any>;
        if (!ap) {
          return {
            error: `La CxP #${id} no existe.`,
            next_step: 'Elige una cuenta existente con list_payables.',
          };
        }
        if ((PAYABLE_FINAL as readonly string[]).includes(ap.status)) {
          return {
            error: `${apLabel(ap)} ya está en "${ap.status}".`,
            next_step: 'Lee el estado actual con get_payable.',
          };
        }
        const balance = Number(ap.balance);
        if (Number.isFinite(balance) && amount > balance) {
          return {
            error: `El pago ($${amount}) excede el saldo pendiente ($${balance}).`,
            next_step: 'Ajusta el monto al saldo con get_payable.',
          };
        }
        const dto: Record<string, any> = {
          amount,
          payment_method: args.payment_method.trim(),
        };
        for (const key of ['reference', 'notes']) {
          if (typeof args?.[key] === 'string' && args[key].trim()) {
            dto[key] = args[key].trim();
          }
        }
        const paid = await deps.accountsPayableService.registerPayment(
          id,
          dto as any,
          context.user_id,
        );
        const row = paid as unknown as Record<string, any>;
        return {
          resumen: `Pago $${amount} registrado en ${apLabel(ap)}.`,
          payable_id: id,
          resultado: row,
        };
      }),
    },
  ];
}
