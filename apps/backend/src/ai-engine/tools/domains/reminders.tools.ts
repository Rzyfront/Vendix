import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import {
  ReminderActor,
  ReminderView,
  RemindersService,
} from '../../../domains/store/reminders/reminders.service';
import {
  CreateReminderDto,
  REMINDER_LINK_TYPES,
  RemindersQueryDto,
  UpdateReminderDto,
} from '../../../domains/store/reminders/dto/reminders.dto';

export interface ReminderToolDeps {
  remindersService: RemindersService;
}

const LIST_FILTERS = [
  'pending',
  'today',
  'overdue',
  'upcoming',
  'no_date',
  'done',
  'all',
] as const;
type ListFilter = (typeof LIST_FILTERS)[number];

const BUCKET_LABELS: Record<ReminderView['bucket'], string> = {
  overdue: 'Vencido',
  today: 'Hoy',
  upcoming: 'Próximo',
  no_date: 'Sin fecha',
  done: 'Hecho',
};

const REMIND_AT_HELP =
  'Fecha/hora en la hora LOCAL de la tienda, formato YYYY-MM-DDTHH:mm (ej. 2026-11-20T17:00). Solo fecha (YYYY-MM-DD) recuerda a las 8:00. Calcula fechas relativas ("mañana", "el viernes") con now_local de list_reminders.';

const LINK_PROPERTIES = {
  link_type: {
    type: 'string',
    enum: [...REMINDER_LINK_TYPES],
    description:
      'Vínculo opcional a un dato de la tienda: product, order, customer, supplier (exigen link_id; resuélvelo antes con la herramienta de búsqueda del dominio) o metric (solo link_label, p. ej. "Ventas del mes").',
  },
  link_id: {
    type: 'number',
    description: 'ID del producto/orden/cliente/proveedor vinculado.',
  },
  link_label: {
    type: 'string',
    description:
      'Etiqueta legible del vínculo. Si se omite en product/order/customer/supplier se toma el nombre del dato.',
  },
} as const;

function guidedError(error: string, nextStep?: string): string {
  return JSON.stringify({ error, ...(nextStep ? { next_step: nextStep } : {}) });
}

function describeError(error: unknown): string {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string'
      ? response
      : (response?.message ?? error.message);
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}

/**
 * The actor is ALWAYS the user of the current conversation in its store
 * (`ToolExecutionContext`); no tool accepts a store or user argument.
 */
function actorOf(context: ToolExecutionContext): ReminderActor | null {
  if (!context.store_id || !context.user_id) return null;
  return { store_id: Number(context.store_id), user_id: Number(context.user_id) };
}

const NO_CONTEXT = guidedError(
  'Sin usuario y tienda en contexto: la bitácora es personal y vive dentro de una tienda.',
);

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validated<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return { ok: false, message: `Datos inválidos: ${details}.` };
}

function pick(args: Record<string, unknown>, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (args[key] !== undefined) out[key] = args[key];
  return out;
}

/** Compact shape for the model plus a ready-to-show line for the chat. */
function compact(reminder: ReminderView) {
  return {
    reminder_id: reminder.id,
    title: reminder.title,
    note: reminder.note,
    remind_at_local: reminder.remind_at_local,
    status: reminder.status,
    bucket: reminder.bucket,
    link: reminder.link,
    source: reminder.source,
  };
}

function displayLine(reminder: ReminderView): string {
  const when = reminder.remind_at_local ?? 'sin fecha';
  const link = reminder.link ? ` · 🔗 ${reminder.link.label}` : '';
  const mark = reminder.status === 'done' ? '✅' : '🔔';
  return `${mark} ${reminder.title} — ${when} (${BUCKET_LABELS[reminder.bucket]})${link}`;
}

function listQuery(filter: ListFilter, limit: number | null): RemindersQueryDto {
  const query: RemindersQueryDto = { limit: limit ?? 50 };
  if (filter === 'done') query.status = 'done';
  else if (filter === 'all') query.status = 'all';
  else if (filter !== 'pending') query.due = filter;
  return query;
}

const CREATE_KEYS = ['title', 'note', 'remind_at', 'link_type', 'link_id', 'link_label'];
const UPDATE_KEYS = [...CREATE_KEYS, 'status'];

/**
 * QUI-580 — Vex tools for the user's personal reminders log (bitácora).
 *
 * - `list_reminders` is read-only.
 * - `create_reminder`, `update_reminder` and `complete_reminder` are direct
 *   writes on the caller's OWN personal notes: reversible, no business data,
 *   so they do not open a confirmation card.
 * - `delete_reminder` cannot be walked back: it goes through
 *   propose → confirm → execute with a preview naming the reminder.
 *
 * Every call delegates to `RemindersService` with the actor taken from the
 * execution context, so Vex only ever sees the current user's reminders in
 * the current store.
 */
export function createReminderTools(deps: ReminderToolDeps): RegisteredTool[] {
  const { remindersService } = deps;

  return [
    {
      name: 'list_reminders',
      version: '1',
      domain: 'reminders',
      description:
        'Lista los recordatorios de la bitácora PERSONAL del usuario actual en esta tienda. Filtros: pending (todos los pendientes, por defecto), today, overdue, upcoming, no_date, done, all. Devuelve now_local (fecha/hora actual de la tienda) y una línea `display` por recordatorio: muéstralas como lista al usuario.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: [...LIST_FILTERS],
            description: 'pending, today, overdue, upcoming, no_date, done o all.',
          },
          limit: { type: 'number', description: 'Máximo de resultados (1-200, por defecto 50).' },
        },
      },
      readOnly: true,
      handler: async (args, context) => {
        const actor = actorOf(context);
        if (!actor) return NO_CONTEXT;
        const filter = (args.filter ?? 'pending') as ListFilter;
        if (!LIST_FILTERS.includes(filter)) {
          return guidedError(`filter "${String(filter)}" inválido. Usa ${LIST_FILTERS.join(', ')}.`);
        }
        const limit = toPositiveInt(args.limit);
        try {
          const result = await remindersService.list(
            actor,
            listQuery(filter, limit ? Math.min(limit, 200) : null),
          );
          return JSON.stringify({
            filter,
            now_local: result.now_local,
            timezone: result.timezone,
            count: result.items.length,
            reminders: result.items.map(compact),
            display: result.items.map(displayLine),
          });
        } catch (error) {
          return guidedError(`No pude leer la bitácora: ${describeError(error)}`);
        }
      },
    },

    {
      name: 'create_reminder',
      version: '1',
      domain: 'reminders',
      description:
        'Crea un recordatorio en la bitácora PERSONAL del usuario actual ("recuérdame…"). Puede vincularse a un producto, orden, cliente o proveedor (busca primero su ID con la herramienta del dominio) o a una métrica. Confirma al usuario con la línea `display`.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Qué recordar (máx. 200 caracteres).' },
          note: { type: 'string', description: 'Nota corta opcional (máx. 500).' },
          remind_at: { type: 'string', description: REMIND_AT_HELP },
          ...LINK_PROPERTIES,
        },
        required: ['title'],
      },
      handler: async (args, context) => {
        const actor = actorOf(context);
        if (!actor) return NO_CONTEXT;
        const parsed = validated(CreateReminderDto, pick(args, CREATE_KEYS));
        if (!parsed.ok) return guidedError(parsed.message);
        try {
          const created = await remindersService.create(actor, parsed.dto, 'vex');
          return JSON.stringify({
            created: compact(created),
            display: displayLine(created),
          });
        } catch (error) {
          return guidedError(
            `No pude crear el recordatorio: ${describeError(error)}`,
            'Revisa remind_at (YYYY-MM-DDTHH:mm) y que el dato vinculado exista en la tienda.',
          );
        }
      },
    },

    {
      name: 'update_reminder',
      version: '1',
      domain: 'reminders',
      description:
        'Edita un recordatorio del usuario actual: título, nota, fecha (remind_at, null la quita), estado (pending/done) o vínculo (link_type null lo quita). Resuelve reminder_id con list_reminders.',
      parameters: {
        type: 'object',
        properties: {
          reminder_id: { type: 'number', description: 'ID del recordatorio (de list_reminders).' },
          title: { type: 'string', description: 'Nuevo título.' },
          note: { type: 'string', description: 'Nueva nota.' },
          remind_at: { type: 'string', description: REMIND_AT_HELP },
          status: { type: 'string', enum: ['pending', 'done'], description: 'pending o done.' },
          ...LINK_PROPERTIES,
        },
        required: ['reminder_id'],
      },
      handler: async (args, context) => {
        const actor = actorOf(context);
        if (!actor) return NO_CONTEXT;
        const id = toPositiveInt(args.reminder_id);
        if (!id) return guidedError('reminder_id es obligatorio.', 'Búscalo con list_reminders.');
        const parsed = validated(UpdateReminderDto, pick(args, UPDATE_KEYS));
        if (!parsed.ok) return guidedError(parsed.message);
        try {
          const updated = await remindersService.update(actor, id, parsed.dto);
          return JSON.stringify({ updated: compact(updated), display: displayLine(updated) });
        } catch (error) {
          return guidedError(
            `No pude editar el recordatorio: ${describeError(error)}`,
            'Confirma el reminder_id con list_reminders.',
          );
        }
      },
    },

    {
      name: 'complete_reminder',
      version: '1',
      domain: 'reminders',
      description:
        'Marca como hecho un recordatorio del usuario actual (done=false lo vuelve a pendiente). Resuelve reminder_id con list_reminders.',
      parameters: {
        type: 'object',
        properties: {
          reminder_id: { type: 'number', description: 'ID del recordatorio.' },
          done: { type: 'boolean', description: 'true (por defecto) = hecho; false = reabrir.' },
        },
        required: ['reminder_id'],
      },
      handler: async (args, context) => {
        const actor = actorOf(context);
        if (!actor) return NO_CONTEXT;
        const id = toPositiveInt(args.reminder_id);
        if (!id) return guidedError('reminder_id es obligatorio.', 'Búscalo con list_reminders.');
        try {
          const updated = await remindersService.update(actor, id, {
            status: args.done === false ? 'pending' : 'done',
          });
          return JSON.stringify({ updated: compact(updated), display: displayLine(updated) });
        } catch (error) {
          return guidedError(
            `No pude actualizar el recordatorio: ${describeError(error)}`,
            'Confirma el reminder_id con list_reminders.',
          );
        }
      },
    },

    {
      name: 'delete_reminder',
      version: '1',
      domain: 'reminders',
      description:
        'Elimina un recordatorio del usuario actual. Pide confirmación al usuario antes de borrar. Resuelve reminder_id con list_reminders.',
      parameters: {
        type: 'object',
        properties: {
          reminder_id: { type: 'number', description: 'ID del recordatorio a eliminar.' },
        },
        required: ['reminder_id'],
      },
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context): Promise<ToolPreview> => {
        const actor = actorOf(context);
        const id = toPositiveInt(args.reminder_id);
        const fail = (message: string): ToolPreview => ({
          status: 'error',
          target: 'Bitácora',
          changes: [],
          message,
          domain: 'reminders',
        });
        if (!actor) return fail('Sin usuario y tienda en contexto.');
        if (!id) return fail('reminder_id es obligatorio; búscalo con list_reminders.');
        try {
          const current = await remindersService.findOne(actor, id);
          return {
            status: 'warning',
            target: `Eliminar recordatorio — "${current.title}"`,
            changes: [
              {
                field: 'reminder',
                label: current.title,
                from: current.remind_at_local ?? 'sin fecha',
                to: 'eliminado',
              },
            ],
            message: 'No se puede deshacer.',
            domain: 'reminders',
          };
        } catch (error) {
          return fail(`No encontré ese recordatorio en tu bitácora: ${describeError(error)}`);
        }
      },
      handler: async (args, context) => {
        const actor = actorOf(context);
        if (!actor) return NO_CONTEXT;
        const id = toPositiveInt(args.reminder_id);
        if (!id) return guidedError('reminder_id es obligatorio.');
        try {
          const removed = await remindersService.remove(actor, id);
          return JSON.stringify({ deleted: removed, display: `🗑️ Eliminado: ${removed.title}` });
        } catch (error) {
          return guidedError(`No pude eliminar el recordatorio: ${describeError(error)}`);
        }
      },
    },
  ];
}
