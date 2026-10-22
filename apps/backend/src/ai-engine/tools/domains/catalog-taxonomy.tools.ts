import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { CategoriesService } from '../../../domains/store/categories/categories.service';
import { BrandsService } from '../../../domains/store/brands/brands.service';
import {
  AssignProductsDto as AssignCategoryProductsDto,
  MAX_ASSIGN_PRODUCT_IDS,
} from '../../../domains/store/categories/dto';
import { AssignProductsDto as AssignBrandProductsDto } from '../../../domains/store/brands/dto';

/**
 * Tools de taxonomía del catálogo (categorías y marcas): dos lecturas y dos
 * escrituras de asignación masiva. Doctrina de `update_product`: el `preview`
 * es proyección (no escribe), el `handler` re-verifica y NO lanza, devuelve
 * `{error, next_step}`. Se registran desde `CategoriesModule` y `BrandsModule`.
 */

export interface CategoryToolDeps {
  categoriesService: CategoriesService;
}

export interface BrandToolDeps {
  brandsService: BrandsService;
}

const DOMAIN = 'products';
const MAX_PRODUCT_IDS = MAX_ASSIGN_PRODUCT_IDS;
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 50;
/** Tope de nombres que se listan al pedir que el usuario elija. */
const AMBIGUOUS_NAMES_SHOWN = 5;

type Resolution<T> =
  | { ok: true; value: T }
  | { ok: false; label: string; message: string; nextStep?: string };

function failure(
  label: string,
  message: string,
  nextStep?: string,
): { ok: false; label: string; message: string; nextStep?: string } {
  return { ok: false, label, message, nextStep };
}

function previewError(label: string, message: string): ToolPreview {
  return { status: 'error', target: label, changes: [], message, domain: DOMAIN };
}

/** Siempre lleva `next_step`: es lo que el registry reconoce como fallo (nunca como "aplicado"). */
function toolError(message: string, nextStep?: string): string {
  return JSON.stringify({
    error: message,
    next_step:
      nextStep ??
      'Explícale al usuario lo que pasó con sus palabras; no repitas la misma llamada sin cambiar algo.',
  });
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function plural(count: number): string {
  return count === 1 ? 'producto' : 'productos';
}

function formatIds(ids: number[]): string {
  const shown = ids.slice(0, 10).join(', ');
  return ids.length > 10 ? `${shown} y ${ids.length - 10} más` : shown;
}

/** Traduce una excepción del dominio a texto que el modelo pueda narrar. */
function describeError(error: unknown): { code?: string; message: string } {
  if (error instanceof HttpException) {
    const response = error.getResponse() as
      | {
          message?: unknown;
          error_code?: string;
          details?: { invalid_product_ids?: unknown };
        }
      | string;
    if (typeof response === 'string') return { message: response };
    const code = response?.error_code;

    if (code === 'PROD_FIND_001') {
      const invalid = Array.isArray(response.details?.invalid_product_ids)
        ? (response.details?.invalid_product_ids as unknown[])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id))
        : [];
      return {
        code,
        message: invalid.length
          ? `Estos productos no existen en la tienda: ${formatIds(invalid)}.`
          : 'Alguno de los productos no existe en la tienda.',
      };
    }
    if (code === 'CAT_FIND_001') {
      return { code, message: 'La categoría ya no existe o está archivada.' };
    }
    if (code === 'BRAND_FIND_001') {
      return { code, message: 'La marca ya no existe o está archivada.' };
    }

    const raw = response?.message;
    const message = Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
    return { ...(code && { code }), message };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

/** Valida como lo haría el ValidationPipe global: las tools llaman al servicio directo. */
function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

interface TaxonomyKind {
  /** "categoría" / "marca" */
  noun: string;
  /** Tool de lectura que el modelo debe usar para elegir. */
  listTool: string;
  idKey: 'category_id' | 'brand_id';
  nameKey: 'category_name' | 'brand_name';
  findAll: (query: Record<string, unknown>) => Promise<any>;
  findOne: (id: number) => Promise<any>;
}

interface Assignment {
  target: { id: number; name: string };
  mode: 'add' | 'remove';
  productIds: number[];
}

/** Resuelve la categoría o marca destino por id o por nombre exacto (sin distinguir mayúsculas). */
async function resolveTarget(
  kind: TaxonomyKind,
  args: Record<string, any>,
): Promise<Resolution<{ id: number; name: string }>> {
  const fallbackLabel = `Asignar productos a ${kind.noun}`;
  const id = args[kind.idKey] != null ? toPositiveInt(args[kind.idKey]) : null;
  const name = cleanString(args[kind.nameKey]);

  if (args[kind.idKey] != null && !id) {
    return failure(
      fallbackLabel,
      `El identificador de la ${kind.noun} no es válido.`,
      `Consulta ${kind.listTool} para obtener el identificador correcto.`,
    );
  }

  if (id) {
    try {
      const row = await kind.findOne(id);
      if (!row || row.state === 'archived') {
        return failure(
          fallbackLabel,
          `La ${kind.noun} indicada no existe o está archivada.`,
          `Consulta ${kind.listTool} y pídele al usuario que elija una de la lista.`,
        );
      }
      return { ok: true, value: { id: row.id, name: String(row.name) } };
    } catch (error) {
      const { message } = describeError(error);
      return failure(
        fallbackLabel,
        message,
        `Consulta ${kind.listTool} y pídele al usuario que elija una de la lista.`,
      );
    }
  }

  if (!name) {
    return failure(
      fallbackLabel,
      `Falta indicar la ${kind.noun}.`,
      `Pregunta al usuario cuál ${kind.noun} quiere, apoyándote en ${kind.listTool}.`,
    );
  }

  let rows: any[] = [];
  try {
    const result = await kind.findAll({
      search: name,
      page: 1,
      limit: LIST_MAX_LIMIT,
    });
    rows = result?.data ?? [];
  } catch (error) {
    const { message } = describeError(error);
    return failure(fallbackLabel, message);
  }

  const wanted = name.toLowerCase();
  const matches = rows.filter(
    (row) => String(row.name ?? '').trim().toLowerCase() === wanted,
  );

  if (matches.length === 1) {
    return {
      ok: true,
      value: { id: matches[0].id, name: String(matches[0].name) },
    };
  }

  if (matches.length === 0) {
    const similar = rows
      .slice(0, AMBIGUOUS_NAMES_SHOWN)
      .map((row) => String(row.name));
    return failure(
      fallbackLabel,
      `No encontré ${kind.noun === 'marca' ? 'una marca' : 'una categoría'} llamada "${name}".`,
      similar.length
        ? `Opciones parecidas: ${similar.join(', ')}. Pregunta al usuario cuál quiere o consulta ${kind.listTool}.`
        : `Consulta ${kind.listTool} y pregunta al usuario cuál quiere.`,
    );
  }

  const names = matches
    .slice(0, AMBIGUOUS_NAMES_SHOWN)
    .map((row) => `${row.name} (${row.state === 'inactive' ? 'inactiva' : 'activa'})`);
  return failure(
    fallbackLabel,
    `Hay ${matches.length} ${kind.noun === 'marca' ? 'marcas' : 'categorías'} con el nombre "${name}".`,
    `Pídele al usuario que elija una: ${names.join(', ')}. Luego repite con su identificador (${kind.listTool}).`,
  );
}

/** Valida modo + ids y resuelve el destino. */
async function resolveAssignment(
  kind: TaxonomyKind,
  args: Record<string, any>,
): Promise<Resolution<Assignment>> {
  const mode = args.mode;
  if (mode !== 'add' && mode !== 'remove') {
    return failure(
      `Asignar productos a ${kind.noun}`,
      'Falta indicar si los productos se agregan o se quitan.',
      'Pregunta al usuario si quiere agregarlos o quitarlos.',
    );
  }

  const rawIds: unknown[] = Array.isArray(args.product_ids)
    ? args.product_ids
    : [];
  const productIds = [
    ...new Set(
      rawIds
        .map((value) => toPositiveInt(value))
        .filter((value): value is number => value !== null),
    ),
  ];
  if (!productIds.length) {
    return failure(
      `Asignar productos a ${kind.noun}`,
      'No hay productos válidos para asignar.',
      'Busca los productos con la búsqueda de productos y vuelve a proponer con sus identificadores.',
    );
  }
  if (productIds.length > MAX_PRODUCT_IDS) {
    return failure(
      `Asignar productos a ${kind.noun}`,
      `Son demasiados productos de una vez: recibí ${productIds.length} y el máximo es ${MAX_PRODUCT_IDS}.`,
      `Divide la lista en grupos de ${MAX_PRODUCT_IDS} o menos.`,
    );
  }

  const target = await resolveTarget(kind, args);
  if (!target.ok) return target;
  return { ok: true, value: { target: target.value, mode, productIds } };
}

function assignSchema(kind: 'category' | 'brand') {
  const isCategory = kind === 'category';
  const noun = isCategory ? 'categoría' : 'marca';
  const listTool = isCategory ? 'list_categories' : 'list_brands';
  return {
    type: 'object',
    properties: {
      [`${kind}_id`]: {
        type: 'number',
        description: `Identificador de la ${noun}, obtenido con ${listTool}. Si no lo tienes, envía ${kind}_name.`,
      },
      [`${kind}_name`]: {
        type: 'string',
        description: `Nombre exacto de la ${noun}. Se usa solo si no envías ${kind}_id; si hay varias con ese nombre se le pedirá al usuario que elija.`,
      },
      mode: {
        type: 'string',
        enum: ['add', 'remove'],
        description: `add: poner los productos en la ${noun}. remove: sacarlos de la ${noun}.`,
      },
      product_ids: {
        type: 'array',
        items: { type: 'number' },
        description: `Identificadores de los productos (de 1 a ${MAX_PRODUCT_IDS}), obtenidos con la búsqueda de productos.`,
      },
    },
    required: ['mode', 'product_ids'],
  };
}

function listSchema(noun: string) {
  return {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: `Texto para filtrar por nombre de ${noun}.`,
      },
      include_inactive: {
        type: 'boolean',
        description: `Incluir también las ${noun === 'marca' ? 'marcas' : 'categorías'} inactivas. Por defecto solo las activas.`,
      },
      limit: {
        type: 'number',
        description: `Cuántas devolver. Por defecto ${LIST_DEFAULT_LIMIT}, máximo ${LIST_MAX_LIMIT}.`,
      },
    },
  };
}

async function runList(
  kind: TaxonomyKind,
  plural_key: 'categories' | 'brands',
  args: Record<string, any>,
  context: { store_id?: number },
): Promise<string> {
  if (!context.store_id) {
    return toolError(
      'Sin tienda en contexto: esto se consulta siempre dentro de una tienda.',
    );
  }
  const limit = clampLimit(args.limit, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
  const query: Record<string, unknown> = { page: 1, limit };
  const search = cleanString(args.search);
  if (search) query.search = search;
  if (args.include_inactive !== true) query.state = 'active';

  try {
    const result = await kind.findAll(query);
    const rows: any[] = result?.data ?? [];
    const total = Number(result?.meta?.total ?? rows.length);
    return JSON.stringify({
      [plural_key]: rows.map((row) => ({
        id: row.id,
        name: row.name,
        state: row.state,
        product_count: Number(row.product_count ?? 0),
      })),
      total,
      shown: rows.length,
      has_more: total > rows.length,
    });
  } catch (error) {
    const { message } = describeError(error);
    return toolError(
      `No se pudo consultar: ${message}`,
      'Intenta de nuevo en un momento.',
    );
  }
}

export function createCategoryTools(deps: CategoryToolDeps): RegisteredTool[] {
  const { categoriesService } = deps;
  const kind: TaxonomyKind = {
    noun: 'categoría',
    listTool: 'list_categories',
    idKey: 'category_id',
    nameKey: 'category_name',
    findAll: (query) => categoriesService.findAll(query as any),
    findOne: (id) => categoriesService.findOne(id, { includeInactive: true }),
  };

  return [
    {
      name: 'list_categories',
      version: '1',
      domain: DOMAIN,
      readOnly: true,
      description:
        'Lista las categorías de productos de la tienda con cuántos productos tiene cada una. Úsala para responder "qué categorías tengo" o "cuántos productos hay en la categoría X", y para obtener el identificador de una categoría antes de asignarle productos. No incluye las archivadas.',
      parameters: listSchema('categoría'),
      requiredPermissions: ['store:categories:read'],
      handler: async (args, context) =>
        runList(kind, 'categories', args, context),
    },

    {
      name: 'assign_products_to_category',
      version: '1',
      domain: DOMAIN,
      requiresConfirmation: true,
      description:
        `Pone varios productos en una categoría, o los saca de ella, en una sola operación (hasta ${MAX_PRODUCT_IDS}). Un producto puede estar en varias categorías: agregar no lo quita de las demás. Antes de escribir, obtén el identificador de la categoría con list_categories y los de los productos con la búsqueda de productos; no inventes identificadores. Solo cambia la pertenencia a la categoría, no edita los productos.`,
      parameters: assignSchema('category'),
      requiredPermissions: ['store:categories:update'],
      preview: async (args) => {
        const resolved = await resolveAssignment(kind, args);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
          );
        }
        const { target, mode, productIds } = resolved.value;
        const label = `Categoría ${target.name}`;
        try {
          // Mismo contrato que el preview de marcas: valida categoría y
          // productos (PROD_FIND_001 + invalid_product_ids) antes de proyectar.
          const projection = await categoriesService.previewAssignProducts(
            target.id,
            { action: mode, product_ids: productIds },
          );
          const current = await categoriesService.getProductIds(target.id);
          const alreadyIn = projection.already_in_category;
          const notIn = productIds.length - alreadyIn;

          if (mode === 'add') {
            const message =
              alreadyIn > 0
                ? `Se agregarán ${notIn} ${plural(notIn)} a la categoría ${target.name} (${alreadyIn} ya ${alreadyIn === 1 ? 'estaba' : 'estaban'} en ella).`
                : `Se agregarán ${notIn} ${plural(notIn)} a la categoría ${target.name}.`;
            return {
              status: 'ok',
              target: label,
              changes: [
                {
                  field: 'category_products',
                  label: 'Productos en la categoría',
                  from: current.total,
                  to: current.total + notIn,
                },
              ],
              message,
              domain: DOMAIN,
            };
          }

          const message =
            notIn > 0
              ? `Se quitarán ${alreadyIn} ${plural(alreadyIn)} de la categoría ${target.name} (${notIn} no ${notIn === 1 ? 'estaba' : 'estaban'} en ella).`
              : `Se quitarán ${alreadyIn} ${plural(alreadyIn)} de la categoría ${target.name}.`;
          return {
            status: alreadyIn === 0 ? 'warning' : 'ok',
            target: label,
            changes: [
              {
                field: 'category_products',
                label: 'Productos en la categoría',
                from: current.total,
                to: current.total - alreadyIn,
              },
            ],
            message,
            domain: DOMAIN,
          };
        } catch (error) {
          const { message } = describeError(error);
          return previewError(label, message);
        }
      },
      handler: async (args) => {
        try {
          // Re-verificación: la categoría pudo archivarse o renombrarse.
          const resolved = await resolveAssignment(kind, args);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }
          const { target, mode, productIds } = resolved.value;

          const validated = toValidatedDto(AssignCategoryProductsDto, {
            action: mode,
            product_ids: productIds,
          });
          if (!validated.ok) return toolError(validated.message);

          const result = await categoriesService.assignProducts(
            target.id,
            validated.dto,
          );

          const summary =
            mode === 'add'
              ? `Categoría ${target.name}: se agregaron ${result.added} ${plural(result.added)}${result.unchanged ? ` (${result.unchanged} ya ${result.unchanged === 1 ? 'estaba' : 'estaban'} en ella)` : ''}.`
              : `Categoría ${target.name}: se quitaron ${result.removed} ${plural(result.removed)}${result.unchanged ? ` (${result.unchanged} no ${result.unchanged === 1 ? 'estaba' : 'estaban'} en ella)` : ''}.`;

          return JSON.stringify({
            summary,
            data: {
              category: { id: target.id, name: target.name },
              added: result.added,
              removed: result.removed,
              unchanged: result.unchanged,
            },
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo actualizar la categoría: ${message}`,
            code === 'PROD_FIND_001'
              ? 'Busca de nuevo los productos con la búsqueda de productos y vuelve a proponer solo con los que existen.'
              : undefined,
          );
        }
      },
    },
  ];
}

export function createBrandTools(deps: BrandToolDeps): RegisteredTool[] {
  const { brandsService } = deps;
  const kind: TaxonomyKind = {
    noun: 'marca',
    listTool: 'list_brands',
    idKey: 'brand_id',
    nameKey: 'brand_name',
    findAll: (query) => brandsService.findAll(query as any),
    findOne: (id) => brandsService.findOne(id, { includeInactive: true }),
  };

  return [
    {
      name: 'list_brands',
      version: '1',
      domain: DOMAIN,
      readOnly: true,
      description:
        'Lista las marcas de la tienda con cuántos productos tiene cada una. Úsala para responder "qué marcas manejo" o "cuántos productos tiene la marca X", y para obtener el identificador de una marca antes de asignarle productos. No incluye las archivadas.',
      parameters: listSchema('marca'),
      requiredPermissions: ['store:brands:read'],
      handler: async (args, context) => runList(kind, 'brands', args, context),
    },

    {
      name: 'assign_products_to_brand',
      version: '1',
      domain: DOMAIN,
      requiresConfirmation: true,
      description:
        `Asigna una marca a varios productos, o se la quita, en una sola operación (hasta ${MAX_PRODUCT_IDS}). Un producto tiene una sola marca: si ya tenía otra, pasa a la nueva y la propuesta avisa cuántos productos cambian de marca. Para quitar la marca usa mode remove con la marca que tienen actualmente. Antes de escribir, obtén el identificador de la marca con list_brands y los de los productos con la búsqueda de productos; no inventes identificadores. Solo cambia la marca, no edita los productos.`,
      parameters: assignSchema('brand'),
      requiredPermissions: ['store:brands:update'],
      preview: async (args) => {
        const resolved = await resolveAssignment(kind, args);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
          );
        }
        const { target, mode, productIds } = resolved.value;
        const label = `Marca ${target.name}`;
        try {
          if (mode === 'remove') {
            const current = await brandsService.getProductIds(target.id);
            const inBrand = new Set(current.product_ids);
            const toRemove = productIds.filter((id) => inBrand.has(id)).length;
            const notIn = productIds.length - toRemove;
            return {
              status: toRemove === 0 ? 'warning' : 'ok',
              target: label,
              changes: [
                {
                  field: 'brand_products',
                  label: 'Productos con esta marca',
                  from: current.total,
                  to: current.total - toRemove,
                },
              ],
              message:
                notIn > 0
                  ? `A ${toRemove} ${plural(toRemove)} se les quitará la marca ${target.name} (${notIn} no ${notIn === 1 ? 'la tenía' : 'la tenían'}). Quedarán sin marca.`
                  : `A ${toRemove} ${plural(toRemove)} se les quitará la marca ${target.name}. Quedarán sin marca.`,
              domain: DOMAIN,
            };
          }

          const projection = await brandsService.previewAssignProducts(
            target.id,
            { product_ids: productIds },
          );
          const moved = projection.to_move.reduce(
            (sum, entry) => sum + entry.count,
            0,
          );
          const toAssign = projection.without_brand + moved;

          const changes: ToolPreview['changes'] = [
            {
              field: 'brand_products',
              label: `Productos que reciben la marca ${target.name}`,
              from: projection.already_in_brand,
              to: projection.already_in_brand + toAssign,
            },
            ...projection.to_move.map((entry) => ({
              field: `moved_from_brand_${entry.brand_id}`,
              label: `Productos que dejan la marca ${entry.brand_name}`,
              from: entry.count,
              to: 0,
            })),
          ];

          const parts = [
            `Se asignará la marca ${target.name} a ${toAssign} ${plural(toAssign)}${projection.already_in_brand ? ` (${projection.already_in_brand} ya ${projection.already_in_brand === 1 ? 'la tenía' : 'la tenían'})` : ''}.`,
          ];
          if (projection.to_move.length) {
            const leaving = projection.to_move
              .map(
                (entry) =>
                  `${entry.count} ${plural(entry.count)} dejarán la marca ${entry.brand_name}`,
              )
              .join('; ');
            parts.push(
              `Atención: ${leaving}, porque un producto solo puede tener una marca.`,
            );
          }

          return {
            status: projection.to_move.length ? 'warning' : 'ok',
            target: label,
            changes,
            message: parts.join(' '),
            domain: DOMAIN,
          };
        } catch (error) {
          const { message } = describeError(error);
          return previewError(label, message);
        }
      },
      handler: async (args) => {
        try {
          // Re-verificación: la marca pudo archivarse; el servicio revalida
          // los productos y calcula de nuevo de qué marcas se mueven.
          const resolved = await resolveAssignment(kind, args);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }
          const { target, mode, productIds } = resolved.value;

          const validated = toValidatedDto(AssignBrandProductsDto, {
            action: mode,
            product_ids: productIds,
          });
          if (!validated.ok) return toolError(validated.message);

          const result = await brandsService.assignProducts(
            target.id,
            validated.dto,
          );
          const moved = result.moved_from_brands ?? [];

          let summary =
            mode === 'add'
              ? `Marca ${target.name}: se asignó a ${result.added} ${plural(result.added)}${result.unchanged ? ` (${result.unchanged} ya la ${result.unchanged === 1 ? 'tenía' : 'tenían'})` : ''}.`
              : `Marca ${target.name}: se quitó a ${result.removed} ${plural(result.removed)}${result.unchanged ? ` (${result.unchanged} no la ${result.unchanged === 1 ? 'tenía' : 'tenían'})` : ''}.`;
          if (moved.length) {
            summary += ` ${moved
              .map(
                (entry) =>
                  `${entry.count} ${plural(entry.count)} dejaron la marca ${entry.brand_name}`,
              )
              .join('; ')}.`;
          }

          return JSON.stringify({
            summary,
            data: {
              brand: { id: target.id, name: target.name },
              added: result.added,
              removed: result.removed,
              unchanged: result.unchanged,
              moved_from_brands: moved,
            },
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo actualizar la marca: ${message}`,
            code === 'PROD_FIND_001'
              ? 'Busca de nuevo los productos con la búsqueda de productos y vuelve a proponer solo con los que existen.'
              : undefined,
          );
        }
      },
    },
  ];
}
