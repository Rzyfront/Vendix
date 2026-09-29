import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { RecipesService } from '../../../domains/store/recipes/recipes.service';
import { CreateRecipeDto } from '../../../domains/store/recipes/dto/create-recipe.dto';
import { UpdateRecipeDto } from '../../../domains/store/recipes/dto/update-recipe.dto';
import { CreateRecipeItemDto } from '../../../domains/store/recipes/dto/create-recipe-item.dto';
import { UpdateRecipeItemDto } from '../../../domains/store/recipes/dto/update-recipe-item.dto';
import { RecipeItemInputDto } from '../../../domains/store/recipes/dto/replace-recipe-items.dto';
import { MenusService } from '../../../domains/store/menus/menus.service';
import { MenuSectionsService } from '../../../domains/store/menus/menu-sections.service';
import { MenuAvailabilityService } from '../../../domains/store/menus/menu-availability.service';
import { MenuAvailabilityCheckerService } from '../../../domains/store/menus/menu-availability-checker.service';
import { MenuEngineeringService } from '../../../domains/store/menus/menu-engineering.service';
import {
  CreateMenuDto,
  UpdateMenuDto,
} from '../../../domains/store/menus/dto/menu.dto';
import {
  AddMenuSectionItemDto,
  CreateMenuSectionDto,
  UpdateMenuSectionDto,
} from '../../../domains/store/menus/dto/menu-section.dto';
import {
  CreateAvailabilityWindowDto,
  UpdateAvailabilityWindowDto,
} from '../../../domains/store/menus/dto/menu-availability.dto';
import { ProductionOrdersService } from '../../../domains/store/production/production-orders.service';
import {
  CompleteProductionOrderDto,
  CreateProductionOrderDto,
  UpdateProductionOrderDto,
} from '../../../domains/store/production/dto/production-order.dto';

export interface RecipeToolDeps {
  recipesService: RecipesService;
}

export interface MenuToolDeps {
  menusService: MenusService;
  menuSectionsService: MenuSectionsService;
  menuAvailabilityService: MenuAvailabilityService;
  menuAvailabilityChecker: MenuAvailabilityCheckerService;
  menuEngineeringService: MenuEngineeringService;
}

export interface ProductionToolDeps {
  productionOrdersService: ProductionOrdersService;
}

const RECIPE_ACTIONS = [
  'create',
  'update',
  'set-items',
  'add-item',
  'update-item',
  'remove-item',
  'delete',
  'restore',
];

const MENU_ACTIONS = [
  'create-menu',
  'update-menu',
  'delete-menu',
  'create-section',
  'update-section',
  'delete-section',
  'add-item',
  'remove-item',
  'add-window',
  'update-window',
  'delete-window',
];

const PRODUCTION_ACTIONS = [
  'create',
  'update',
  'start',
  'complete',
  'cancel',
];

function guidedError(error: string, nextStep?: string): string {
  return JSON.stringify({
    error,
    ...(nextStep ? { next_step: nextStep } : {}),
  });
}

function previewError(target: string, message: string): ToolPreview {
  return { status: 'error', target, changes: [], message, domain: 'menus' };
}

function noStore(what: string): string {
  return guidedError(
    `Sin tienda en contexto: ${what} siempre vive dentro de una tienda.`,
  );
}

function describeError(error: unknown): { code?: string; message: string } {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    const message =
      typeof response === 'string'
        ? response
        : (response?.message ?? error.message);
    return { code: error.errorCode, message };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

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

/**
 * Regla de unidades enteras mínimas (vendix-restaurant-ops § Unit rule): el
 * inventario trabaja en `Int`, así que cada insumo se consume en su unidad
 * mínima entera (gramos, ml, unidades). El DTO acepta decimales, por eso la
 * tool los rechaza en el borde con remedio (usar la unidad mínima) en vez
 * de dejar que el redondeo acumule merma silenciosa. Sin migrar a Decimal.
 */
function assertIntegerQuantity(value: unknown): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 'quantity debe ser mayor a 0.';
  }
  if (!Number.isInteger(parsed)) {
    return (
      `quantity ${value} es fraccionaria: las recetas consumen unidades enteras mínimas ` +
      `(gramos, ml o unidades según el insumo). Convierte a la unidad mínima ` +
      `(ej. 0.5 kg → 500 gramos) y reintenta sin decimales.`
    );
  }
  return null;
}

function recipeLabel(recipe: any): string {
  const name =
    recipe?.product?.name ??
    recipe?.product_name ??
    `#${recipe?.product_id ?? '?'}`;
  const variant = recipe?.product_variant?.name
    ? ` (${recipe.product_variant.name})`
    : '';
  return `${name}${variant} [receta #${recipe?.id ?? '?'}]`;
}

/**
 * K-12 — Recetas/BOM (paso 13, P1).
 *
 * Wrapper fino sobre `RecipesService`: la tool valida el borde (cantidades
 * enteras, DTOs reales) y el servicio aplica la regla de negocio dura —
 * anti-ciclos por DFS transitivo (`RECIPE_CYCLE_DETECTED`) y
 * autorreferencia (`RECIPE_SELF_REFERENCE`). La lectura habilitante es
 * `get_product` (plato e insumos por nombre humano); el preview lee la
 * receta actual con `findOne` y el handler la re-lee antes de mutar.
 */
export function createRecipeTools(deps: RecipeToolDeps): RegisteredTool[] {
  const { recipesService } = deps;

  return [
    // ─── K-12: manage_recipe (WRITE) ─────────────────────────────
    {
      name: 'manage_recipe',
      version: '1',
      domain: 'menus',
      description:
        'Crea y edita recetas (BOM) de platos preparados: create (cabecera para un producto), update (rendimiento/merma/notas), set-items (reemplaza todos los insumos), add-item/update-item/remove-item (líneas sueltas) y delete/restore (borrado suave). Lee PRIMERO el plato y los insumos con get_product (por nombre humano). Cantidades en unidades enteras mínimas (gramos/ml/unidades): los decimales se rechazan. Un insumo que cierre un ciclo de sub-recetas se rechaza con RECIPE_CYCLE_DETECTED.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: RECIPE_ACTIONS,
            description:
              'create, update, set-items, add-item, update-item, remove-item, delete o restore.',
          },
          recipe_id: {
            type: 'number',
            description:
              'ID de la receta (requerido en todo salvo create).',
          },
          product_id: {
            type: 'number',
            description:
              'Plato preparado dueño de la receta (requerido en create; resuélvelo con get_product).',
          },
          product_variant_id: {
            type: 'number',
            description:
              'Variante del plato (obligatoria si el producto tiene variantes, prohibida si no).',
          },
          yield_quantity: {
            type: 'number',
            description: 'Rendimiento por lote (requerido en create).',
          },
          yield_unit: {
            type: 'string',
            description:
              'Unidad del rendimiento (ej. "porción", requerida en create).',
          },
          waste_percent: {
            type: 'number',
            description: 'Merma global de la receta, 0-100.',
          },
          preparation_notes: {
            type: 'string',
            description: 'Notas de preparación.',
          },
          is_active: {
            type: 'boolean',
            description: 'Activa/desactiva la receta.',
          },
          items: {
            type: 'array',
            description:
              'Insumos (requerido en set-items): component_product_id + quantity ENTERA en unidad mínima + waste_percent/waste_mode opcionales.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                component_product_id: { type: 'number' },
                quantity: { type: 'number' },
                waste_percent: { type: 'number' },
                waste_mode: { type: 'string' },
                waste_absolute: { type: 'number' },
                is_optional: { type: 'boolean' },
              },
              required: ['component_product_id', 'quantity'],
            },
          },
          component_product_id: {
            type: 'number',
            description: 'Insumo (requerido en add-item).',
          },
          quantity: {
            type: 'number',
            description:
              'Cantidad ENTERA en unidad mínima (requerida en add-item; opcional en update-item).',
          },
          item_id: {
            type: 'number',
            description:
              'ID de la línea (requerido en update-item y remove-item).',
          },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:recipes:create',
        'store:recipes:update',
        'store:recipes:delete',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Receta',
            'Sin tienda en contexto: las recetas siempre viven dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');
        if (!RECIPE_ACTIONS.includes(action)) {
          return previewError(
            'Receta',
            `action "${action}" inválida. Usa ${RECIPE_ACTIONS.join(', ')}.`,
          );
        }

        try {
          if (action === 'create') {
            const productId = toPositiveInt(args.product_id);
            if (!productId) {
              return previewError(
                'Creación de receta',
                'create exige product_id. Lee el plato con get_product primero.',
              );
            }
            return {
              status: 'ok',
              target: `Creación de receta — producto #${productId}`,
              changes: [
                ...(args.yield_quantity !== undefined
                  ? [
                      {
                        field: 'yield_quantity',
                        label: 'Rendimiento',
                        from: null,
                        to: `${args.yield_quantity} ${args.yield_unit ?? ''}`.trim(),
                      },
                    ]
                  : []),
              ],
              message:
                'Crea solo la cabecera: después agrega los insumos con set-items o add-item.',
              domain: 'menus',
            };
          }

          const recipeId = toPositiveInt(args.recipe_id);
          if (!recipeId) {
            return previewError(
              'Receta',
              `${action} exige recipe_id.`,
            );
          }
          const recipe = await recipesService.findOne(recipeId);
          const label = recipeLabel(recipe);

          if (action === 'delete' || action === 'restore') {
            return {
              status: 'warning',
              target: `${action === 'delete' ? 'Borrado' : 'Restauración'} — ${label}`,
              changes: [
                {
                  field: 'deleted',
                  label: 'Receta',
                  from: action === 'delete' ? 'activa' : 'borrada',
                  to: action === 'delete' ? 'borrada' : 'activa',
                },
              ],
              domain: 'menus',
            };
          }

          if (action === 'update') {
            const fields = [
              'yield_quantity',
              'yield_unit',
              'waste_percent',
              'preparation_notes',
              'is_active',
            ].filter((field) => args[field] !== undefined);
            if (!fields.length) {
              return previewError(
                label,
                'update exige al menos un campo: yield_quantity, yield_unit, waste_percent, preparation_notes o is_active.',
              );
            }
            return {
              status: 'ok',
              target: `Edición — ${label}`,
              changes: fields.map((field) => ({
                field,
                label: field,
                from: (recipe as any)?.[field] ?? null,
                to: args[field],
              })),
              domain: 'menus',
            };
          }

          if (action === 'set-items') {
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return previewError(
                label,
                'set-items exige al menos 1 insumo en items.',
              );
            }
            for (const [index, line] of items.entries()) {
              const problem = assertIntegerQuantity(line?.quantity);
              if (problem) {
                return previewError(
                  label,
                  `items[${index}]: ${problem}`,
                );
              }
            }
            const detail = items
              .map(
                (line: any) =>
                  `#${line.component_product_id} x${line.quantity}`,
              )
              .join('; ');
            return {
              status: 'warning',
              target: `Reemplazo de insumos — ${label}`,
              changes: [
                {
                  field: 'items',
                  label: 'Insumos',
                  from: `${((recipe as any)?.recipe_items ?? []).length} línea(s) actuales`,
                  to: detail,
                },
              ],
              message:
                'Reemplaza TODOS los insumos: las líneas actuales se pierden. El servicio rechaza ciclos (RECIPE_CYCLE_DETECTED).',
              domain: 'menus',
            };
          }

          if (action === 'add-item') {
            const componentId = toPositiveInt(args.component_product_id);
            if (!componentId) {
              return previewError(
                label,
                'add-item exige component_product_id. Lee el insumo con get_product primero.',
              );
            }
            const problem = assertIntegerQuantity(args.quantity);
            if (problem) {
              return previewError(label, problem);
            }
            return {
              status: 'ok',
              target: `Agregar insumo — ${label}`,
              changes: [
                {
                  field: 'item',
                  label: 'Insumo',
                  from: null,
                  to: `#${componentId} x${args.quantity}`,
                },
              ],
              domain: 'menus',
            };
          }

          const itemId = toPositiveInt(args.item_id);
          if (!itemId) {
            return previewError(
              label,
              `${action} exige item_id.`,
            );
          }
          if (action === 'remove-item') {
            return {
              status: 'warning',
              target: `Quitar insumo — ${label}`,
              changes: [
                {
                  field: `item:${itemId}`,
                  label: 'Línea',
                  from: 'en receta',
                  to: 'eliminada',
                },
              ],
              domain: 'menus',
            };
          }
          if (args.quantity !== undefined) {
            const problem = assertIntegerQuantity(args.quantity);
            if (problem) {
              return previewError(label, problem);
            }
          }
          return {
            status: 'ok',
            target: `Editar línea — ${label}`,
            changes: [
              {
                field: `item:${itemId}`,
                label: 'Línea',
                from: 'actual',
                to: args.quantity !== undefined
                  ? `x${args.quantity}`
                  : 'cambios de merma',
              },
            ],
            domain: 'menus',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Receta', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la gestión de recetas');
        const action = String(args.action ?? '');

        try {
          if (action === 'create') {
            const checked = toValidatedDto(CreateRecipeDto, {
              ...(args.product_id !== undefined
                ? { product_id: Number(args.product_id) }
                : {}),
              ...(args.product_variant_id !== undefined
                ? { product_variant_id: Number(args.product_variant_id) }
                : {}),
              ...(args.yield_quantity !== undefined
                ? { yield_quantity: Number(args.yield_quantity) }
                : {}),
              ...(args.yield_unit ? { yield_unit: String(args.yield_unit) } : {}),
              ...(args.waste_percent !== undefined
                ? { waste_percent: Number(args.waste_percent) }
                : {}),
              ...(args.preparation_notes
                ? { preparation_notes: String(args.preparation_notes) }
                : {}),
              ...(args.is_active !== undefined
                ? { is_active: Boolean(args.is_active) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const created = await recipesService.create(checked.dto);
            return JSON.stringify({
              resumen: `Receta #${(created as any)?.id} creada para el producto #${args.product_id}. Agrega insumos con set-items o add-item.`,
              recipe_id: (created as any)?.id,
            });
          }

          const recipeId = toPositiveInt(args.recipe_id);
          if (!recipeId) {
            return guidedError(
              `${action} exige recipe_id.`,
              'Lee el plato con get_product para ubicar su receta.',
            );
          }
          // Re-verificación: la receta pudo cambiar tras el preview.
          const current = await recipesService.findOne(recipeId);
          const label = recipeLabel(current);

          if (action === 'delete') {
            await recipesService.softDelete(recipeId);
            return JSON.stringify({
              resumen: `${label}: receta borrada (suave, restaurable).`,
              recipe_id: recipeId,
            });
          }
          if (action === 'restore') {
            await recipesService.restore(recipeId);
            return JSON.stringify({
              resumen: `${label}: receta restaurada.`,
              recipe_id: recipeId,
            });
          }

          if (action === 'update') {
            const checked = toValidatedDto(UpdateRecipeDto, {
              ...(args.yield_quantity !== undefined
                ? { yield_quantity: Number(args.yield_quantity) }
                : {}),
              ...(args.yield_unit !== undefined
                ? { yield_unit: String(args.yield_unit) }
                : {}),
              ...(args.waste_percent !== undefined
                ? { waste_percent: Number(args.waste_percent) }
                : {}),
              ...(args.preparation_notes !== undefined
                ? { preparation_notes: String(args.preparation_notes) }
                : {}),
              ...(args.is_active !== undefined
                ? { is_active: Boolean(args.is_active) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await recipesService.update(recipeId, checked.dto);
            return JSON.stringify({
              resumen: `${label}: receta actualizada.`,
              recipe_id: recipeId,
            });
          }

          if (action === 'set-items') {
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return guidedError('set-items exige al menos 1 insumo en items.');
            }
            for (const [index, line] of items.entries()) {
              const problem = assertIntegerQuantity(line?.quantity);
              if (problem) {
                return guidedError(
                  `items[${index}]: ${problem}`,
                  'Convierte a la unidad mínima entera del insumo (gramos, ml o unidades).',
                );
              }
            }
            const lines = items.map((line: any) =>
              plainToInstance(
                RecipeItemInputDto,
                {
                  ...(line.id !== undefined ? { id: Number(line.id) } : {}),
                  component_product_id: Number(line.component_product_id),
                  quantity: Number(line.quantity),
                  ...(line.waste_percent !== undefined
                    ? { waste_percent: Number(line.waste_percent) }
                    : {}),
                  ...(line.waste_mode
                    ? { waste_mode: String(line.waste_mode) }
                    : {}),
                  ...(line.waste_absolute !== undefined
                    ? { waste_absolute: Number(line.waste_absolute) }
                    : {}),
                  ...(line.is_optional !== undefined
                    ? { is_optional: Boolean(line.is_optional) }
                    : {}),
                },
                { enableImplicitConversion: true },
              ),
            );
            const violations = lines.flatMap((line) =>
              validateSync(line, {
                whitelist: true,
                forbidNonWhitelisted: true,
              }),
            );
            if (violations.length) {
              const details = violations
                .flatMap((entry) => Object.values(entry.constraints ?? {}))
                .join('; ');
              return guidedError(
                `Los datos no pasaron la validación: ${details || 'revisa los insumos enviados'}.`,
              );
            }
            await recipesService.replaceItems(recipeId, lines);
            return JSON.stringify({
              resumen: `${label}: ${lines.length} insumo(s) en la receta (reemplazo total).`,
              recipe_id: recipeId,
            });
          }

          if (action === 'add-item') {
            const problem = assertIntegerQuantity(args.quantity);
            if (problem) {
              return guidedError(
                problem,
                'Convierte a la unidad mínima entera del insumo (gramos, ml o unidades).',
              );
            }
            const checked = toValidatedDto(CreateRecipeItemDto, {
              ...(args.component_product_id !== undefined
                ? {
                    component_product_id: Number(args.component_product_id),
                  }
                : {}),
              ...(args.quantity !== undefined
                ? { quantity: Number(args.quantity) }
                : {}),
              ...(args.waste_percent !== undefined
                ? { waste_percent: Number(args.waste_percent) }
                : {}),
              ...(args.waste_mode
                ? { waste_mode: String(args.waste_mode) }
                : {}),
              ...(args.waste_absolute !== undefined
                ? { waste_absolute: Number(args.waste_absolute) }
                : {}),
              ...(args.is_optional !== undefined
                ? { is_optional: Boolean(args.is_optional) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await recipesService.addItem(recipeId, checked.dto);
            return JSON.stringify({
              resumen: `${label}: insumo #${args.component_product_id} x${args.quantity} agregado.`,
              recipe_id: recipeId,
            });
          }

          const itemId = toPositiveInt(args.item_id);
          if (!itemId) {
            return guidedError(`${action} exige item_id.`);
          }
          if (action === 'remove-item') {
            await recipesService.removeItem(recipeId, itemId);
            return JSON.stringify({
              resumen: `${label}: línea #${itemId} eliminada.`,
              recipe_id: recipeId,
            });
          }
          if (action === 'update-item') {
            if (
              args.quantity !== undefined &&
              assertIntegerQuantity(args.quantity)
            ) {
              return guidedError(
                assertIntegerQuantity(args.quantity) as string,
                'Convierte a la unidad mínima entera del insumo (gramos, ml o unidades).',
              );
            }
            const checked = toValidatedDto(UpdateRecipeItemDto, {
              ...(args.quantity !== undefined
                ? { quantity: Number(args.quantity) }
                : {}),
              ...(args.waste_percent !== undefined
                ? { waste_percent: Number(args.waste_percent) }
                : {}),
              ...(args.waste_mode
                ? { waste_mode: String(args.waste_mode) }
                : {}),
              ...(args.waste_absolute !== undefined
                ? { waste_absolute: Number(args.waste_absolute) }
                : {}),
              ...(args.is_optional !== undefined
                ? { is_optional: Boolean(args.is_optional) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await recipesService.updateItem(recipeId, itemId, checked.dto);
            return JSON.stringify({
              resumen: `${label}: línea #${itemId} actualizada.`,
              recipe_id: recipeId,
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa ${RECIPE_ACTIONS.join(', ')}.`,
          );
        } catch (error) {
          const info = describeError(error);
          if (info.code === 'RECIPE_CYCLE_DETECTED') {
            return guidedError(
              `RECIPE_CYCLE_DETECTED: ${info.message || 'ese insumo cierra un ciclo de sub-recetas y no se puede agregar.'}`,
              'Revisa la cadena de sub-recetas (el insumo no puede contenerse a sí mismo, ni directa ni transitivamente) y elige otro insumo.',
            );
          }
          if (info.code === 'RECIPE_SELF_REFERENCE') {
            return guidedError(
              'Una receta no puede incluirse a sí misma como insumo.',
              'Elige un producto distinto al plato dueño de la receta.',
            );
          }
          return guidedError(
            `No pude gestionar la receta: ${info.message}`,
            'Lee el plato con get_product para verificar productos e insumos.',
          );
        }
      },
    },
  ];
}

const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

/**
 * K-13/K-14 — Menús/carta + ingeniería BCG (paso 13, P1/P2).
 *
 * - K-13 `manage_menu` cubre carta, secciones, platos por sección y
 *   ventanas de disponibilidad. Las ventanas validan `HH:mm` +
 *   `day_of_week` con el DTO real y se interpretan en la TZ de la tienda
 *   (la misma que `schedule-validation`: se reporta vía
 *   `MenuAvailabilityCheckerService.getStoreTimezone`, sin duplicar
 *   matemática de timezone).
 * - K-14 `analyze_menu_engineering` es read-only: matriz BCG
 *   (estrella/caballo/puzzle/perro) por popularidad × margen con costo
 *   de receta cuando existe.
 */
export function createMenuTools(deps: MenuToolDeps): RegisteredTool[] {
  const {
    menusService,
    menuSectionsService,
    menuAvailabilityService,
    menuAvailabilityChecker,
    menuEngineeringService,
  } = deps;

  async function storeTimezone(context: {
    store_id?: number;
  }): Promise<string> {
    try {
      return await menuAvailabilityChecker.getStoreTimezone(
        Number(context.store_id),
      );
    } catch {
      return 'America/Bogota';
    }
  }

  return [
    // ─── K-13: manage_menu (WRITE) ───────────────────────────────
    {
      name: 'manage_menu',
      version: '1',
      domain: 'menus',
      description:
        'Crea y edita la carta: create-menu/update-menu/delete-menu (cartas), create-section/update-section/delete-section (secciones), add-item/remove-item (platos por sección, con get_product para ubicarlos) y add-window/update-window/delete-window (disponibilidad por día HH:mm en la hora de la tienda). El preview muestra el cambio from→to y el handler re-lee la carta antes de mutar.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: MENU_ACTIONS,
            description:
              'create-menu, update-menu, delete-menu, create-section, update-section, delete-section, add-item, remove-item, add-window, update-window o delete-window.',
          },
          menu_id: {
            type: 'number',
            description:
              'ID de la carta (requerido en todo salvo create-menu).',
          },
          name: { type: 'string', description: 'Nombre (carta o sección).' },
          is_active: {
            type: 'boolean',
            description: 'Activa/desactiva la carta.',
          },
          section_id: {
            type: 'number',
            description:
              'ID de la sección (requerido en update/delete-section, add/remove-item y ventanas por sección).',
          },
          sort_order: {
            type: 'number',
            description: 'Orden dentro de la carta o sección.',
          },
          product_id: {
            type: 'number',
            description:
              'Plato a agregar a la sección (add-item; resuélvelo con get_product).',
          },
          item_id: {
            type: 'number',
            description: 'ID del plato en la sección (remove-item).',
          },
          window_id: {
            type: 'number',
            description:
              'ID de la ventana (requerido en update/delete-window).',
          },
          day_of_week: {
            type: 'number',
            description: 'Día 0-6 (domingo-sábado).',
          },
          start_time: {
            type: 'string',
            description: 'Hora de inicio HH:mm en hora de la tienda.',
          },
          end_time: {
            type: 'string',
            description: 'Hora de fin HH:mm en hora de la tienda.',
          },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:menus:create',
        'store:menus:update',
        'store:menus:delete',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Carta',
            'Sin tienda en contexto: las cartas siempre viven dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');
        if (!MENU_ACTIONS.includes(action)) {
          return previewError(
            'Carta',
            `action "${action}" inválida. Usa ${MENU_ACTIONS.join(', ')}.`,
          );
        }

        try {
          if (action === 'create-menu') {
            const name = String(args.name ?? '').trim();
            if (!name) {
              return previewError('Creación de carta', 'create-menu exige name.');
            }
            return {
              status: 'ok',
              target: `Creación de carta — "${name}"`,
              changes: [],
              message:
                'Crea solo la carta: después agrega secciones con create-section.',
              domain: 'menus',
            };
          }

          const menuId = toPositiveInt(args.menu_id);
          if (!menuId) {
            return previewError(
              'Carta',
              `${action} exige menu_id.`,
            );
          }
          const menu = await menusService.findOne(menuId);
          const label = `Carta "${(menu as any)?.name ?? `#${menuId}`}"`;
          const timezone = await storeTimezone(context);

          if (action === 'update-menu') {
            const fields = ['name', 'is_active'].filter(
              (field) => args[field] !== undefined,
            );
            if (!fields.length) {
              return previewError(
                label,
                'update-menu exige name o is_active.',
              );
            }
            return {
              status: 'ok',
              target: `Edición — ${label}`,
              changes: fields.map((field) => ({
                field,
                label: field,
                from: (menu as any)?.[field] ?? null,
                to: args[field],
              })),
              domain: 'menus',
            };
          }
          if (action === 'delete-menu') {
            return {
              status: 'warning',
              target: `Eliminación — ${label}`,
              changes: [
                {
                  field: 'menu',
                  label: 'Carta',
                  from: (menu as any)?.name ?? `#${menuId}`,
                  to: 'eliminada',
                },
              ],
              message: 'Eliminar es irreversible.',
              domain: 'menus',
            };
          }

          if (action === 'create-section') {
            const name = String(args.name ?? '').trim();
            if (!name) {
              return previewError(label, 'create-section exige name.');
            }
            return {
              status: 'ok',
              target: `Nueva sección — ${label}: "${name}"`,
              changes: [
                {
                  field: 'section',
                  label: 'Sección',
                  from: null,
                  to: name,
                },
              ],
              domain: 'menus',
            };
          }
          if (action === 'update-section' || action === 'delete-section') {
            const sectionId = toPositiveInt(args.section_id);
            if (!sectionId) {
              return previewError(label, `${action} exige section_id.`);
            }
            return {
              status: action === 'delete-section' ? 'warning' : 'ok',
              target: `${action === 'delete-section' ? 'Eliminación' : 'Edición'} de sección #${sectionId} — ${label}`,
              changes: [
                {
                  field: 'section',
                  label: 'Sección',
                  from: `#${sectionId}`,
                  to:
                    action === 'delete-section'
                      ? 'eliminada'
                      : (args.name ? `"${args.name}"` : 'actualizada'),
                },
              ],
              domain: 'menus',
            };
          }

          if (action === 'add-item' || action === 'remove-item') {
            const sectionId = toPositiveInt(args.section_id);
            if (!sectionId) {
              return previewError(label, `${action} exige section_id.`);
            }
            if (action === 'add-item' && !toPositiveInt(args.product_id)) {
              return previewError(
                label,
                'add-item exige product_id. Lee el plato con get_product primero.',
              );
            }
            if (action === 'remove-item' && !toPositiveInt(args.item_id)) {
              return previewError(label, 'remove-item exige item_id.');
            }
            return {
              status: 'ok',
              target: `${action === 'add-item' ? 'Agregar plato' : 'Quitar plato'} — ${label} (sección #${sectionId})`,
              changes: [
                {
                  field: 'item',
                  label: 'Plato',
                  from: null,
                  to:
                    action === 'add-item'
                      ? `producto #${args.product_id}`
                      : `plato #${args.item_id} eliminado`,
                },
              ],
              domain: 'menus',
            };
          }

          if (action === 'delete-window') {
            if (!toPositiveInt(args.window_id)) {
              return previewError(label, 'delete-window exige window_id.');
            }
            return {
              status: 'warning',
              target: `Eliminar ventana — ${label}`,
              changes: [
                {
                  field: 'window',
                  label: 'Ventana',
                  from: `#${args.window_id}`,
                  to: 'eliminada',
                },
              ],
              domain: 'menus',
            };
          }
          if (action === 'update-window' && !toPositiveInt(args.window_id)) {
            return previewError(label, 'update-window exige window_id.');
          }
          const day =
            args.day_of_week !== undefined
              ? Number(args.day_of_week)
              : null;
          if (
            action === 'add-window' &&
            (day === null || !Number.isInteger(day) || day < 0 || day > 6)
          ) {
            return previewError(
              label,
              'add-window exige day_of_week (0-6, domingo-sábado).',
            );
          }
          const windowLabel =
            day !== null && Number.isInteger(day) && day >= 0 && day <= 6
              ? `${DAY_NAMES[day]} ${args.start_time ?? '?'}–${args.end_time ?? '?'} (${timezone})`
              : `ventana #${args.window_id ?? '?'} (${timezone})`;
          return {
            status: 'ok',
            target: `${action === 'add-window' ? 'Nueva ventana' : 'Editar ventana'} — ${label}: ${windowLabel}`,
            changes: [
              {
                field: 'window',
                label: 'Ventana',
                from: action === 'add-window' ? null : `#${args.window_id}`,
                to: windowLabel,
              },
            ],
            message: `Las horas se interpretan en hora de la tienda (${timezone}).`,
            domain: 'menus',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Carta', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la gestión de la carta');
        const action = String(args.action ?? '');

        try {
          if (action === 'create-menu') {
            const checked = toValidatedDto(CreateMenuDto, {
              ...(args.name ? { name: String(args.name) } : {}),
              ...(args.is_active !== undefined
                ? { is_active: Boolean(args.is_active) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const created = await menusService.create(checked.dto);
            return JSON.stringify({
              resumen: `Carta "${(created as any)?.name}" creada (#${(created as any)?.id}). Agrega secciones con create-section.`,
              menu_id: (created as any)?.id,
            });
          }

          const menuId = toPositiveInt(args.menu_id);
          if (!menuId) {
            return guidedError(
              `${action} exige menu_id.`,
              'Lista las cartas en el módulo de menús para ubicar su ID.',
            );
          }
          // Re-verificación: la carta pudo cambiar tras el preview.
          const current = await menusService.findOne(menuId);
          const label = `Carta "${(current as any)?.name ?? `#${menuId}`}"`;

          if (action === 'update-menu') {
            const checked = toValidatedDto(UpdateMenuDto, {
              ...(args.name !== undefined
                ? { name: String(args.name) }
                : {}),
              ...(args.is_active !== undefined
                ? { is_active: Boolean(args.is_active) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await menusService.update(menuId, checked.dto);
            return JSON.stringify({
              resumen: `${label}: carta actualizada.`,
              menu_id: menuId,
            });
          }
          if (action === 'delete-menu') {
            await menusService.softDelete(menuId);
            return JSON.stringify({
              resumen: `${label}: carta eliminada.`,
              menu_id: menuId,
            });
          }

          if (action === 'create-section') {
            const checked = toValidatedDto(CreateMenuSectionDto, {
              ...(args.name ? { name: String(args.name) } : {}),
              ...(args.sort_order !== undefined
                ? { sort_order: Number(args.sort_order) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const created = await menuSectionsService.createSection(
              menuId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `${label}: sección "${(created as any)?.name}" creada (#${(created as any)?.id}).`,
              menu_id: menuId,
              section_id: (created as any)?.id,
            });
          }
          if (action === 'update-section' || action === 'delete-section') {
            const sectionId = toPositiveInt(args.section_id);
            if (!sectionId) {
              return guidedError(`${action} exige section_id.`);
            }
            if (action === 'delete-section') {
              await menuSectionsService.deleteSection(menuId, sectionId);
              return JSON.stringify({
                resumen: `${label}: sección #${sectionId} eliminada.`,
                menu_id: menuId,
              });
            }
            const checked = toValidatedDto(UpdateMenuSectionDto, {
              ...(args.name !== undefined
                ? { name: String(args.name) }
                : {}),
              ...(args.sort_order !== undefined
                ? { sort_order: Number(args.sort_order) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await menuSectionsService.updateSection(
              menuId,
              sectionId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `${label}: sección #${sectionId} actualizada.`,
              menu_id: menuId,
            });
          }

          if (action === 'add-item' || action === 'remove-item') {
            const sectionId = toPositiveInt(args.section_id);
            if (!sectionId) {
              return guidedError(`${action} exige section_id.`);
            }
            if (action === 'remove-item') {
              const itemId = toPositiveInt(args.item_id);
              if (!itemId) {
                return guidedError('remove-item exige item_id.');
              }
              await menuSectionsService.removeItem(menuId, sectionId, itemId);
              return JSON.stringify({
                resumen: `${label}: plato #${itemId} quitado de la sección #${sectionId}.`,
                menu_id: menuId,
              });
            }
            const checked = toValidatedDto(AddMenuSectionItemDto, {
              ...(args.product_id !== undefined
                ? { product_id: Number(args.product_id) }
                : {}),
              ...(args.sort_order !== undefined
                ? { sort_order: Number(args.sort_order) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const added = await menuSectionsService.addItem(
              menuId,
              sectionId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `${label}: producto #${args.product_id} agregado a la sección #${sectionId} (plato #${(added as any)?.id ?? '?'}).`,
              menu_id: menuId,
            });
          }

          if (action === 'delete-window') {
            const windowId = toPositiveInt(args.window_id);
            if (!windowId) {
              return guidedError('delete-window exige window_id.');
            }
            await menuAvailabilityService.delete(windowId);
            return JSON.stringify({
              resumen: `${label}: ventana #${windowId} eliminada.`,
              menu_id: menuId,
            });
          }
          if (action === 'update-window') {
            const windowId = toPositiveInt(args.window_id);
            if (!windowId) {
              return guidedError('update-window exige window_id.');
            }
            const checked = toValidatedDto(UpdateAvailabilityWindowDto, {
              ...(args.day_of_week !== undefined
                ? { day_of_week: Number(args.day_of_week) }
                : {}),
              ...(args.start_time !== undefined
                ? { start_time: String(args.start_time) }
                : {}),
              ...(args.end_time !== undefined
                ? { end_time: String(args.end_time) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await menuAvailabilityService.update(windowId, checked.dto);
            return JSON.stringify({
              resumen: `${label}: ventana #${windowId} actualizada (hora de tienda).`,
              menu_id: menuId,
            });
          }
          if (action === 'add-window') {
            const checked = toValidatedDto(CreateAvailabilityWindowDto, {
              ...(args.day_of_week !== undefined
                ? { day_of_week: Number(args.day_of_week) }
                : {}),
              ...(args.start_time !== undefined
                ? { start_time: String(args.start_time) }
                : {}),
              ...(args.end_time !== undefined
                ? { end_time: String(args.end_time) }
                : {}),
              ...(args.section_id !== undefined
                ? { menu_section_id: Number(args.section_id) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const created = await menuAvailabilityService.create(
              menuId,
              checked.dto,
            );
            const timezone = await storeTimezone(context);
            return JSON.stringify({
              resumen: `${label}: ventana ${DAY_NAMES[Number(args.day_of_week)]} ${args.start_time}–${args.end_time} creada (#${(created as any)?.id}, hora ${timezone}).`,
              menu_id: menuId,
              window_id: (created as any)?.id,
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa ${MENU_ACTIONS.join(', ')}.`,
          );
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude gestionar la carta: ${info.message}`,
            'Verifica la carta y la sección en el módulo de menús y reintenta.',
          );
        }
      },
    },

    // ─── K-14: analyze_menu_engineering (READ, BCG) ───────────────
    {
      name: 'analyze_menu_engineering',
      version: '1',
      domain: 'menus',
      readOnly: true,
      description:
        'Analiza la carta con la matriz BCG: clasifica cada plato en estrella (vende y deja margen), caballo (vende pero deja poco), puzzle (vende poco pero deja margen) o perro (ni vende ni deja). Popularidad por unidades vendidas en el rango y margen con costo de receta cuando el plato la tiene. Solo lectura: para actuar usa manage_menu o manage_recipe.',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description:
              'Inicio del rango YYYY-MM-DD (por defecto, el que usa el servicio).',
          },
          to: {
            type: 'string',
            description: 'Fin del rango YYYY-MM-DD.',
          },
          limit: {
            type: 'number',
            description:
              'Tope de platos por cuadrante (por defecto 20, máximo 100).',
          },
        },
      },
      requiredPermissions: ['store:menu_engineering:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la ingeniería de menú');

        try {
          const report = await menuEngineeringService.report({
            ...(args.from ? { from: String(args.from) } : {}),
            ...(args.to ? { to: String(args.to) } : {}),
          });
          const limit = Math.min(
            Math.max(Number(args.limit ?? 20) || 20, 1),
            100,
          );
          const groups: Record<string, unknown[]> = {};
          for (const [quadrant, products] of Object.entries(
            (report as any)?.groups ?? {},
          )) {
            groups[quadrant] = ((products as any[]) ?? [])
              .slice(0, limit)
              .map((product: any) => ({
                product_id: product.product_id,
                name: product.name ?? product.product_name,
                units_sold: product.units_sold,
                revenue: product.revenue,
                profit: product.profit,
                margin_percent: product.margin_percent ?? null,
              }));
          }
          return JSON.stringify({
            rango: { from: (report as any)?.from, to: (report as any)?.to },
            totales: (report as any)?.totals ?? null,
            umbrales: (report as any)?.thresholds ?? null,
            conteo: (report as any)?.counts ?? null,
            cuadrantes: groups,
            next_step:
              'Para mover un plato de cuadrante ajusta su precio, su receta (manage_recipe) o su visibilidad en carta (manage_menu).',
          });
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude analizar la carta: ${info.message}`,
            'Verifica el rango de fechas (YYYY-MM-DD) y que la tienda tenga ventas en el período.',
          );
        }
      },
    },
  ];
}

/**
 * K-15 — Órdenes de producción de sub-recetas (paso 13, P1).
 *
 * Wrapper fino sobre `ProductionOrdersService`: la tool valida el borde
 * (DTOs reales + estado actual) y el servicio corre `complete()` en UNA
 * transacción (consumo de insumos + alta de producto terminado vía
 * `StockLevelManager`, con `production.completed` post-commit). La lectura
 * habilitante es `get_product` (la sub-receta por nombre humano); el
 * preview lee la orden con `findOne` y el handler re-verifica su estado.
 */
export function createProductionTools(
  deps: ProductionToolDeps,
): RegisteredTool[] {
  const { productionOrdersService } = deps;

  return [
    // ─── K-15: manage_production_order (WRITE) ───────────────────
    {
      name: 'manage_production_order',
      version: '1',
      domain: 'menus',
      description:
        'Gestiona órdenes de producción de sub-recetas en lote: create (producto + receta + cantidad planeada), update (notas), start (borrador → en proceso), complete (consume insumos y da de alta el producto terminado en una transacción; exige produced_qty) y cancel (cancela; una completada ya no se cancela). Lee PRIMERO la sub-receta con get_product. El handler re-verifica el estado antes de start/complete/cancel.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: PRODUCTION_ACTIONS,
            description: 'create, update, start, complete o cancel.',
          },
          order_id: {
            type: 'number',
            description:
              'ID de la orden (requerido en todo salvo create).',
          },
          product_id: {
            type: 'number',
            description:
              'Sub-receta a producir (requerido en create; resuélvela con get_product).',
          },
          recipe_id: {
            type: 'number',
            description: 'Receta de la sub-receta (requerida en create).',
          },
          planned_qty: {
            type: 'number',
            description: 'Cantidad planeada (requerida en create).',
          },
          produced_qty: {
            type: 'number',
            description:
              'Rendimiento real tras merma (requerido en complete).',
          },
          waste_percent_override: {
            type: 'number',
            description:
              'Merma global 0-100 para este lote (solo complete; por defecto la de la receta).',
          },
          notes: { type: 'string', description: 'Notas.' },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:production_orders:create',
        'store:production_orders:update',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Producción',
            'Sin tienda en contexto: la producción siempre vive dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');
        if (!PRODUCTION_ACTIONS.includes(action)) {
          return previewError(
            'Producción',
            `action "${action}" inválida. Usa ${PRODUCTION_ACTIONS.join(', ')}.`,
          );
        }

        try {
          if (action === 'create') {
            const productId = toPositiveInt(args.product_id);
            const recipeId = toPositiveInt(args.recipe_id);
            if (!productId || !recipeId || !(Number(args.planned_qty) > 0)) {
              return previewError(
                'Creación de orden',
                'create exige product_id, recipe_id y planned_qty mayor a 0. Lee la sub-receta con get_product primero.',
              );
            }
            return {
              status: 'ok',
              target: `Nueva orden de producción — producto #${productId} x${args.planned_qty}`,
              changes: [
                {
                  field: 'planned_qty',
                  label: 'Cantidad planeada',
                  from: null,
                  to: Number(args.planned_qty),
                },
              ],
              message:
                'Crea la orden en borrador: después iníciala con start y ciérrala con complete.',
              domain: 'menus',
            };
          }

          const orderId = toPositiveInt(args.order_id);
          if (!orderId) {
            return previewError('Producción', `${action} exige order_id.`);
          }
          const order = await productionOrdersService.findOne(orderId);
          const label = `Orden #${orderId} (${(order as any)?.product?.name ?? `producto #${(order as any)?.product_id ?? '?'}`})`;
          const status = String((order as any)?.status ?? '');

          if (action === 'update') {
            if (args.notes === undefined) {
              return previewError(
                label,
                'update solo edita notes en este flujo.',
              );
            }
            return {
              status: 'ok',
              target: `Edición — ${label}`,
              changes: [
                {
                  field: 'notes',
                  label: 'Notas',
                  from: (order as any)?.notes ?? null,
                  to: String(args.notes),
                },
              ],
              domain: 'menus',
            };
          }
          if (action === 'start') {
            if (status !== 'draft') {
              return previewError(
                label,
                `Solo un borrador se inicia (está en ${status}).`,
              );
            }
            return {
              status: 'ok',
              target: `Iniciar — ${label}`,
              changes: [
                {
                  field: 'status',
                  label: 'Estado',
                  from: 'draft',
                  to: 'in_progress',
                },
              ],
              domain: 'menus',
            };
          }
          if (action === 'cancel') {
            if (status === 'completed') {
              return previewError(
                label,
                'Una orden completada no puede cancelarse: usa un ajuste de inventario manual.',
              );
            }
            if (status === 'cancelled') {
              return previewError(label, 'Esa orden ya está cancelada.');
            }
            return {
              status: 'warning',
              target: `Cancelación — ${label}`,
              changes: [
                {
                  field: 'status',
                  label: 'Estado',
                  from: status,
                  to: 'cancelled',
                },
              ],
              domain: 'menus',
            };
          }

          if (!(Number(args.produced_qty) > 0)) {
            return previewError(
              label,
              'complete exige produced_qty (rendimiento real tras merma) mayor a 0.',
            );
          }
          if (status === 'completed' || status === 'cancelled') {
            return previewError(
              label,
              `Esa orden ya está ${status}: no se puede completar.`,
            );
          }
          return {
            status: 'warning',
            target: `Completar — ${label}: producir ${args.produced_qty}`,
            changes: [
              {
                field: 'produced_qty',
                label: 'Producido',
                from: `planeado ${(order as any)?.planned_qty ?? '?'}`,
                to: Number(args.produced_qty),
              },
            ],
            message:
              'Al confirmar, consume los insumos de la receta y da de alta el producto terminado (asiento 1435/1435). Es irreversible.',
            domain: 'menus',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Producción', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la orden de producción');
        const action = String(args.action ?? '');

        try {
          if (action === 'create') {
            const checked = toValidatedDto(CreateProductionOrderDto, {
              ...(args.product_id !== undefined
                ? { product_id: Number(args.product_id) }
                : {}),
              ...(args.recipe_id !== undefined
                ? { recipe_id: Number(args.recipe_id) }
                : {}),
              ...(args.planned_qty !== undefined
                ? { planned_qty: Number(args.planned_qty) }
                : {}),
              ...(args.notes ? { notes: String(args.notes) } : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const created = await productionOrdersService.create(checked.dto);
            return JSON.stringify({
              resumen: `Orden de producción #${(created as any)?.id} creada en borrador (producto #${args.product_id} x${args.planned_qty}). Iníciala con start.`,
              order_id: (created as any)?.id,
            });
          }

          const orderId = toPositiveInt(args.order_id);
          if (!orderId) {
            return guidedError(
              `${action} exige order_id.`,
              'Ubica la orden en el módulo de producción y pasa su ID.',
            );
          }
          // Re-verificación: la orden pudo avanzar tras el preview.
          const order = await productionOrdersService.findOne(orderId);
          const label = `Orden #${orderId} (${(order as any)?.product?.name ?? `producto #${(order as any)?.product_id ?? '?'}`})`;
          const status = String((order as any)?.status ?? '');

          if (action === 'update') {
            const checked = toValidatedDto(UpdateProductionOrderDto, {
              ...(args.notes !== undefined
                ? { notes: String(args.notes) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await productionOrdersService.update(orderId, checked.dto);
            return JSON.stringify({
              resumen: `${label}: notas actualizadas.`,
              order_id: orderId,
            });
          }
          if (action === 'start') {
            if (status !== 'draft') {
              return guidedError(
                `La orden avanzó a ${status} después de la confirmación: no la inicié.`,
                'Revisa la orden en el módulo de producción y pide la acción de nuevo.',
              );
            }
            await productionOrdersService.start(orderId);
            return JSON.stringify({
              resumen: `${label}: iniciada (en proceso). Ciérrala con complete y su produced_qty.`,
              order_id: orderId,
            });
          }
          if (action === 'cancel') {
            if (status === 'completed') {
              return guidedError(
                'Una orden completada no puede cancelarse: usa un ajuste de inventario manual.',
              );
            }
            await productionOrdersService.cancel(orderId);
            return JSON.stringify({
              resumen: `${label}: cancelada.`,
              order_id: orderId,
            });
          }
          if (action === 'complete') {
            if (status === 'completed' || status === 'cancelled') {
              return guidedError(
                `La orden ya está ${status}: no hice nada.`,
                'Revisa la orden en el módulo de producción.',
              );
            }
            const checked = toValidatedDto(CompleteProductionOrderDto, {
              ...(args.produced_qty !== undefined
                ? { produced_qty: Number(args.produced_qty) }
                : {}),
              ...(args.waste_percent_override !== undefined
                ? {
                    waste_percent_override: Number(
                      args.waste_percent_override,
                    ),
                  }
                : {}),
              ...(args.notes ? { notes: String(args.notes) } : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const completed = await productionOrdersService.complete(
              orderId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `${label}: completada con ${args.produced_qty} producidos (insumos consumidos + alta de terminado, asiento 1435/1435).`,
              order_id: orderId,
              produced_qty: (completed as any)?.produced_qty ?? null,
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa ${PRODUCTION_ACTIONS.join(', ')}.`,
          );
        } catch (error) {
          const info = describeError(error);
          if (info.code === 'PRODUCTION_ORDER_INVALID_STATE') {
            return guidedError(
              `La orden cambió de estado: ${info.message}`,
              'Revisa la orden en el módulo de producción y pide la acción de nuevo.',
            );
          }
          return guidedError(
            `No pude gestionar la orden: ${info.message}`,
            'Revisa la orden en el módulo de producción y reintenta.',
          );
        }
      },
    },
  ];
}
