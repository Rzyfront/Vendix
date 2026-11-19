import { AuditService } from '../../../common/audit/audit.service';
import { CustomersService } from '../../../domains/store/customers/customers.service';
import { CrmCampaignsService } from '../../../domains/store/customers/crm/campaigns/crm-campaigns.service';
import {
  CreateCrmCampaignDto,
  CrmCampaignsQueryDto,
} from '../../../domains/store/customers/crm/campaigns/dto/crm-campaigns.dto';
import { CrmSegmentsService } from '../../../domains/store/customers/crm/segments/crm-segments.service';
import { CrmTasksService } from '../../../domains/store/customers/crm/tasks/crm-tasks.service';
import {
  CreateCrmTaskDto,
  CrmTasksQueryDto,
} from '../../../domains/store/customers/crm/tasks/dto/crm-tasks.dto';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import {
  CRM_PERMISSIONS,
  CRM_TOOL_DOMAIN,
  cleanString,
  crmPreviewError,
  crmToolError,
  crmToolFailure,
  crmToolSuccess,
  describeError,
  requireStoreId,
  resolveCustomerLabels,
  toPositiveInt,
  toValidatedDto,
} from './crm-tools.shared';

/**
 * CRM tasks and campaigns for Vex and Vexi (QUI-1042, S6 tasks + S7).
 *
 * Every tool calls the service that owns the rule. `CrmTasksService` keeps the
 * seller visibility; `CrmCampaignsService.send` re-checks cost, status,
 * channel and limits and writes its own audit row, so this file adds no audit.
 */
export interface CrmTaskCampaignToolDeps {
  crmTasksService: CrmTasksService;
  crmCampaignsService: CrmCampaignsService;
  crmSegmentsService: CrmSegmentsService;
  customersService: CustomersService;
  auditService: AuditService;
}

/**
 * Same tolerance as `COST_TOLERANCE` in `crm-campaigns.service.ts` (not
 * exported there): estimates are compared at the 4 decimals of the spend
 * counter.
 */
const COST_TOLERANCE = 0.00005;

const MAX_LIST_ROWS = 25;

type Plain = Record<string, unknown>;

interface PersonLike {
  first_name?: string | null;
  last_name?: string | null;
}

function personName(person: PersonLike | null | undefined): string | null {
  if (!person) return null;
  return (
    [person.first_name, person.last_name].filter(Boolean).join(' ').trim() ||
    null
  );
}

function pick(args: Plain, keys: string[]): Plain {
  const out: Plain = {};
  for (const key of keys) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return out;
}

function money(value: number): string {
  return `US$ ${Number(value).toFixed(4)}`;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

interface TaskView {
  id: number;
  title: string;
  status: string;
  due_at: Date | string | null;
  is_overdue?: boolean;
  customer?: PersonLike | null;
  assigned_user?: PersonLike | null;
}

function compactTask(task: TaskView) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    due_at: isoOrNull(task.due_at),
    is_overdue: task.is_overdue ?? false,
    customer: personName(task.customer),
    assigned_to: personName(task.assigned_user),
  };
}

interface CampaignView {
  id: number;
  name: string;
  channel: string;
  status: string;
  segment_id?: number | null;
  segment?: { id: number; name: string } | null;
  scheduled_at?: Date | string | null;
  recipients_total?: number | null;
  recipients_sent?: number | null;
  recipients_failed?: number | null;
  estimated_cost?: number | null;
  metrics?: unknown;
}

function compactCampaign(campaign: CampaignView) {
  return {
    id: campaign.id,
    name: campaign.name,
    channel: campaign.channel,
    status: campaign.status,
    segment: campaign.segment?.name ?? null,
    segment_id: campaign.segment_id ?? null,
    scheduled_at: isoOrNull(campaign.scheduled_at),
    recipients_total: campaign.recipients_total ?? 0,
    recipients_sent: campaign.recipients_sent ?? 0,
    recipients_failed: campaign.recipients_failed ?? 0,
    estimated_cost: campaign.estimated_cost ?? null,
  };
}

/** Readable refusal text for a preview card (keeps the domain error code). */
function failureText(action: string, error: unknown): string {
  const { code, message } = describeError(error);
  return `No se pudo ${action}${code ? ` (${code})` : ''}: ${message}`;
}

function nextStepForRefusal(): string {
  return 'Si es un tema de permisos o de visibilidad, díselo a la persona tal cual; no insistas con otros ids.';
}

export function createCrmTaskCampaignTools(
  deps: CrmTaskCampaignToolDeps,
): RegisteredTool[] {
  const {
    crmTasksService,
    crmCampaignsService,
    crmSegmentsService,
    customersService,
  } = deps;

  // ─── Tasks ──────────────────────────────────────────────────────────

  function validateTaskArgs(
    args: Plain,
  ): { ok: true; dto: CreateCrmTaskDto } | { ok: false; message: string } {
    return toValidatedDto(
      CreateCrmTaskDto,
      pick(args, [
        'title',
        'description',
        'due_at',
        'customer_id',
        'opportunity_id',
        'assigned_user_id',
      ]),
    );
  }

  async function customerLabelFor(
    storeId: number,
    customerId: number | undefined,
  ): Promise<
    { ok: true; label: string | null } | { ok: false; message: string }
  > {
    if (!customerId) return { ok: true, label: null };
    const { labels, missing } = await resolveCustomerLabels(
      customersService,
      storeId,
      [customerId],
    );
    if (missing.length) {
      return {
        ok: false,
        message: `El cliente ${customerId} no existe en esta tienda. Búscalo con find_customer.`,
      };
    }
    return { ok: true, label: labels.get(customerId) ?? null };
  }

  const listCrmTasks: RegisteredTool = {
    name: 'list_crm_tasks',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Lista las tareas del CRM (llamadas, seguimientos, recordatorios). Úsala para «qué tareas tengo», «tareas vencidas de hoy» o «tareas pendientes de un cliente». Por defecto muestra las asignadas a quien pregunta; un vendedor solo ve las suyas. Si filtras por cliente, obtén antes el customer_id con find_customer.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: {
          type: 'number',
          description: 'Id del cliente (de find_customer).',
        },
        status: {
          type: 'string',
          enum: ['pending', 'done', 'cancelled'],
          description: 'Estado de la tarea.',
        },
        due: {
          type: 'string',
          enum: ['overdue', 'today', 'week'],
          description: 'Vencidas, de hoy o de esta semana (hora de la tienda).',
        },
        assigned: {
          type: 'string',
          description:
            '«me» (default), «unassigned», «all» o el id numérico de un usuario.',
        },
        page: { type: 'number', description: 'Página (default 1).' },
        limit: {
          type: 'number',
          description: 'Filas por página (máx. 100, default 20).',
        },
      },
    },
    readOnly: true,
    requiredPermissions: [CRM_PERMISSIONS.TASKS_MANAGE],
    discovery: {
      synonyms: [
        'tareas',
        'pendientes',
        'seguimientos',
        'recordatorios',
        'tareas vencidas',
      ],
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const checked = toValidatedDto(
        CrmTasksQueryDto,
        pick(args, [
          'customer_id',
          'status',
          'due',
          'assigned',
          'page',
          'limit',
        ]),
      );
      if (!checked.ok) return crmToolError(checked.message);
      try {
        const result = await crmTasksService.list(checked.dto);
        return crmToolSuccess(
          `${result.total} tarea(s) con ese filtro.`,
          {
            total: result.total,
            page: result.page,
            limit: result.limit,
            tasks: result.data.map(compactTask),
          },
          result.total > result.page * result.limit
            ? 'Hay más tareas: pide la página siguiente con page.'
            : undefined,
        );
      } catch (error) {
        return crmToolFailure('listar las tareas', error, nextStepForRefusal());
      }
    },
  };

  const createCrmTask: RegisteredTool = {
    name: 'create_crm_task',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Crea una tarea de CRM (llamar, hacer seguimiento, recordar algo) opcionalmente ligada a un cliente u oportunidad. Úsala para «recuérdame llamar a Ana el viernes». Si hay cliente, obtén antes su customer_id con find_customer. Convierte fechas habladas («el viernes a las 3») a ISO 8601 en la zona horaria de la tienda (ej. 2026-11-20T15:00:00-05:00). Sin assigned_user_id queda asignada a quien la pide; un vendedor solo puede asignársela a sí mismo.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Título corto de la tarea (máx. 200).',
        },
        description: { type: 'string', description: 'Detalle opcional.' },
        due_at: {
          type: 'string',
          description: 'Fecha límite ISO 8601 con zona horaria de la tienda.',
        },
        customer_id: {
          type: 'number',
          description: 'Cliente ligado (de find_customer).',
        },
        opportunity_id: {
          type: 'number',
          description: 'Oportunidad ligada (de list_crm_opportunities).',
        },
        assigned_user_id: {
          type: ['number', 'null'],
          description:
            'Responsable. Omítelo para asignarla a quien pide; null la deja sin asignar.',
        },
      },
      required: ['title'],
    },
    requiredPermissions: [CRM_PERMISSIONS.TASKS_MANAGE],
    requiresConfirmation: true,
    discovery: {
      synonyms: [
        'crear tarea',
        'recordatorio',
        'agendar seguimiento',
        'recuérdame',
        'pendiente para cliente',
      ],
    },
    preview: async (args, context): Promise<ToolPreview> => {
      const target = cleanString(args.title) ?? 'Tarea';
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(target, store.message);
      const checked = validateTaskArgs(args);
      if (!checked.ok) return crmPreviewError(target, checked.message);
      const { dto } = checked;
      try {
        const customer = await customerLabelFor(store.storeId, dto.customer_id);
        if (!customer.ok) return crmPreviewError(dto.title, customer.message);
        const assignee =
          dto.assigned_user_id === undefined
            ? 'Tú (quien la pide)'
            : dto.assigned_user_id === null
              ? 'Sin asignar'
              : `Usuario #${dto.assigned_user_id}`;
        return {
          status: 'ok',
          target: dto.title,
          changes: [
            { field: 'title', label: 'Tarea', from: null, to: dto.title },
            {
              field: 'customer',
              label: 'Cliente',
              from: null,
              to: customer.label ?? 'Sin cliente',
            },
            {
              field: 'due_at',
              label: 'Vence',
              from: null,
              to: dto.due_at ?? 'Sin fecha',
            },
            {
              field: 'assigned_user',
              label: 'Responsable',
              from: null,
              to: assignee,
            },
          ],
          message: 'Se creará una tarea pendiente.',
          domain: CRM_TOOL_DOMAIN,
        };
      } catch (error) {
        return crmPreviewError(
          dto.title,
          failureText('preparar la tarea', error),
        );
      }
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const checked = validateTaskArgs(args);
      if (!checked.ok) return crmToolError(checked.message);
      try {
        // Re-verify: the customer must still belong to this store.
        const customer = await customerLabelFor(
          store.storeId,
          checked.dto.customer_id,
        );
        if (!customer.ok) return crmToolError(customer.message);
        const task = await crmTasksService.create(checked.dto);
        return crmToolSuccess(
          `Tarea «${task.title}» creada${customer.label ? ` para ${customer.label}` : ''}.`,
          { task: compactTask(task) },
        );
      } catch (error) {
        return crmToolFailure('crear la tarea', error, nextStepForRefusal());
      }
    },
  };

  const completeCrmTask: RegisteredTool = {
    name: 'complete_crm_task',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Marca como hecha una tarea pendiente del CRM. Úsala para «ya llamé a Ana, cierra esa tarea». Obtén antes el task_id con list_crm_tasks.',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'number',
          description: 'Id de la tarea (de list_crm_tasks).',
        },
      },
      required: ['task_id'],
    },
    requiredPermissions: [CRM_PERMISSIONS.TASKS_MANAGE],
    requiresConfirmation: true,
    discovery: {
      synonyms: [
        'completar tarea',
        'cerrar tarea',
        'marcar hecha',
        'tarea lista',
      ],
    },
    preview: async (args, context): Promise<ToolPreview> => {
      const taskId = toPositiveInt(args.task_id);
      const fallback = `Tarea ${String(args.task_id ?? '')}`.trim();
      if (!taskId)
        return crmPreviewError(
          fallback,
          'task_id debe ser un id de tarea válido. Obtenlo con list_crm_tasks.',
        );
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(fallback, store.message);
      try {
        const task = await crmTasksService.findOne(taskId);
        if (task.status !== 'pending') {
          return crmPreviewError(
            task.title,
            `La tarea ya está ${task.status === 'done' ? 'hecha' : 'cancelada'}; no hay nada que completar.`,
          );
        }
        return {
          status: 'ok',
          target: task.title,
          changes: [
            { field: 'status', label: 'Estado', from: 'pending', to: 'done' },
            {
              field: 'customer',
              label: 'Cliente',
              from: null,
              to: personName(task.customer) ?? 'Sin cliente',
            },
          ],
          message: 'La tarea pasará de pendiente a hecha.',
          domain: CRM_TOOL_DOMAIN,
        };
      } catch (error) {
        return crmPreviewError(fallback, failureText('leer la tarea', error));
      }
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const taskId = toPositiveInt(args.task_id);
      if (!taskId)
        return crmToolError(
          'task_id debe ser un id de tarea válido.',
          'Obtén el id con list_crm_tasks.',
        );
      try {
        const current = await crmTasksService.findOne(taskId);
        if (current.status !== 'pending') {
          return crmToolError(
            `La tarea «${current.title}» ya está ${current.status === 'done' ? 'hecha' : 'cancelada'}.`,
          );
        }
        const task = await crmTasksService.complete(taskId);
        return crmToolSuccess(`Tarea «${task.title}» marcada como hecha.`, {
          task: compactTask(task),
        });
      } catch (error) {
        return crmToolFailure(
          'completar la tarea',
          error,
          nextStepForRefusal(),
        );
      }
    },
  };

  // ─── Campaigns ──────────────────────────────────────────────────────

  const listCrmCampaigns: RegisteredTool = {
    name: 'list_crm_campaigns',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Consulta las campañas de mensajería (WhatsApp, SMS, correo). Sin campaign_id lista las más recientes con estado, canal y segmento; con campaign_id devuelve el detalle y las métricas de entrega. Úsala antes de send_crm_campaign para conocer el id de un borrador.',
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'number',
          description: 'Id de una campaña para ver su detalle.',
        },
        page: { type: 'number', description: 'Página (default 1).' },
        limit: {
          type: 'number',
          description: 'Filas por página (máx. 100, default 25).',
        },
      },
    },
    readOnly: true,
    requiredPermissions: [CRM_PERMISSIONS.CAMPAIGNS_SEND],
    discovery: {
      synonyms: [
        'campañas',
        'envíos masivos',
        'mensajes masivos',
        'borradores de campaña',
        'campaña de whatsapp',
      ],
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      try {
        if (args.campaign_id !== undefined && args.campaign_id !== null) {
          const id = toPositiveInt(args.campaign_id);
          if (!id)
            return crmToolError(
              'campaign_id debe ser un id de campaña válido.',
              'Lista las campañas sin campaign_id para ver los ids.',
            );
          const campaign = await crmCampaignsService.get(id);
          return crmToolSuccess(
            `Campaña «${campaign.name}»: ${campaign.status}.`,
            {
              campaign: {
                ...compactCampaign(campaign),
                metrics: campaign.metrics,
              },
            },
          );
        }
        const checked = toValidatedDto(
          CrmCampaignsQueryDto,
          pick(args, ['page', 'limit']),
        );
        if (!checked.ok) return crmToolError(checked.message);
        const result = await crmCampaignsService.list(checked.dto);
        return crmToolSuccess(`${result.total} campaña(s).`, {
          total: result.total,
          page: result.page,
          limit: result.limit,
          campaigns: result.data
            .slice(0, MAX_LIST_ROWS * 4)
            .map(compactCampaign),
        });
      } catch (error) {
        return crmToolFailure(
          'consultar las campañas',
          error,
          nextStepForRefusal(),
        );
      }
    },
  };

  function validateDraftArgs(
    args: Plain,
  ): { ok: true; dto: CreateCrmCampaignDto } | { ok: false; message: string } {
    return toValidatedDto(
      CreateCrmCampaignDto,
      pick(args, [
        'name',
        'segment_id',
        'channel',
        'body',
        'subject',
        'template',
        'scheduled_at',
      ]),
    );
  }

  const createCrmCampaignDraft: RegisteredTool = {
    name: 'create_crm_campaign_draft',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Prepara una campaña masiva como BORRADOR sobre un segmento: no envía nada. Úsala para «prepara una campaña de WhatsApp para los VIP». Obtén antes el segment_id con list_crm_segments. WhatsApp solo admite plantilla aprobada (template); SMS necesita body; correo necesita subject y body. Marcadores permitidos: {first_name}, {last_name}, {store_name}. Devuelve el costo estimado; el envío real es send_crm_campaign.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Nombre interno de la campaña (máx. 120).',
        },
        segment_id: {
          type: 'number',
          description: 'Segmento destino (de list_crm_segments).',
        },
        channel: { type: 'string', enum: ['whatsapp', 'sms', 'email'] },
        body: { type: 'string', description: 'Texto de SMS o correo.' },
        subject: { type: 'string', description: 'Asunto (solo correo).' },
        template: {
          type: 'object',
          description: 'Plantilla aprobada en Meta (solo WhatsApp).',
          properties: {
            name: { type: 'string' },
            language: { type: 'string', description: 'Ej. es_CO.' },
            variables: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'language'],
        },
        scheduled_at: {
          type: 'string',
          description:
            'Fecha futura ISO 8601 para programarla; omítela para enviar al aprobar el envío.',
        },
      },
      required: ['name', 'segment_id', 'channel'],
    },
    requiredPermissions: [CRM_PERMISSIONS.CAMPAIGNS_SEND],
    requiresConfirmation: true,
    discovery: {
      synonyms: [
        'crear campaña',
        'borrador de campaña',
        'mensaje masivo',
        'campaña de marketing',
        'promoción por whatsapp',
      ],
    },
    preview: async (args, context): Promise<ToolPreview> => {
      const target = cleanString(args.name) ?? 'Campaña';
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(target, store.message);
      const checked = validateDraftArgs(args);
      if (!checked.ok) return crmPreviewError(target, checked.message);
      const { dto } = checked;
      try {
        const segment = await crmSegmentsService.get(dto.segment_id);
        const estimate = await crmCampaignsService.estimate(dto);
        const changes: ToolPreview['changes'] = [
          { field: 'segment', label: 'Segmento', from: null, to: segment.name },
          { field: 'channel', label: 'Canal', from: null, to: dto.channel },
          {
            field: 'recipients',
            label: 'Destinatarios',
            from: null,
            to: estimate.recipients,
          },
          {
            field: 'estimated_cost',
            label: 'Costo estimado',
            from: null,
            to: money(estimate.estimated_cost),
          },
        ];
        if (dto.scheduled_at) {
          changes.push({
            field: 'scheduled_at',
            label: 'Programada para',
            from: null,
            to: dto.scheduled_at,
          });
        }
        const warnings: string[] = [];
        if (estimate.recipients === 0) {
          warnings.push(
            'El segmento no tiene destinatarios elegibles (consentimiento o dato de contacto).',
          );
        }
        if (estimate.exceeds_max_recipients) {
          warnings.push(
            `Supera el máximo de ${estimate.max_recipients} destinatarios por campaña.`,
          );
        }
        return {
          status: warnings.length ? 'warning' : 'ok',
          target: dto.name,
          changes,
          message: [
            'Queda en BORRADOR: no se envía nada hasta que apruebes send_crm_campaign.',
            ...warnings,
          ].join(' '),
          domain: CRM_TOOL_DOMAIN,
        };
      } catch (error) {
        return crmPreviewError(
          dto.name,
          failureText('preparar la campaña', error),
        );
      }
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const checked = validateDraftArgs(args);
      if (!checked.ok) return crmToolError(checked.message);
      try {
        const created = await crmCampaignsService.create(checked.dto);
        const { estimate } = created;
        return crmToolSuccess(
          `Borrador «${created.name}» creado: ${estimate.recipients} destinatario(s), costo estimado ${money(estimate.estimated_cost)}. No se ha enviado nada.`,
          {
            campaign_id: created.id,
            name: created.name,
            status: created.status,
            channel: created.channel,
            recipients: estimate.recipients,
            estimated_cost: estimate.estimated_cost,
            currency: estimate.currency,
          },
          `Para enviarla, pide aprobación y llama send_crm_campaign con campaign_id=${created.id} y confirm_estimated_cost=${estimate.estimated_cost}.`,
        );
      } catch (error) {
        return crmToolFailure(
          'crear el borrador de la campaña',
          error,
          nextStepForRefusal(),
        );
      }
    },
  };

  function parseSendArgs(
    args: Plain,
  ): { ok: true; id: number; cost: number } | { ok: false; message: string } {
    const id = toPositiveInt(args.campaign_id);
    if (!id)
      return {
        ok: false,
        message:
          'campaign_id debe ser un id de campaña válido. Obtenlo con list_crm_campaigns.',
      };
    const raw = args.confirm_estimated_cost;
    const cost =
      typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
    if (
      raw === undefined ||
      raw === null ||
      !Number.isFinite(cost) ||
      cost < 0
    ) {
      return {
        ok: false,
        message:
          'confirm_estimated_cost es obligatorio: el costo estimado exacto (USD) que la persona vio en el borrador.',
      };
    }
    return { ok: true, id, cost };
  }

  const sendCrmCampaign: RegisteredTool = {
    name: 'send_crm_campaign',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'ENVÍA (o programa) un borrador de campaña a todo su segmento. Irreversible: los mensajes ya entregados no se pueden retirar. Úsala solo cuando la persona pidió enviar, con el campaign_id de create_crm_campaign_draft o list_crm_campaigns y el costo estimado vigente en confirm_estimated_cost. Si el costo cambió, vuelve a leerlo (list_crm_campaigns) antes de reintentar.',
    parameters: {
      type: 'object',
      properties: {
        campaign_id: { type: 'number', description: 'Id del borrador.' },
        confirm_estimated_cost: {
          type: 'number',
          description:
            'Costo estimado en USD que la persona aprobó; debe coincidir con la estimación actual.',
        },
      },
      required: ['campaign_id', 'confirm_estimated_cost'],
    },
    requiredPermissions: [CRM_PERMISSIONS.CAMPAIGNS_SEND],
    requiresConfirmation: true,
    irreversible: true,
    discovery: {
      synonyms: [
        'enviar campaña',
        'lanzar campaña',
        'disparar mensajes',
        'mandar la campaña',
        'programar campaña',
      ],
    },
    preview: async (args, context): Promise<ToolPreview> => {
      const fallback = `Campaña ${String(args.campaign_id ?? '')}`.trim();
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(fallback, store.message);
      const parsed = parseSendArgs(args);
      if (!parsed.ok) return crmPreviewError(fallback, parsed.message);
      try {
        const campaign = await crmCampaignsService.get(parsed.id);
        if (campaign.status !== 'draft') {
          return crmPreviewError(
            campaign.name,
            `La campaña ya no es un borrador (estado: ${campaign.status}); no se puede enviar de nuevo.`,
          );
        }
        const estimate = await crmCampaignsService.estimateSaved(parsed.id);
        if (Math.abs(estimate.estimated_cost - parsed.cost) > COST_TOLERANCE) {
          return crmPreviewError(
            campaign.name,
            `El costo estimado actual es ${money(estimate.estimated_cost)} y no coincide con el confirmado (${money(parsed.cost)}). Vuelve a leer el costo con list_crm_campaigns y pide la aprobación de nuevo.`,
          );
        }
        if (estimate.recipients === 0 || estimate.exceeds_max_recipients) {
          return crmPreviewError(
            campaign.name,
            estimate.recipients === 0
              ? 'No hay destinatarios elegibles: nada que enviar.'
              : `Supera el máximo de ${estimate.max_recipients} destinatarios por campaña.`,
          );
        }
        if (estimate.exceeds_spend_limit) {
          return crmPreviewError(
            campaign.name,
            'El costo supera el tope mensual de gasto en SMS de la tienda.',
          );
        }
        const scheduledAt = isoOrNull(campaign.scheduled_at);
        return {
          status: 'warning',
          target: campaign.name,
          changes: [
            {
              field: 'status',
              label: 'Estado',
              from: 'draft',
              to: scheduledAt ? 'scheduled' : 'sending',
            },
            {
              field: 'channel',
              label: 'Canal',
              from: null,
              to: campaign.channel,
            },
            {
              field: 'segment',
              label: 'Segmento',
              from: null,
              to: campaign.segment?.name ?? 'Sin segmento',
            },
            {
              field: 'recipients',
              label: 'Destinatarios',
              from: null,
              to: estimate.recipients,
            },
            {
              field: 'estimated_cost',
              label: 'Costo estimado',
              from: null,
              to: money(estimate.estimated_cost),
            },
          ],
          message: [
            scheduledAt
              ? `Se PROGRAMARÁ para ${scheduledAt}; no sale ahora.`
              : 'Se enviará AHORA a todos los destinatarios.',
            'Irreversible: los mensajes ya entregados no se pueden retirar.',
          ].join(' '),
          domain: CRM_TOOL_DOMAIN,
        };
      } catch (error) {
        return crmPreviewError(
          fallback,
          failureText('preparar el envío', error),
        );
      }
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const parsed = parseSendArgs(args);
      if (!parsed.ok) return crmToolError(parsed.message);
      try {
        // The service re-checks cost, status, channel and limits, and audits.
        const sent = await crmCampaignsService.send(parsed.id, parsed.cost);
        const scheduled = sent.status === 'scheduled';
        return crmToolSuccess(
          scheduled
            ? `Campaña «${sent.name}» programada para ${isoOrNull(sent.scheduled_at)}.`
            : `Campaña «${sent.name}» en envío a ${sent.recipients_total ?? 0} destinatario(s).`,
          { campaign: { ...compactCampaign(sent), metrics: sent.metrics } },
          scheduled
            ? undefined
            : 'Consulta el avance con list_crm_campaigns (campaign_id).',
        );
      } catch (error) {
        return crmToolFailure(
          'enviar la campaña',
          error,
          'Si el costo cambió, vuelve a leerlo con list_crm_campaigns y pide la aprobación otra vez.',
        );
      }
    },
  };

  return [
    listCrmTasks,
    createCrmTask,
    completeCrmTask,
    listCrmCampaigns,
    createCrmCampaignDraft,
    sendCrmCampaign,
  ];
}
