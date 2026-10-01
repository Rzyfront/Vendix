import { RegisteredTool } from '../interfaces/tool.interface';
import {
  buildToolErrorEnvelope,
  buildToolSuccessEnvelope,
} from '../interfaces/tool.interface';
import type { VexBlockService } from '../../../domains/store/vex/services/vex-block.service';

export interface VexBlockToolDeps {
  blocks: VexBlockService;
}

/**
 * UI blocks Vex renders and keeps manipulating: tables, charts, KPIs, images
 * and files whose data stays server-side, plus the read/transform pair that
 * lets a later turn page through a block or derive a new version from it.
 *
 * All seven are `readOnly`: persisting a block mutates `ai_ui_blocks`, but it
 * mutates no business record — it is the agent's own scratch space for the
 * conversation, and routing it through the confirmation circuit would ask the
 * person to approve the agent showing them a table. Reads stay scoped because
 * the service filters every access by the request's store.
 *
 * Registration is owned by wave 2 (wiring) — this factory only declares.
 */
export function createVexBlockTools({ blocks }: VexBlockToolDeps): RegisteredTool[] {
  const conversationIdOf = (args: Record<string, any>): number | null => {
    const id = Number(args.conversation_id);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  const needsConversation = (tool: string) =>
    JSON.stringify(
      buildToolErrorEnvelope(
        tool,
        'Falta conversation_id: no sé en qué conversación guardar el bloque.',
        'Vuelve a llamar pasando el conversation_id del turno actual.',
      ),
    );

  return [
    {
      name: 'vex_render_table',
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Muestra una tabla a la persona y guarda sus datos para seguir trabajando con ellos. Úsala cuando la respuesta SON los datos (ventas por día, productos con stock bajo, top clientes): no listes las filas en prosa además de la tabla. Máximo 5000 filas; si hay más, resume el criterio y ofrece filtros. Devuelve el block_id: guárdalo para leer o transformar la tabla en turnos siguientes.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description:
              'Conversación donde vive el bloque. Opcional: el servidor usa la actual.',
          },
          title: { type: 'string', description: 'Título de la tabla.' },
          columns: {
            type: 'array',
            description: 'Columnas: [{key, label}]. key es el campo de cada fila.',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
              },
              required: ['key', 'label'],
            },
          },
          rows: {
            type: 'array',
            description: 'Filas como objetos. Máximo 5000.',
            items: { type: 'object' },
          },
        },
        required: ['columns', 'rows'],
      },
      handler: async (args) => {
        const conversationId = conversationIdOf(args);
        if (!conversationId) return needsConversation('vex_render_table');
        try {
          const block = await blocks.create({
            conversation_id: conversationId,
            kind: 'table',
            spec: { title: args.title },
            data: { columns: args.columns, rows: args.rows },
          });
          return JSON.stringify(
            buildToolSuccessEnvelope('vex_render_table', {
              block_id: block.id,
              kind: 'table',
              rows: (args.rows as unknown[]).length,
              version: block.version,
              block: await blocks.toUiBlock(block),
            }),
          );
        } catch (error: any) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_render_table',
              error?.message ?? 'No pude guardar la tabla.',
              'Revisa columns/rows y el tope de 5000 filas, y vuelve a intentarlo.',
            ),
          );
        }
      },
    },
    {
      name: 'vex_render_chart',
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Muestra un gráfico a la persona y guarda sus datos para seguir trabajando con ellos. chart_type: bar, line, pie, area, radar, scatter o gauge. series es la lista de series con sus datos; labels el eje de categorías cuando aplica. Devuelve el block_id para lecturas posteriores.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description:
              'Conversación donde vive el bloque. Opcional: el servidor usa la actual.',
          },
          title: { type: 'string', description: 'Título del gráfico.' },
          chart_type: {
            type: 'string',
            enum: ['bar', 'line', 'pie', 'area', 'radar', 'scatter', 'gauge'],
            description: 'Tipo de gráfico.',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Etiquetas del eje de categorías, cuando aplica.',
          },
          series: {
            type: 'array',
            description: 'Series con sus datos: [{name, data}].',
            items: { type: 'object' },
          },
        },
        required: ['chart_type', 'series'],
      },
      handler: async (args) => {
        const conversationId = conversationIdOf(args);
        if (!conversationId) return needsConversation('vex_render_chart');
        try {
          const block = await blocks.create({
            conversation_id: conversationId,
            kind: 'chart',
            spec: { title: args.title, chart_type: args.chart_type },
            data: { labels: args.labels ?? [], series: args.series },
          });
          return JSON.stringify(
            buildToolSuccessEnvelope('vex_render_chart', {
              block_id: block.id,
              kind: 'chart',
              version: block.version,
              block: await blocks.toUiBlock(block),
            }),
          );
        } catch (error: any) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_render_chart',
              error?.message ?? 'No pude guardar el gráfico.',
              'Revisa chart_type y que series no venga vacía, y vuelve a intentarlo.',
            ),
          );
        }
      },
    },
    {
      name: 'vex_render_kpi',
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Muestra un indicador (KPI) a la persona: un número grande con su etiqueta, opcionalmente con variación y comparativo. Úsalo para totales y métricas puntuales, no para listados.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description:
              'Conversación donde vive el bloque. Opcional: el servidor usa la actual.',
          },
          label: { type: 'string', description: 'Etiqueta del indicador.' },
          value: {
            description: 'Valor del indicador (número o texto corto).',
          },
          delta: {
            type: 'number',
            description: 'Variación frente al periodo anterior, en fracción (0.12 = +12 %).',
          },
          hint: {
            type: 'string',
            description: 'Texto de apoyo bajo el valor (periodo, comparativo).',
          },
        },
        required: ['label', 'value'],
      },
      handler: async (args) => {
        const conversationId = conversationIdOf(args);
        if (!conversationId) return needsConversation('vex_render_kpi');
        try {
          const block = await blocks.create({
            conversation_id: conversationId,
            kind: 'kpi',
            spec: {},
            data: {
              label: args.label,
              value: args.value,
              delta: args.delta,
              hint: args.hint,
            },
          });
          return JSON.stringify(
            buildToolSuccessEnvelope('vex_render_kpi', {
              block_id: block.id,
              kind: 'kpi',
              version: block.version,
              block: await blocks.toUiBlock(block),
            }),
          );
        } catch (error: any) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_render_kpi',
              error?.message ?? 'No pude guardar el indicador.',
              'Revisa label/value y vuelve a intentarlo.',
            ),
          );
        }
      },
    },
    {
      name: 'vex_render_image',
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Muestra una imagen a la persona a partir de una clave S3 (la que devuelven las herramientas de generación o los adjuntos). Pasa SIEMPRE la clave S3, nunca una URL firmada: las URL vencen y el bloque quedaría roto.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description:
              'Conversación donde vive el bloque. Opcional: el servidor usa la actual.',
          },
          s3_key: {
            type: 'string',
            description: 'Clave S3 de la imagen. Nunca una URL firmada.',
          },
          alt: { type: 'string', description: 'Texto alternativo.' },
        },
        required: ['s3_key'],
      },
      handler: async (args) => {
        const conversationId = conversationIdOf(args);
        if (!conversationId) return needsConversation('vex_render_image');
        try {
          const block = await blocks.create({
            conversation_id: conversationId,
            kind: 'image',
            spec: {},
            data: { s3_key: args.s3_key, alt: args.alt },
          });
          return JSON.stringify(
            buildToolSuccessEnvelope('vex_render_image', {
              block_id: block.id,
              kind: 'image',
              version: block.version,
              block: await blocks.toUiBlock(block),
            }),
          );
        } catch (error: any) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_render_image',
              error?.message ?? 'No pude guardar la imagen.',
              'Verifica que s3_key sea una clave S3 válida, no una URL, y vuelve a intentarlo.',
            ),
          );
        }
      },
    },
    {
      name: 'vex_render_file',
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Entrega un archivo descargable a la persona a partir de una clave S3 (la que devuelve get_report u otra herramienta que genere archivos). Pasa SIEMPRE la clave S3, nunca una URL firmada. Incluye filename para que la descarga tenga buen nombre.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description:
              'Conversación donde vive el bloque. Opcional: el servidor usa la actual.',
          },
          s3_key: {
            type: 'string',
            description: 'Clave S3 del archivo. Nunca una URL firmada.',
          },
          filename: {
            type: 'string',
            description: 'Nombre con el que la persona descarga el archivo.',
          },
          mime_type: { type: 'string', description: 'Tipo MIME del archivo.' },
        },
        required: ['s3_key', 'filename'],
      },
      handler: async (args) => {
        const conversationId = conversationIdOf(args);
        if (!conversationId) return needsConversation('vex_render_file');
        try {
          const block = await blocks.create({
            conversation_id: conversationId,
            kind: 'file',
            spec: {},
            data: {
              s3_key: args.s3_key,
              filename: args.filename,
              mime_type: args.mime_type,
            },
          });
          return JSON.stringify(
            buildToolSuccessEnvelope('vex_render_file', {
              block_id: block.id,
              kind: 'file',
              version: block.version,
              block: await blocks.toUiBlock(block),
            }),
          );
        } catch (error: any) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_render_file',
              error?.message ?? 'No pude guardar el archivo.',
              'Verifica s3_key y filename, y vuelve a intentarlo.',
            ),
          );
        }
      },
    },
    {
      name: 'vex_block_read',
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Lee las filas guardadas de un bloque de tabla, paginadas. Úsala cuando la persona se refiere a datos que ya mostraste ("esas filas", "esa tabla") en vez de adivinarlos o pedirlos de nuevo. Pagina hasta cubrir lo que necesites; no asumas el total.',
      parameters: {
        type: 'object',
        properties: {
          block_id: {
            type: 'string',
            description: 'Identificador devuelto por vex_render_table.',
          },
          page: { type: 'number', description: 'Página, desde 1.' },
          page_size: {
            type: 'number',
            description: 'Filas por página (máximo 500).',
          },
        },
        required: ['block_id'],
      },
      handler: async (args) => {
        try {
          const page = await blocks.readPaged(
            String(args.block_id),
            Number(args.page) || 1,
            Number(args.page_size) || 50,
          );
          return JSON.stringify(buildToolSuccessEnvelope('vex_block_read', page));
        } catch (error: any) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_block_read',
              error?.message ?? 'No pude leer el bloque.',
              'Verifica el block_id con la conversación actual y vuelve a intentarlo.',
            ),
          );
        }
      },
    },
    {
      name: 'vex_block_transform',
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Deriva una NUEVA versión de un bloque de tabla aplicando filtro, orden, agrupación y agregación. El bloque original queda intacto. filter: [{field, op, value}] con op en eq, neq, gt, gte, lt, lte, contains, in. sort: [{field, direction}]. group_by + aggregate {field, function: sum|avg|count|min|max} resumen por grupo. Devuelve el block_id de la nueva versión: úsalo de ahí en adelante.',
      parameters: {
        type: 'object',
        properties: {
          block_id: {
            type: 'string',
            description: 'Bloque de tabla a transformar.',
          },
          filter: {
            type: 'array',
            description: 'Filtros a aplicar sobre las filas.',
            items: { type: 'object' },
          },
          sort: {
            type: 'array',
            description: 'Orden: [{field, direction: asc|desc}].',
            items: { type: 'object' },
          },
          group_by: {
            type: 'string',
            description: 'Campo por el que agrupar antes de agregar.',
          },
          aggregate: {
            type: 'object',
            description: 'Agregación: {field, function}.',
            properties: {
              field: { type: 'string' },
              function: {
                type: 'string',
                enum: ['sum', 'avg', 'count', 'min', 'max'],
              },
            },
            required: ['field', 'function'],
          },
        },
        required: ['block_id'],
      },
      handler: async (args) => {
        try {
          const block = await blocks.transform(String(args.block_id), {
            filter: args.filter,
            sort: args.sort,
            group_by: args.group_by,
            aggregate: args.aggregate,
          });
          const rows = ((block.data as Record<string, any>)?.rows ?? []) as unknown[];
          return JSON.stringify(
            buildToolSuccessEnvelope('vex_block_transform', {
              block_id: block.id,
              kind: 'table',
              version: block.version,
              rows: rows.length,
              preview: rows.slice(0, 5),
              block: await blocks.toUiBlock(block),
            }),
          );
        } catch (error: any) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_block_transform',
              error?.message ?? 'No pude transformar el bloque.',
              'Verifica que el bloque sea una tabla y que los campos existan, y vuelve a intentarlo.',
            ),
          );
        }
      },
    },
  ];
}
