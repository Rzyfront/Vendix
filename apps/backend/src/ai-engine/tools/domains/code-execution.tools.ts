import type { SandboxBrokerService } from '../../sandbox/sandbox-broker.service';
import {
  buildToolErrorEnvelope,
  buildToolSuccessEnvelope,
} from '../interfaces/tool.interface';
import type {
  RegisteredTool,
  ToolExecutionContext,
} from '../interfaces/tool.interface';
import {
  ANALYSIS_LIMITS,
  AnalysisError,
} from '../../sandbox/interfaces/analysis-protocol.interface';
import type {
  AnalysisCell,
  AnalysisInputTable,
  AnalysisOutput,
  AnalysisRunRequest,
  AnalysisRunResult,
  AnalysisRunner,
} from '../../sandbox/interfaces/analysis-protocol.interface';
import { RequestContextService } from '../../../common/context/request-context.service';

/** Read-only computation, not a confirmation shortcut or a general runtime. */
export function createCodeExecutionTools(
  broker: SandboxBrokerService,
): RegisteredTool[] {
  return [
    {
      name: 'run_readonly_script',
      access: 'public',
      accessReason:
        "The sandbox re-derives the caller's live permissions and only exposes the tools they hold (SandboxPolicyService).",
      version: '1',
      domain: 'sandbox',
      readOnly: true,
      description:
        'Cálculo read-only: fan-out, paginación o join complejo del catálogo con JS limitado (TypeScript sólo sintaxis JS/JSDoc). Preferir list_products, vex_block_transform o reporte para consultas simples. Sólo tools.list_products(args) auditada en el working set; sin imports/red/fs/env/SQL/escrituras/UI. return JSON compacto; dinero con enteros/escalas decimales, nunca sumas floats. Disponibilidad Linux aislado requerida; no reintentar automáticamente. Código no verifica objetivos.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: {
            type: 'string',
            description:
              'Cuerpo async import-free, <=32KiB, return valor JSON.',
          },
          language: { type: 'string', enum: ['javascript', 'typescript'] },
          tools: {
            type: 'array',
            items: { type: 'string', enum: ['list_products'] },
          },
          purpose: { type: 'string', enum: ['fanout', 'pagination', 'join'] },
        },
        required: ['source', 'language', 'tools', 'purpose'],
      },
      handler: async (args) => broker.run(args),
    },
  ];
}

// ── run_analysis (F9/T52) ───────────────────────────────────────────────────

const ANALYSIS_TOOL = 'run_analysis';
const ANALYSIS_PURPOSES = [
  'projection',
  'correlation',
  'segmentation',
  'other',
] as const;
const INPUT_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Minimal slice of `VexBlockService` the analysis tool needs. */
export interface AnalysisBlocksPort {
  getById(id: string): Promise<{
    id: string;
    store_id: number;
    conversation_id: number;
    kind: string;
    spec: Record<string, any>;
    data: Record<string, any>;
  }>;
  create(input: {
    conversation_id: number;
    kind: 'table' | 'chart' | 'kpi';
    spec?: Record<string, any>;
    data: Record<string, any>;
  }): Promise<{ id: string; version: number }>;
}

export interface AnalysisEntitlementPort {
  /** Whether the store's plan includes `vex.code_analysis` (fail closed). */
  codeAnalysisEnabled(storeId: number): Promise<boolean>;
}

export interface AnalysisToolDeps {
  runner: AnalysisRunner;
  blocks: AnalysisBlocksPort;
  entitlements: AnalysisEntitlementPort;
}

const USE_COMPUTE =
  'Usa compute para el cálculo y explícale a la persona que el análisis con código no está disponible ahora.';

const fail = (error: string, nextStep: string): string =>
  JSON.stringify(buildToolErrorEnvelope(ANALYSIS_TOOL, error, nextStep));

/** Thrown while materializing inputs; carries a ready Spanish message. */
class InputRejected extends Error {}

const toCell = (value: unknown): AnalysisCell => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
};

/** Converts a table or chart block into a DataFrame-shaped input. */
function blockToInput(
  name: string,
  block: { kind: string; data: Record<string, any> },
  notes: string[],
): AnalysisInputTable {
  let columns: string[] = [];
  let rows: AnalysisCell[][] = [];
  if (block.kind === 'table') {
    const defs: Array<{ key: string; label?: string }> = Array.isArray(
      block.data?.columns,
    )
      ? block.data.columns.filter(
          (c: unknown): c is { key: string } =>
            !!c && typeof (c as { key?: unknown }).key === 'string',
        )
      : [];
    const sourceRows: Array<Record<string, unknown>> = Array.isArray(
      block.data?.rows,
    )
      ? block.data.rows
      : [];
    columns = defs.map((c) => c.key);
    rows = sourceRows.map((r) => defs.map((c) => toCell(r?.[c.key])));
  } else if (block.kind === 'chart') {
    const labels: unknown[] = Array.isArray(block.data?.labels)
      ? block.data.labels
      : [];
    const series: Array<{ name?: string; data?: unknown[] }> = Array.isArray(
      block.data?.series,
    )
      ? block.data.series
      : [];
    columns = [
      'label',
      ...series.map((s, i) => (s.name ? String(s.name) : `serie_${i + 1}`)),
    ];
    const count = Math.max(
      labels.length,
      ...series.map((s) => (Array.isArray(s.data) ? s.data.length : 0)),
    );
    for (let i = 0; i < count; i++) {
      rows.push([
        toCell(labels[i]),
        ...series.map((s) => toCell(Array.isArray(s.data) ? s.data[i] : null)),
      ]);
    }
  } else {
    throw new InputRejected(
      `El bloque de «${name}» es de tipo ${block.kind}: solo puedo analizar tablas y gráficos.`,
    );
  }
  if (columns.length === 0)
    throw new InputRejected(`El bloque de «${name}» no tiene columnas.`);
  if (columns.length > ANALYSIS_LIMITS.input_columns) {
    notes.push(
      `«${name}»: se usaron solo las primeras ${ANALYSIS_LIMITS.input_columns} de ${columns.length} columnas.`,
    );
    columns = columns.slice(0, ANALYSIS_LIMITS.input_columns);
    rows = rows.map((r) => r.slice(0, ANALYSIS_LIMITS.input_columns));
  }
  if (rows.length > ANALYSIS_LIMITS.input_rows) {
    notes.push(
      `«${name}»: se usaron solo las primeras ${ANALYSIS_LIMITS.input_rows} de ${rows.length} filas.`,
    );
    rows = rows.slice(0, ANALYSIS_LIMITS.input_rows);
  }
  return { name, columns, rows };
}

function failureFor(error: AnalysisError): string {
  const detail = error.detail ? ` Detalle: ${error.detail}` : '';
  switch (error.code) {
    case 'ANALYSIS_TIMEOUT':
      return fail(
        'El análisis tardó demasiado y se canceló.',
        'Simplifica el cálculo (menos columnas, sin ciclos pesados) o usa compute para lo básico; no lo reintentes igual.',
      );
    case 'ANALYSIS_MEMORY':
      return fail(
        'El análisis necesitó más memoria de la permitida.',
        'Reduce los datos de entrada o simplifica el cálculo; no lo reintentes igual.',
      );
    case 'ANALYSIS_SYNTAX':
      return fail(
        `El código tiene un error de sintaxis.${detail}`,
        'Corrige el código una sola vez y vuelve a llamar; si falla de nuevo, usa compute y avisa a la persona.',
      );
    case 'ANALYSIS_RUNTIME':
      return fail(
        `El código falló al ejecutarse.${detail}`,
        'Corrige el código una sola vez y vuelve a llamar; si falla de nuevo, usa compute y avisa a la persona.',
      );
    case 'ANALYSIS_INPUT':
      return fail(
        `Los datos de entrada no son válidos para el análisis.${detail}`,
        'Revisa los bloques elegidos (tablas con columnas y filas) y vuelve a intentarlo una sola vez.',
      );
    case 'ANALYSIS_OUTPUT':
      return fail(
        `El resultado del código no tiene el formato esperado.${detail}`,
        'Asigna result = {"tables": [...], "series": [...], "figures": [...], "notes": [...]} y corrige una sola vez.',
      );
    case 'ANALYSIS_LIMIT':
      return fail(
        'Ya hay otro análisis en curso en esta tienda; espera a que termine.',
        'Avisa a la persona que vuelva a pedirlo en un momento; mientras tanto usa compute para lo básico.',
      );
    default:
      return fail(
        'El análisis avanzado con código no está disponible en este momento.',
        USE_COMPUTE,
      );
  }
}

/**
 * `run_analysis` (F9/T52): pandas/numpy/statsmodels over blocks the person
 * already has in THIS conversation. The tool never talks to the sandbox
 * directly (it depends on the `AnalysisRunner` port) and the isolated runtime
 * has no data access: the host materializes the inputs and turns the JSON
 * output into Vex blocks that carry the code used (`spec.analysis`).
 */
export function createAnalysisTools({
  runner,
  blocks,
  entitlements,
}: AnalysisToolDeps): RegisteredTool[] {
  return [
    {
      name: ANALYSIS_TOOL,
      access: 'public',
      accessReason:
        "Reads only blocks of the caller's own Vex conversation (re-checked per block); the isolated runtime has no data, network or secrets, and the output becomes blocks of that same conversation.",
      version: '1',
      domain: 'sandbox',
      readOnly: true,
      description:
        'Análisis estadístico con código Python (pandas, numpy, statsmodels) sobre datos que YA están en bloques de esta conversación: proyecciones y tendencias, correlaciones, regresiones, segmentaciones (por frecuencia, ticket, etc.). NO lo uses para sumas, porcentajes, variaciones o márgenes (usa compute) ni para consultas simples (usa las tools de reporte): primero trae los datos con un reporte y muéstralos en un bloque de tabla. Contrato del código: `inputs['<name>']` es un DataFrame de pandas por cada entrada; `pd`, `np` y `sm` ya están disponibles; sin imports de red, sin archivos, sin dibujar (el panel pinta los gráficos). Termina asignando `result = {"tables": [{"title", "columns", "rows"}], "series": [{"title", "chart": "line|bar|scatter", "x", "datasets": [{"label", "values"}]}], "figures": [{"label", "value", "unit"?}], "notes": ["..."]}`. La persona verá el código usado en un desplegable. Requiere un plan con «Análisis con código»; si no está disponible, usa compute. No reintentar automáticamente: si falla, corrige el código una sola vez.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          conversation_id: {
            type: 'number',
            description:
              'Conversación actual: de ella salen los bloques de entrada y en ella se guardan los resultados.',
          },
          source: {
            type: 'string',
            description:
              'Cuerpo Python, <=32KiB. Lee inputs[...] y asigna result = {...}.',
          },
          inputs: {
            type: 'array',
            minItems: 1,
            maxItems: ANALYSIS_LIMITS.input_tables,
            description:
              'De 1 a 5 entradas: cada una expone el bloque (tabla o gráfico) como DataFrame inputs[name].',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: {
                  type: 'string',
                  description: 'Identificador ^[a-z][a-z0-9_]{0,39}$.',
                },
                block_id: {
                  type: 'string',
                  description: 'block_id de un bloque de esta conversación.',
                },
              },
              required: ['name', 'block_id'],
            },
          },
          purpose: { type: 'string', enum: [...ANALYSIS_PURPOSES] },
          title: {
            type: 'string',
            description: 'Título opcional para los bloques resultantes.',
          },
        },
        required: ['conversation_id', 'source', 'inputs', 'purpose'],
      },
      handler: async (
        args: Record<string, any>,
        context?: ToolExecutionContext,
      ) => {
        // 1. Validate arguments.
        const conversationId = Number(args.conversation_id);
        if (!Number.isInteger(conversationId) || conversationId <= 0)
          return fail(
            'Falta conversation_id: no sé de qué conversación tomar los bloques.',
            'Vuelve a llamar pasando el conversation_id del turno actual.',
          );
        const source = typeof args.source === 'string' ? args.source : '';
        if (!source.trim())
          return fail(
            'Falta el código a ejecutar (source).',
            'Escribe el código Python y vuelve a llamar.',
          );
        if (Buffer.byteLength(source, 'utf8') > ANALYSIS_LIMITS.source_bytes)
          return fail(
            'El código supera los 32 KiB permitidos.',
            'Acorta el código y vuelve a llamar.',
          );
        const purpose = ANALYSIS_PURPOSES.find((p) => p === args.purpose);
        if (!purpose)
          return fail(
            'purpose debe ser projection, correlation, segmentation u other.',
            'Vuelve a llamar con un purpose válido.',
          );
        const inputSpecs: Array<{ name: unknown; block_id: unknown }> =
          Array.isArray(args.inputs) ? args.inputs : [];
        if (
          inputSpecs.length < 1 ||
          inputSpecs.length > ANALYSIS_LIMITS.input_tables
        )
          return fail(
            `inputs debe traer de 1 a ${ANALYSIS_LIMITS.input_tables} entradas.`,
            'Elige los bloques a analizar y vuelve a llamar.',
          );
        const names = new Set<string>();
        for (const spec of inputSpecs) {
          if (
            typeof spec?.name !== 'string' ||
            !INPUT_NAME_RE.test(spec.name) ||
            names.has(spec.name) ||
            typeof spec.block_id !== 'string' ||
            !spec.block_id
          )
            return fail(
              'Cada entrada necesita un name único (^[a-z][a-z0-9_]{0,39}$) y un block_id.',
              'Corrige inputs y vuelve a llamar.',
            );
          names.add(spec.name);
        }

        // 2. Store from the request context (never from args).
        const storeId =
          RequestContextService.asyncLocalStorage.getStore()?.store_id ??
          context?.store_id;
        if (!storeId)
          return fail(
            'No pude identificar la tienda de esta conversación.',
            USE_COMPUTE,
          );
        if (
          context?.conversation_id !== undefined &&
          context.conversation_id !== conversationId
        )
          return fail(
            'El conversation_id no corresponde a la conversación actual.',
            'Vuelve a llamar con el conversation_id del turno actual.',
          );

        // 3. Plan entitlement, then sandbox availability.
        let entitled = false;
        try {
          entitled = await entitlements.codeAnalysisEnabled(storeId);
        } catch {
          entitled = false;
        }
        if (!entitled)
          return fail(
            'Tu plan no incluye «Análisis con código».',
            'Usa compute para el cálculo y explícale al usuario que el análisis con código requiere un plan que lo incluya.',
          );
        if (!runner.available())
          return fail(
            'El análisis avanzado con código no está disponible en este momento.',
            USE_COMPUTE,
          );

        // 4. Materialize inputs; every block must belong to THIS conversation.
        const notes: string[] = [];
        const inputs: AnalysisInputTable[] = [];
        try {
          for (const spec of inputSpecs) {
            let block: Awaited<ReturnType<AnalysisBlocksPort['getById']>>;
            try {
              block = await blocks.getById(spec.block_id as string);
            } catch {
              throw new InputRejected(
                `No encontré el bloque de «${spec.name}» en esta conversación.`,
              );
            }
            if (
              block.conversation_id !== conversationId ||
              block.store_id !== storeId
            )
              throw new InputRejected(
                `No encontré el bloque de «${spec.name}» en esta conversación.`,
              );
            inputs.push(blockToInput(spec.name as string, block, notes));
          }
        } catch (error) {
          if (error instanceof InputRejected)
            return fail(
              error.message,
              'Usa solo block_id de tablas o gráficos creados en esta conversación y vuelve a llamar.',
            );
          return fail(
            'No pude leer los bloques de entrada.',
            'Vuelve a mostrar los datos en una tabla y reintenta una sola vez.',
          );
        }

        // 5. Run in the isolated runtime.
        const request: AnalysisRunRequest = { source, inputs, purpose };
        let run: AnalysisRunResult;
        try {
          run = await runner.run(request);
        } catch (error) {
          if (error instanceof AnalysisError) return failureFor(error);
          return fail(
            'El análisis avanzado con código no está disponible en este momento.',
            USE_COMPUTE,
          );
        }

        // 6. Turn the output into blocks carrying the code used.
        const title =
          typeof args.title === 'string' && args.title.trim()
            ? args.title.trim()
            : undefined;
        const analysisMeta = {
          run_id: run.run_id,
          source_hash: run.source_hash,
          language: 'python' as const,
          purpose,
        };
        const output: AnalysisOutput = run.output ?? {};
        type Planned = {
          kind: 'table' | 'chart' | 'kpi';
          spec: Record<string, any>;
          data: Record<string, any>;
        };
        const planned: Planned[] = [];
        for (const table of output.tables ?? []) {
          const keys = table.columns.map((_, i) => `c${i}`);
          planned.push({
            kind: 'table',
            spec: { title: table.title || title },
            data: {
              columns: table.columns.map((label, i) => ({
                key: keys[i],
                label,
              })),
              rows: table.rows.map((row) =>
                Object.fromEntries(keys.map((k, i) => [k, row[i] ?? null])),
              ),
            },
          });
        }
        for (const series of output.series ?? []) {
          planned.push({
            kind: 'chart',
            spec: {
              title: series.title || title,
              chart_type: series.chart,
              ...(series.x_label ? { x_label: series.x_label } : {}),
              ...(series.y_label ? { y_label: series.y_label } : {}),
            },
            data: {
              labels: series.x.map(String),
              series: series.datasets.map((d) => ({
                name: d.label,
                data: d.values,
              })),
            },
          });
        }
        for (const figure of output.figures ?? []) {
          planned.push({
            kind: 'kpi',
            spec: {},
            data: {
              label: figure.label,
              value: figure.value ?? 'n/d',
              ...(figure.unit ? { hint: figure.unit } : {}),
            },
          });
        }
        const created: Array<{ block_id: string; kind: string }> = [];
        try {
          for (const [i, item] of planned.entries()) {
            // The code is shown once per analysis: only the LAST block carries it.
            const isLast = i === planned.length - 1;
            const block = await blocks.create({
              conversation_id: conversationId,
              kind: item.kind,
              spec: {
                ...item.spec,
                analysis: isLast
                  ? { ...analysisMeta, source }
                  : analysisMeta,
              },
              data: item.data,
            });
            created.push({ block_id: block.id, kind: item.kind });
          }
        } catch (error: any) {
          return fail(
            `El análisis se calculó pero no pude guardar sus resultados: ${error?.message ?? 'error desconocido'}.`,
            'Avisa a la persona; no repitas el análisis. Puedes resumir las cifras con compute.',
          );
        }

        return JSON.stringify(
          buildToolSuccessEnvelope(ANALYSIS_TOOL, {
            run_id: run.run_id,
            source_hash: run.source_hash,
            purpose,
            blocks: created,
            figures: (output.figures ?? []).map((f) => ({
              label: f.label,
              value: f.value,
              ...(f.unit ? { unit: f.unit } : {}),
            })),
            message: [...notes, ...(output.notes ?? [])].join(' ') || undefined,
          }),
        );
      },
    },
  ];
}
