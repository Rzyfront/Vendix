import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  AiToolboxService,
  DOCUMENT_KIND_TO_APP,
  DOCUMENT_KIND_PURPOSE,
  SUMMARY_KIND_TO_APP,
  COPY_KIND_TO_APP,
  IMAGE_KIND_TO_APP,
} from '../../toolbox/ai-toolbox.service';
import { VexiAttachmentsService } from '../../../domains/store/vexi/vexi-attachments.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';

export interface AiToolboxToolDeps {
  toolbox: AiToolboxService;
  attachments: VexiAttachmentsService;
  prisma: StorePrismaService;
  s3: S3Service;
}

const logger = new Logger('ai-toolbox.tools');

/** Beyond this an extraction result crowds the conversation out of the window. */
const MAX_EXTRACTION_CHARS = 6000;

/** How many candidate matches are worth showing per unmatched line. */
const MAX_CANDIDATES = 3;

/**
 * The document and media specialists, as tools.
 *
 * `readOnly: true` on all of them, and that is a precise claim rather than a
 * convenience: extracting, summarising and generating produce no business
 * record. The write that follows is a separate tool call with its own
 * confirmation gate, which is what keeps "Vexi read my invoice" and "Vexi
 * created a purchase order" as two events the user authorises separately.
 *
 * Being read-only also makes them reachable from the realtime voice surface,
 * where `getReadOnlyDefinitions()` is the whole catalog — so "toma esta foto de
 * la factura" works by voice too.
 */
export function createAiToolboxTools({
  toolbox,
  attachments,
  prisma,
  s3,
}: AiToolboxToolDeps): RegisteredTool[] {
  const documentKinds = Object.keys(DOCUMENT_KIND_TO_APP);

  return [
    {
      name: 'ai_extract_document',
      domain: 'ai-toolbox',
      readOnly: true,
      description: `Lee un documento que la persona adjuntó y devuelve sus datos estructurados. Ejecuta un modelo de visión especializado por tipo de documento — tú no ves la imagen, recibes el resultado ya extraído. Tipos que puedo leer: ${documentKinds
        .map((kind) => `"${kind}" (${DOCUMENT_KIND_PURPOSE[kind]})`)
        .join(
          ', ',
        )}. Úsala en cuanto la persona adjunte algo relacionado con una de esas gestiones, sin pedirle que transcriba nada. Después de extraer, SIEMPRE valida con validate_extraction antes de proponer cualquier cambio. Si la extracción sale incoherente —un total que no cuadra, un campo ilegible— vuelve a llamarla con retry_hint describiendo el problema en una frase.`,
      parameters: {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'string',
            description:
              'Identificador del documento adjunto en este turno, como "att_41". Te llega en el contexto de la conversación.',
          },
          document_kind: {
            type: 'string',
            enum: documentKinds,
            description: 'Qué clase de documento es.',
          },
          retry_hint: {
            type: 'string',
            description:
              'Solo en un segundo intento: qué salió mal la vez anterior, en una frase. Por ejemplo "el total no coincide con la suma de las líneas, revisa la última columna".',
          },
        },
        required: ['attachment_id', 'document_kind'],
      },
      handler: async (args) => {
        const outcome = await toolbox.extractDocument({
          attachmentId: String(args.attachment_id),
          documentKind: String(args.document_kind),
          retryHint: args.retry_hint ? String(args.retry_hint) : undefined,
        });

        const payload = JSON.stringify(outcome.data);

        return JSON.stringify({
          document: outcome.document,
          document_kind: args.document_kind,
          extracted: payload.length > MAX_EXTRACTION_CHARS
            ? `${payload.slice(0, MAX_EXTRACTION_CHARS)}… (truncado)`
            : outcome.data,
          truncated: payload.length > MAX_EXTRACTION_CHARS,
          next_step:
            'Cruza esto con los datos reales del comercio usando validate_extraction. No le propongas nada a la persona antes de validar, y no inventes lo que no venga en el documento.',
        });
      },
    },
    {
      name: 'validate_extraction',
      domain: 'ai-toolbox',
      readOnly: true,
      description:
        'Cruza los datos que salieron de un documento contra los registros reales del comercio: proveedores, productos, clientes y categorías de gasto. Devuelve, línea por línea, qué coincide con qué registro existente, qué es ambiguo y qué no existe. Llámala SIEMPRE entre ai_extract_document y cualquier propuesta de escritura: es lo que separa "el modelo leyó un papel" de "el sistema verificó lo que dice el papel". Lo que salga como no encontrado NO lo crees por tu cuenta: pregúntale a la persona.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: ['compras', 'gastos', 'inventario', 'socios'],
            description:
              'Qué gestión vas a hacer con el documento, para saber contra qué catálogo cruzar.',
          },
          supplier_name: {
            type: 'string',
            description: 'Nombre del proveedor o del emisor, tal como se leyó.',
          },
          supplier_tax_id: {
            type: 'string',
            description: 'NIT o documento del emisor, si el documento lo trae.',
          },
          items: {
            type: 'array',
            description:
              'Líneas del documento a cruzar contra el catálogo. Manda el nombre tal como se leyó y, si viene, el código.',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                code: { type: 'string' },
                quantity: { type: 'number' },
                unit_price: { type: 'number' },
              },
            },
          },
          documents: {
            type: 'array',
            description:
              'Documentos de identidad a cruzar contra clientes existentes, para carga de socios.',
            items: { type: 'string' },
          },
        },
        required: ['domain'],
      },
      handler: async (args, context) => {
        const domain = String(args.domain);
        const result: Record<string, unknown> = { domain };

        if (args.supplier_name || args.supplier_tax_id) {
          result.supplier = await matchSupplier(
            prisma,
            context.organization_id,
            args.supplier_name ? String(args.supplier_name) : undefined,
            args.supplier_tax_id ? String(args.supplier_tax_id) : undefined,
          );
        }

        if (Array.isArray(args.items) && args.items.length) {
          result.items = await matchItems(prisma, args.items as any[]);
        }

        if (Array.isArray(args.documents) && args.documents.length) {
          result.people = await matchPeople(
            prisma,
            args.documents as any[],
            context.store_id,
          );
        }

        if (domain === 'gastos') {
          result.expense_categories = await listExpenseCategories(prisma);
        }

        const unmatched = countUnmatched(result);

        return JSON.stringify({
          ...result,
          summary: {
            unmatched,
            verdict:
              unmatched === 0
                ? 'Todo lo del documento existe en el sistema. Puedes proponer el cambio.'
                : 'Hay datos del documento que no existen en el sistema.',
          },
          next_step:
            unmatched === 0
              ? 'Propón la escritura con los identificadores reales que te devolví, nunca con los nombres del documento.'
              : 'Dile a la persona exactamente qué no encontraste y pregúntale qué hacer con eso. No lo crees por tu cuenta ni lo omitas en silencio.',
        });
      },
    },
    {
      name: 'ai_summarize',
      domain: 'ai-toolbox',
      readOnly: true,
      description: `Prepara un resumen especializado con un modelo aparte. Tipos disponibles: ${Object.keys(
        SUMMARY_KIND_TO_APP,
      ).join(
        ', ',
      )}. Úsala cuando la persona pida el análisis de un cierre de caja, el historial de un cliente o un prediagnóstico de consulta, en vez de redactarlo tú desde cero.`,
      parameters: {
        type: 'object',
        properties: {
          summary_kind: {
            type: 'string',
            enum: Object.keys(SUMMARY_KIND_TO_APP),
          },
          variables: {
            type: 'object',
            description:
              'Datos de entrada del resumen, ya consultados con las herramientas de lectura. Cada valor va como texto.',
          },
        },
        required: ['summary_kind', 'variables'],
      },
      handler: async (args) => {
        const outcome = await toolbox.summarize(
          String(args.summary_kind),
          normalizeVariables(args.variables),
        );

        return JSON.stringify({ summary: outcome.content });
      },
    },
    {
      name: 'ai_write_copy',
      domain: 'ai-toolbox',
      readOnly: true,
      description: `Redacta textos de marketing con un modelo especializado. Tipos: ${Object.keys(
        COPY_KIND_TO_APP,
      ).join(
        ', ',
      )}. Devuelve el texto para que la persona lo apruebe; publicarlo es una escritura aparte.`,
      parameters: {
        type: 'object',
        properties: {
          copy_kind: { type: 'string', enum: Object.keys(COPY_KIND_TO_APP) },
          variables: {
            type: 'object',
            description: 'Contexto del texto: producto, tono, canal, objetivo.',
          },
        },
        required: ['copy_kind', 'variables'],
      },
      handler: async (args) => {
        const outcome = await toolbox.writeCopy(
          String(args.copy_kind),
          normalizeVariables(args.variables),
        );

        return JSON.stringify({ copy: outcome.content });
      },
    },
    {
      name: 'ai_generate_image',
      domain: 'ai-toolbox',
      readOnly: true,
      description: `Genera o mejora una imagen con un modelo de imagen. Tipos: ${Object.keys(
        IMAGE_KIND_TO_APP,
      ).join(
        ', ',
      )}. Devuelve un enlace para que la persona la vea; asignarla a un producto o publicarla como anuncio es una escritura aparte que requiere su aprobación. Si la persona adjuntó una foto para mejorar, pásala en reference_attachment_id.`,
      parameters: {
        type: 'object',
        properties: {
          image_kind: { type: 'string', enum: Object.keys(IMAGE_KIND_TO_APP) },
          prompt: {
            type: 'string',
            description: 'Qué debe mostrar la imagen, en una o dos frases.',
          },
          reference_attachment_id: {
            type: 'string',
            description:
              'Documento adjunto que sirve de base cuando se trata de mejorar una foto existente.',
          },
          product_name: { type: 'string' },
        },
        required: ['image_kind', 'prompt'],
      },
      handler: async (args) => {
        const outcome = await toolbox.generateImage({
          imageKind: String(args.image_kind),
          prompt: String(args.prompt),
          referenceAttachmentId: args.reference_attachment_id
            ? String(args.reference_attachment_id)
            : undefined,
          productName: args.product_name
            ? String(args.product_name)
            : undefined,
        });

        // The base64 never goes back to the model. It is uploaded and answered
        // as a URL, because a single generated image in a tool result would
        // consume more of the context window than the whole conversation.
        const storeId = RequestContextService.getStoreId();
        const key = `vexi-generated/stores/${storeId ?? 'unknown'}/${randomUUID()}.png`;
        const payload = outcome.imageBase64.replace(
          /^data:image\/[a-z]+;base64,/,
          '',
        );

        try {
          await s3.uploadFile(Buffer.from(payload, 'base64'), key, 'image/png');
          const url = await s3.getPresignedUrl(key, 3600);

          return JSON.stringify({
            image_url: url,
            s3_key: key,
            revised_prompt: outcome.revisedPrompt,
            next_step:
              'Muéstrasela describiéndola en una frase y pregúntale si la quiere usar. No la asignes a nada sin su sí.',
          });
        } catch (error: any) {
          logger.warn(`Could not persist generated image: ${error?.message}`);
          return JSON.stringify({
            error:
              'Generé la imagen pero no pude guardarla para mostrarla. Dile que lo intente de nuevo.',
          });
        }
      },
    },
    {
      name: 'list_attachments',
      domain: 'ai-toolbox',
      readOnly: true,
      description:
        'Lista los documentos que la persona ha adjuntado en esta conversación, con su identificador. Úsala si perdiste el identificador de un adjunto que ya te habían pasado, antes de pedirle que lo suba otra vez.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description: 'Conversación actual, si la conoces.',
          },
        },
        required: [],
      },
      handler: async (args, context) => {
        const rows = await prisma.ai_attachments.findMany({
          where: {
            ...(args.conversation_id
              ? { conversation_id: Number(args.conversation_id) }
              : {}),
            ...(context.user_id ? { user_id: context.user_id } : {}),
          },
          select: {
            id: true,
            original_name: true,
            mime_type: true,
            created_at: true,
            linked_entity_type: true,
            linked_entity_id: true,
          },
          orderBy: { id: 'desc' },
          take: 10,
        });

        return JSON.stringify({
          attachments: rows.map((row) => ({
            attachment_id: `att_${row.id}`,
            name: row.original_name,
            type: row.mime_type,
            already_used_for: row.linked_entity_type
              ? `${row.linked_entity_type}#${row.linked_entity_id}`
              : null,
          })),
          note: 'Un documento que ya está ligado a un registro se usó para crearlo. Si la persona quiere otra gestión con el mismo papel, se puede reutilizar.',
        });
      },
    },
  ];

  /** Kept inside the factory so the tools can share `attachments` if needed. */
  function normalizeVariables(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object') return {};

    return Object.entries(raw as Record<string, unknown>).reduce<
      Record<string, string>
    >((acc, [key, value]) => {
      acc[key] =
        typeof value === 'string' ? value : JSON.stringify(value ?? null);
      return acc;
    }, {});
  }
}

// ── Cross-checking against real records ───────────────────────────────────
//
// Implemented with direct scoped Prisma reads rather than by importing
// `InvoiceScannerService.matchProducts`: that service lives in the
// purchase-orders module and this file is registered from the `@Global()`
// ai-engine module, so the import would close a dependency cycle. The matching
// here is deliberately simpler — exact and prefix matches, no fuzzy scoring —
// because its job is to tell the truth about what exists, and a fuzzy guess
// presented as a match is the failure mode worth avoiding.

async function matchSupplier(
  prisma: StorePrismaService,
  organizationId: number | undefined,
  name?: string,
  taxId?: string,
) {
  if (!organizationId) {
    return { matched: false, reason: 'Sin organización en contexto.' };
  }

  // `state: { not: 'archived' }` on every branch, same rule
  // `InvoiceScannerService.matchSupplier` applies: suggesting a supplier the
  // owner took out of circulation would have them open a purchase order against
  // it. Inactive ones are still suggested — matching only proposes.
  if (taxId) {
    const byTaxId = await prisma.suppliers.findFirst({
      where: {
        tax_id: { equals: taxId, mode: 'insensitive' },
        state: { not: 'archived' },
      },
      select: { id: true, name: true, tax_id: true },
    });
    if (byTaxId) return { matched: true, ...byTaxId, matched_by: 'tax_id' };
  }

  if (!name) return { matched: false };

  const exact = await prisma.suppliers.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      state: { not: 'archived' },
    },
    select: { id: true, name: true, tax_id: true },
  });
  if (exact) return { matched: true, ...exact, matched_by: 'name' };

  const candidates = await prisma.suppliers.findMany({
    where: {
      name: { contains: firstWord(name), mode: 'insensitive' },
      state: { not: 'archived' },
    },
    select: { id: true, name: true, tax_id: true },
    take: MAX_CANDIDATES,
  });

  return {
    matched: false,
    read_as: name,
    candidates,
    note: candidates.length
      ? 'Ninguno coincide exactamente. Pregúntale a la persona si es uno de estos.'
      : 'Ese proveedor no existe en el sistema.',
  };
}

async function matchItems(prisma: StorePrismaService, items: any[]) {
  const results: unknown[] = [];

  for (const item of items.slice(0, 60)) {
    const description = String(item?.description ?? '').trim();
    const code = item?.code ? String(item.code).trim() : '';

    if (code) {
      const byCode = await prisma.products.findFirst({
        where: {
          OR: [{ sku: code }, { barcode: code }],
          state: { not: 'archived' },
        },
        select: { id: true, name: true, sku: true },
      });
      if (byCode) {
        results.push({
          read_as: description || code,
          matched: true,
          ...byCode,
          matched_by: 'code',
        });
        continue;
      }
    }

    if (!description) {
      results.push({ read_as: code, matched: false });
      continue;
    }

    const exact = await prisma.products.findFirst({
      where: {
        name: { equals: description, mode: 'insensitive' },
        state: { not: 'archived' },
      },
      select: { id: true, name: true, sku: true },
    });
    if (exact) {
      results.push({
        read_as: description,
        matched: true,
        ...exact,
        matched_by: 'name',
      });
      continue;
    }

    const candidates = await prisma.products.findMany({
      where: {
        name: { contains: firstWord(description), mode: 'insensitive' },
        state: { not: 'archived' },
      },
      select: { id: true, name: true, sku: true },
      take: MAX_CANDIDATES,
    });

    results.push({ read_as: description, matched: false, candidates });
  }

  return results;
}

/**
 * Cross-checks identity documents against people who already belong to THIS
 * store.
 *
 * The store predicate is not optional decoration: `StorePrismaService.users`
 * returns the **unscoped** delegate (it is documented as an organization-level
 * model), so a bare `findFirst` on `document_number` would answer with a person
 * from another tenant — leaking that the document exists and their name. Same
 * predicate `customers.tools.ts:88` spreads into every customer query, and for
 * the same reason.
 */
async function matchPeople(
  prisma: StorePrismaService,
  documents: any[],
  storeId: number | undefined,
) {
  const results: unknown[] = [];

  if (!storeId) {
    return [{ matched: false, reason: 'Sin tienda en contexto.' }];
  }

  for (const raw of documents.slice(0, 60)) {
    const document = String(raw ?? '').trim();
    if (!document) continue;

    const found = await prisma.users.findFirst({
      where: {
        document_number: document,
        store_users: { some: { store_id: storeId } },
      },
      select: { id: true, first_name: true, last_name: true },
    });

    results.push(
      found
        ? {
            document,
            matched: true,
            id: found.id,
            name: `${found.first_name} ${found.last_name ?? ''}`.trim(),
          }
        : { document, matched: false },
    );
  }

  return results;
}

async function listExpenseCategories(prisma: StorePrismaService) {
  const rows = await prisma.expense_categories.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 40,
  });

  return rows;
}

function countUnmatched(result: Record<string, unknown>): number {
  let unmatched = 0;

  const supplier = result.supplier as { matched?: boolean } | undefined;
  if (supplier && supplier.matched === false) unmatched += 1;

  for (const key of ['items', 'people']) {
    const list = result[key] as Array<{ matched?: boolean }> | undefined;
    if (Array.isArray(list)) {
      unmatched += list.filter((entry) => entry?.matched === false).length;
    }
  }

  return unmatched;
}

/**
 * The longest leading token of a name, used as the `contains` needle.
 *
 * Beats using the whole string: OCR routinely mangles the tail of a product
 * name ("Coca Cola 1.5L x12" → "Coca Cola 1.5Lx12"), while the head survives.
 */
function firstWord(value: string): string {
  const parts = value.split(/\s+/).filter((part) => part.length > 2);
  return (parts[0] ?? value).slice(0, 24);
}
