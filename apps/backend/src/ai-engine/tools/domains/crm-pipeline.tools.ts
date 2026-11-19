import { AuditService } from '../../../common/audit/audit.service';
import { CustomersService } from '../../../domains/store/customers/customers.service';
import { CrmPipelineService } from '../../../domains/store/customers/crm/pipeline/crm-pipeline.service';
import {
  CreateCrmOpportunityDto,
  CrmOpportunitiesQueryDto,
  LoseCrmOpportunityDto,
  MoveCrmOpportunityDto,
} from '../../../domains/store/customers/crm/pipeline/dto/crm-pipeline.dto';
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
 * CRM pipeline tools (QUI-1042 · S5): consult the funnel, list, create, move
 * and close opportunities. Every tool calls `CrmPipelineService`, which owns
 * the store scope and the seller visibility (`crm-access`): a seller only
 * sees and moves their own opportunities and the CRM_* refusals surface as is.
 */
export interface CrmPipelineToolDeps {
  crmPipelineService: CrmPipelineService;
  customersService: CustomersService;
  auditService: AuditService;
}

/** Rows a list answer returns at most (the service has no pagination). */
const LIST_DEFAULT_LIMIT = 25;
const LIST_MAX_LIMIT = 50;

interface PersonLike {
  first_name?: string | null;
  last_name?: string | null;
}

interface StageLike {
  id: number;
  pipeline_id?: number;
  name: string;
  kind: string;
  probability?: number | null;
  is_active?: boolean;
}

interface OpportunityLike {
  id: number;
  title: string;
  amount: string | null;
  currency: string | null;
  status: string;
  pipeline_id: number;
  stage_id: number;
  stage?: StageLike | null;
  customer?: PersonLike | null;
  owner?: PersonLike | null;
  expected_close_date: string | null;
  lost_reason?: string | null;
}

interface PipelineLike {
  id: number;
  name: string;
  is_default: boolean;
  stages: StageLike[];
}

function personName(person?: PersonLike | null): string | null {
  if (!person) return null;
  const name = [person.first_name, person.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || null;
}

function money(amount: unknown, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') {
    return 'sin monto';
  }
  return `${amount}${currency ? ` ${currency}` : ''}`;
}

function compactOpportunity(row: OpportunityLike) {
  return {
    id: row.id,
    title: row.title,
    customer: personName(row.customer),
    amount: row.amount,
    currency: row.currency,
    stage_id: row.stage_id,
    stage: row.stage?.name ?? null,
    status: row.status,
    owner: personName(row.owner),
    expected_close_date: row.expected_close_date,
  };
}

function findStageIn(
  pipelines: PipelineLike[],
  stageId: number,
): StageLike | undefined {
  for (const pipeline of pipelines) {
    const stage = pipeline.stages.find((row) => row.id === stageId);
    if (stage) return stage;
  }
  return undefined;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'abierta',
  won: 'ganada',
  lost: 'perdida',
};

const OPPORTUNITY_NEXT_STEP =
  'Usa list_crm_opportunities para obtener el id de la oportunidad.';

export function createCrmPipelineTools(
  deps: CrmPipelineToolDeps,
): RegisteredTool[] {
  const { crmPipelineService, customersService } = deps;

  /** Opportunity id arg, or a readable refusal. */
  function readOpportunityId(
    args: Record<string, any>,
  ): { ok: true; id: number } | { ok: false; message: string } {
    const id = toPositiveInt(args.opportunity_id);
    if (!id) {
      return {
        ok: false,
        message: 'Falta opportunity_id: indica la oportunidad por su id.',
      };
    }
    return { ok: true, id };
  }

  // ───────────── get_crm_pipeline ─────────────
  const getCrmPipeline: RegisteredTool = {
    name: 'get_crm_pipeline',
    domain: CRM_TOOL_DOMAIN,
    version: '1',
    description:
      'Consulta el embudo de ventas (pipeline) del CRM: etapas con su tipo (abierta/ganada/perdida) y probabilidad, y por etapa cuántas oportunidades hay y su monto total. Úsalo para "cómo va el embudo" o "cuántas oportunidades hay en negociación". Para ver las oportunidades una por una (con sus ids) usa list_crm_opportunities.',
    parameters: {
      type: 'object',
      properties: {
        pipeline_id: {
          type: 'integer',
          description:
            'Pipeline a consultar. Si se omite, el predeterminado de la tienda.',
        },
        owner: {
          type: 'string',
          description:
            '"me" para solo mis oportunidades, o el id de un vendedor.',
        },
      },
    },
    requiredPermissions: [CRM_PERMISSIONS.PIPELINE_READ],
    readOnly: true,
    discovery: {
      synonyms: [
        'embudo',
        'pipeline',
        'embudo de ventas',
        'etapas de venta',
        'oportunidades por etapa',
      ],
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const query = toValidatedDto(CrmOpportunitiesQueryDto, {
        pipeline_id: toPositiveInt(args.pipeline_id) ?? undefined,
        owner: cleanString(args.owner) ?? undefined,
      });
      if (!query.ok) return crmToolError(query.message);
      try {
        const pipelines =
          (await crmPipelineService.listPipelines()) as PipelineLike[];
        const board = await crmPipelineService.board(query.dto);
        const stages = board.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          kind: stage.kind,
          probability: stage.probability,
          opportunities_count: stage.count,
          total_amount: stage.total_amount,
        }));
        return crmToolSuccess(
          `Embudo "${board.pipeline.name}": ${stages.length} etapas.`,
          {
            pipeline: board.pipeline,
            pipelines: pipelines.map((row) => ({
              id: row.id,
              name: row.name,
              is_default: row.is_default,
              stages_count: row.stages.length,
            })),
            stages,
            truncated: board.truncated,
          },
          board.truncated
            ? 'El tablero llegó a su tope de tarjetas: los conteos y montos pueden estar incompletos (se omiten las cerradas más antiguas).'
            : undefined,
        );
      } catch (error) {
        return crmToolFailure('consultar el embudo', error);
      }
    },
  };

  // ───────────── list_crm_opportunities ─────────────
  const listCrmOpportunities: RegisteredTool = {
    name: 'list_crm_opportunities',
    domain: CRM_TOOL_DOMAIN,
    version: '1',
    description:
      'Lista oportunidades del CRM con su id, título, cliente, monto, etapa, estado, responsable y fecha de cierre esperada. Úsalo para encontrar el id de una oportunidad antes de moverla, ganarla o perderla, o para ver las oportunidades de un cliente. Filtros opcionales: customer_id (obtenlo con find_customer), status, stage_id (obtenlo con get_crm_pipeline), pipeline_id, owner, q.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer', description: 'Id del cliente.' },
        status: { type: 'string', enum: ['open', 'won', 'lost'] },
        stage_id: { type: 'integer', description: 'Id de la etapa.' },
        pipeline_id: { type: 'integer', description: 'Id del pipeline.' },
        owner: {
          type: 'string',
          description: '"me" o el id del vendedor responsable.',
        },
        q: {
          type: 'string',
          description: 'Texto del título o nombre del cliente.',
        },
        limit: {
          type: 'integer',
          description: `Máximo de filas (por defecto ${LIST_DEFAULT_LIMIT}, tope ${LIST_MAX_LIMIT}).`,
        },
      },
    },
    requiredPermissions: [CRM_PERMISSIONS.PIPELINE_READ],
    readOnly: true,
    discovery: {
      synonyms: [
        'oportunidades',
        'negocios abiertos',
        'ventas en proceso',
        'oportunidades del cliente',
        'listar oportunidades',
      ],
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const query = toValidatedDto(CrmOpportunitiesQueryDto, {
        customer_id: toPositiveInt(args.customer_id) ?? undefined,
        status: cleanString(args.status) ?? undefined,
        pipeline_id: toPositiveInt(args.pipeline_id) ?? undefined,
        owner: cleanString(args.owner) ?? undefined,
        q: cleanString(args.q) ?? undefined,
      });
      if (!query.ok) return crmToolError(query.message);
      const stageFilter = toPositiveInt(args.stage_id);
      const limit = Math.min(
        toPositiveInt(args.limit) ?? LIST_DEFAULT_LIMIT,
        LIST_MAX_LIMIT,
      );
      try {
        const board = await crmPipelineService.board(query.dto);
        const all = (board.stages as Array<{ opportunities: unknown[] }>)
          .flatMap((stage) => stage.opportunities as OpportunityLike[])
          .filter((row) => !stageFilter || row.stage_id === stageFilter);
        const rows = all.slice(0, limit).map(compactOpportunity);
        const cut = all.length > rows.length;
        return crmToolSuccess(
          `${all.length} oportunidades en el pipeline "${board.pipeline.name}"${cut ? `; se muestran ${rows.length}` : ''}.`,
          {
            pipeline: board.pipeline,
            total: all.length,
            returned: rows.length,
            opportunities: rows,
            truncated: cut || board.truncated,
          },
          cut || board.truncated
            ? 'La lista está recortada: afina con customer_id, status, stage_id o q.'
            : undefined,
        );
      } catch (error) {
        return crmToolFailure('listar las oportunidades', error);
      }
    },
  };

  // ───────────── create_crm_opportunity ─────────────
  function parseCreate(args: Record<string, any>) {
    return toValidatedDto(CreateCrmOpportunityDto, {
      customer_id: toPositiveInt(args.customer_id) ?? undefined,
      title: cleanString(args.title) ?? undefined,
      amount:
        args.amount === undefined || args.amount === null || args.amount === ''
          ? undefined
          : Number(args.amount),
      currency: cleanString(args.currency)?.toUpperCase(),
      stage_id: toPositiveInt(args.stage_id) ?? undefined,
      pipeline_id: toPositiveInt(args.pipeline_id) ?? undefined,
      owner_user_id:
        args.owner_user_id === null
          ? null
          : (toPositiveInt(args.owner_user_id) ?? undefined),
      quotation_id: toPositiveInt(args.quotation_id) ?? undefined,
      expected_close_date: cleanString(args.expected_close_date) ?? undefined,
    });
  }

  const createCrmOpportunity: RegisteredTool = {
    name: 'create_crm_opportunity',
    domain: CRM_TOOL_DOMAIN,
    version: '1',
    description:
      'Crea una oportunidad de venta para un cliente en el embudo del CRM. Úsalo cuando pidan "abre una oportunidad para Ana por $2.000.000". Antes obtén customer_id con find_customer y, si piden una etapa concreta, stage_id con get_crm_pipeline; sin etapa entra en la primera etapa abierta del pipeline. Si no se indica responsable, queda a nombre de quien la crea.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer', description: 'Id del cliente.' },
        title: { type: 'string', description: 'Título (máx. 160).' },
        amount: { type: 'number', description: 'Monto estimado.' },
        currency: {
          type: 'string',
          description: 'Moneda ISO de 3 letras, p. ej. COP.',
        },
        pipeline_id: { type: 'integer' },
        stage_id: { type: 'integer', description: 'Etapa inicial.' },
        owner_user_id: {
          type: 'integer',
          description: 'Vendedor responsable (por defecto, quien la crea).',
        },
        expected_close_date: {
          type: 'string',
          description: 'Fecha esperada de cierre, YYYY-MM-DD.',
        },
        quotation_id: {
          type: 'integer',
          description: 'Cotización del mismo cliente a vincular.',
        },
      },
      required: ['customer_id', 'title'],
    },
    requiredPermissions: [CRM_PERMISSIONS.PIPELINE_MANAGE],
    requiresConfirmation: true,
    discovery: {
      synonyms: [
        'crear oportunidad',
        'nueva oportunidad',
        'abrir negocio',
        'nueva venta en el embudo',
        'oportunidad de venta',
      ],
      dependencies: ['find_customer', 'get_crm_pipeline'],
    },
    preview: async (args, context): Promise<ToolPreview> => {
      const target = 'Nueva oportunidad';
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(target, store.message);
      const parsed = parseCreate(args);
      if (!parsed.ok) return crmPreviewError(target, parsed.message);
      const dto = parsed.dto;
      try {
        const { labels, missing } = await resolveCustomerLabels(
          customersService,
          store.storeId,
          [dto.customer_id],
        );
        if (missing.length) {
          return crmPreviewError(
            target,
            `El cliente ${dto.customer_id} no existe en esta tienda. Búscalo con find_customer.`,
          );
        }
        const pipelines =
          (await crmPipelineService.listPipelines()) as PipelineLike[];
        let stageName: string;
        if (dto.stage_id) {
          const stage = findStageIn(pipelines, dto.stage_id);
          if (!stage || stage.is_active === false) {
            return crmPreviewError(
              target,
              `La etapa ${dto.stage_id} no existe o está desactivada. Consulta las etapas con get_crm_pipeline.`,
            );
          }
          if (dto.pipeline_id && stage.pipeline_id !== dto.pipeline_id) {
            return crmPreviewError(
              target,
              'La etapa no pertenece al pipeline indicado.',
            );
          }
          if (stage.kind === 'lost') {
            return crmPreviewError(
              target,
              'Una oportunidad nueva no puede empezar en una etapa de perdida.',
            );
          }
          stageName = stage.name;
        } else {
          const pipeline = dto.pipeline_id
            ? pipelines.find((row) => row.id === dto.pipeline_id)
            : (pipelines.find((row) => row.is_default) ?? pipelines[0]);
          const stage = pipeline?.stages.find(
            (row) => row.is_active !== false && row.kind === 'open',
          );
          if (!stage) {
            return crmPreviewError(
              target,
              'No hay un pipeline con etapa abierta disponible. Consulta get_crm_pipeline.',
            );
          }
          stageName = stage.name;
        }
        const customer = labels.get(dto.customer_id) ?? String(dto.customer_id);
        const changes: ToolPreview['changes'] = [
          { field: 'customer', label: 'Cliente', from: null, to: customer },
          { field: 'title', label: 'Título', from: null, to: dto.title },
          {
            field: 'amount',
            label: 'Monto',
            from: null,
            to: money(dto.amount, dto.currency),
          },
          { field: 'stage', label: 'Etapa', from: null, to: stageName },
        ];
        if (dto.expected_close_date) {
          changes.push({
            field: 'expected_close_date',
            label: 'Cierre esperado',
            from: null,
            to: dto.expected_close_date,
          });
        }
        if (dto.owner_user_id !== undefined) {
          changes.push({
            field: 'owner_user_id',
            label: 'Responsable (id)',
            from: null,
            to: dto.owner_user_id ?? 'sin responsable',
          });
        }
        return {
          status: 'ok',
          target: `${dto.title} · ${customer}`,
          changes,
          domain: CRM_TOOL_DOMAIN,
        };
      } catch (error) {
        return crmPreviewError(target, describeError(error).message);
      }
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const parsed = parseCreate(args);
      if (!parsed.ok) return crmToolError(parsed.message);
      try {
        const created = (await crmPipelineService.create(
          parsed.dto,
        )) as OpportunityLike;
        return crmToolSuccess(
          `Oportunidad "${created.title}" creada en la etapa ${created.stage?.name ?? created.stage_id}.`,
          { opportunity: compactOpportunity(created) },
        );
      } catch (error) {
        return crmToolFailure('crear la oportunidad', error);
      }
    },
  };

  // ───────────── move_crm_opportunity ─────────────
  function parseMove(args: Record<string, any>) {
    return toValidatedDto(MoveCrmOpportunityDto, {
      stage_id: toPositiveInt(args.stage_id) ?? undefined,
      lost_reason: cleanString(args.lost_reason) ?? undefined,
    });
  }

  const moveCrmOpportunity: RegisteredTool = {
    name: 'move_crm_opportunity',
    domain: CRM_TOOL_DOMAIN,
    version: '1',
    description:
      'Mueve una oportunidad a otra etapa de su mismo pipeline. Úsalo para "pasa la oportunidad de Ana a negociación". Antes obtén opportunity_id con list_crm_opportunities y stage_id con get_crm_pipeline. Mover a una etapa de ganada o perdida la cierra (la perdida exige lost_reason); mover una cerrada a una etapa abierta la reabre. Para cerrar sin elegir etapa usa set_crm_opportunity_result.',
    parameters: {
      type: 'object',
      properties: {
        opportunity_id: {
          type: 'integer',
          description: 'Id de la oportunidad.',
        },
        stage_id: { type: 'integer', description: 'Etapa destino.' },
        lost_reason: {
          type: 'string',
          description: 'Motivo, solo si la etapa destino es de perdida.',
        },
      },
      required: ['opportunity_id', 'stage_id'],
    },
    requiredPermissions: [CRM_PERMISSIONS.PIPELINE_MANAGE],
    requiresConfirmation: true,
    discovery: {
      synonyms: [
        'mover oportunidad',
        'cambiar de etapa',
        'pasar a negociación',
        'avanzar oportunidad',
        'mover en el embudo',
      ],
      dependencies: ['list_crm_opportunities', 'get_crm_pipeline'],
    },
    preview: async (args, context): Promise<ToolPreview> => {
      const target = 'Mover oportunidad';
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(target, store.message);
      const id = readOpportunityId(args);
      if (!id.ok) return crmPreviewError(target, id.message);
      const parsed = parseMove(args);
      if (!parsed.ok) return crmPreviewError(target, parsed.message);
      try {
        const current = (await crmPipelineService.findOne(
          id.id,
        )) as OpportunityLike;
        const customer = personName(current.customer) ?? 'sin cliente';
        const label = `${current.title} · ${customer}`;
        const pipelines =
          (await crmPipelineService.listPipelines()) as PipelineLike[];
        const to = findStageIn(pipelines, parsed.dto.stage_id);
        if (!to) {
          return crmPreviewError(
            label,
            `La etapa ${parsed.dto.stage_id} no existe. Consulta las etapas con get_crm_pipeline.`,
          );
        }
        if (to.pipeline_id !== current.pipeline_id || to.is_active === false) {
          return crmPreviewError(
            label,
            `La etapa "${to.name}" no pertenece al pipeline de la oportunidad o está desactivada.`,
          );
        }
        if (to.id === current.stage_id) {
          return crmPreviewError(
            label,
            `La oportunidad ya está en la etapa "${to.name}".`,
          );
        }
        if (
          to.kind === 'lost' &&
          !parsed.dto.lost_reason &&
          !current.lost_reason
        ) {
          return crmPreviewError(
            label,
            'La etapa destino es de perdida: indica lost_reason con el motivo.',
          );
        }
        const changes: ToolPreview['changes'] = [
          {
            field: 'stage',
            label: 'Etapa',
            from: current.stage?.name ?? current.stage_id,
            to: to.name,
          },
        ];
        if (to.kind !== 'open' || current.status !== 'open') {
          changes.push({
            field: 'status',
            label: 'Estado',
            from: STATUS_LABEL[current.status] ?? current.status,
            to:
              to.kind === 'won'
                ? 'ganada'
                : to.kind === 'lost'
                  ? 'perdida'
                  : 'abierta',
          });
        }
        const reopens = current.status !== 'open' && to.kind === 'open';
        return {
          status: reopens ? 'warning' : 'ok',
          target: label,
          changes,
          ...(reopens && {
            message: `La oportunidad está ${STATUS_LABEL[current.status] ?? current.status}; al moverla a una etapa abierta se reabre.`,
          }),
          domain: CRM_TOOL_DOMAIN,
        };
      } catch (error) {
        return crmPreviewError(target, describeError(error).message);
      }
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const id = readOpportunityId(args);
      if (!id.ok) return crmToolError(id.message, OPPORTUNITY_NEXT_STEP);
      const parsed = parseMove(args);
      if (!parsed.ok) return crmToolError(parsed.message);
      try {
        // The service re-reads visibility and stage rules; the preview is only a projection.
        const moved = (await crmPipelineService.move(
          id.id,
          parsed.dto,
        )) as OpportunityLike;
        return crmToolSuccess(
          `Oportunidad "${moved.title}" movida a la etapa ${moved.stage?.name ?? moved.stage_id}.`,
          { opportunity: compactOpportunity(moved) },
        );
      } catch (error) {
        return crmToolFailure('mover la oportunidad', error);
      }
    },
  };

  // ───────────── set_crm_opportunity_result ─────────────
  function parseResult(
    args: Record<string, any>,
  ):
    | { ok: true; result: 'won' | 'lost'; lostReason?: string }
    | { ok: false; message: string } {
    const result = cleanString(args.result);
    if (result !== 'won' && result !== 'lost') {
      return {
        ok: false,
        message: 'result debe ser "won" (ganada) o "lost" (perdida).',
      };
    }
    if (result === 'won') return { ok: true, result };
    const parsed = toValidatedDto(LoseCrmOpportunityDto, {
      lost_reason: cleanString(args.lost_reason) ?? undefined,
    });
    if (!parsed.ok) {
      return {
        ok: false,
        message:
          'Para marcarla como perdida indica lost_reason con el motivo (máx. 160 caracteres).',
      };
    }
    return { ok: true, result, lostReason: parsed.dto.lost_reason.trim() };
  }

  const setCrmOpportunityResult: RegisteredTool = {
    name: 'set_crm_opportunity_result',
    domain: CRM_TOOL_DOMAIN,
    version: '1',
    description:
      'Cierra una oportunidad como ganada o perdida sin elegir etapa. Úsalo para "marca como ganada la venta de Ana" o "se perdió la oportunidad de Luis porque compró con otro". Antes obtén opportunity_id con list_crm_opportunities. Perdida exige lost_reason. Se puede reabrir moviéndola a una etapa abierta con move_crm_opportunity.',
    parameters: {
      type: 'object',
      properties: {
        opportunity_id: {
          type: 'integer',
          description: 'Id de la oportunidad.',
        },
        result: { type: 'string', enum: ['won', 'lost'] },
        lost_reason: {
          type: 'string',
          description: 'Motivo de pérdida; obligatorio si result es "lost".',
        },
      },
      required: ['opportunity_id', 'result'],
    },
    requiredPermissions: [CRM_PERMISSIONS.PIPELINE_MANAGE],
    requiresConfirmation: true,
    // A closed opportunity can be moved back to an open stage, so not irreversible.
    discovery: {
      synonyms: [
        'ganar oportunidad',
        'perder oportunidad',
        'cerrar venta',
        'marcar como ganada',
        'marcar como perdida',
      ],
      dependencies: ['list_crm_opportunities'],
    },
    preview: async (args, context): Promise<ToolPreview> => {
      const target = 'Cerrar oportunidad';
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(target, store.message);
      const id = readOpportunityId(args);
      if (!id.ok) return crmPreviewError(target, id.message);
      const parsed = parseResult(args);
      if (!parsed.ok) return crmPreviewError(target, parsed.message);
      try {
        const current = (await crmPipelineService.findOne(
          id.id,
        )) as OpportunityLike;
        const label = `${current.title} · ${personName(current.customer) ?? 'sin cliente'}`;
        if (current.status === parsed.result) {
          return crmPreviewError(
            label,
            `La oportunidad ya está ${STATUS_LABEL[current.status]}.`,
          );
        }
        const pipelines =
          (await crmPipelineService.listPipelines()) as PipelineLike[];
        const closing = pipelines
          .find((row) => row.id === current.pipeline_id)
          ?.stages.find(
            (row) => row.kind === parsed.result && row.is_active !== false,
          );
        if (!closing) {
          return crmPreviewError(
            label,
            'El pipeline no tiene una etapa activa de ganado o perdido.',
          );
        }
        const changes: ToolPreview['changes'] = [
          {
            field: 'stage',
            label: 'Etapa',
            from: current.stage?.name ?? current.stage_id,
            to: closing.name,
          },
          {
            field: 'status',
            label: 'Estado',
            from: STATUS_LABEL[current.status] ?? current.status,
            to: STATUS_LABEL[parsed.result],
          },
          {
            field: 'amount',
            label: 'Monto',
            from: money(current.amount, current.currency),
            to: money(current.amount, current.currency),
          },
        ];
        if (parsed.result === 'lost') {
          changes.push({
            field: 'lost_reason',
            label: 'Motivo de pérdida',
            from: current.lost_reason ?? null,
            to: parsed.lostReason,
          });
        }
        return {
          status: 'ok',
          target: label,
          changes,
          message: 'Se puede reabrir después moviéndola a una etapa abierta.',
          domain: CRM_TOOL_DOMAIN,
        };
      } catch (error) {
        return crmPreviewError(target, describeError(error).message);
      }
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const id = readOpportunityId(args);
      if (!id.ok) return crmToolError(id.message, OPPORTUNITY_NEXT_STEP);
      const parsed = parseResult(args);
      if (!parsed.ok) return crmToolError(parsed.message);
      try {
        // win/lose audit the status change in the service: no extra audit row.
        const closed = (
          parsed.result === 'won'
            ? await crmPipelineService.win(id.id)
            : await crmPipelineService.lose(id.id, parsed.lostReason ?? '')
        ) as OpportunityLike;
        return crmToolSuccess(
          `Oportunidad "${closed.title}" marcada como ${STATUS_LABEL[closed.status] ?? closed.status}.`,
          { opportunity: compactOpportunity(closed) },
        );
      } catch (error) {
        return crmToolFailure('cerrar la oportunidad', error);
      }
    },
  };

  return [
    getCrmPipeline,
    listCrmOpportunities,
    createCrmOpportunity,
    moveCrmOpportunity,
    setCrmOpportunityResult,
  ];
}
