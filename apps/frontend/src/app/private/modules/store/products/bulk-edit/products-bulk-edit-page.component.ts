/**
 * Vista dedicada de edición masiva de productos (QUI-567).
 *
 * ## Layout
 *
 * Dos paneles: a la izquierda buscar/filtrar/seleccionar, a la derecha el stack
 * de seleccionados y el panel de cambios. Arriba, `app-sticky-header` con
 * "Volver" y "Aplicar cambios", que es la única puerta a la escritura.
 *
 * ## Quién es dueño de qué
 *
 * Esta página es dueña de TODO el estado compartido, y no por gusto:
 *
 * - **`selectedIds`** — el `Set` vive aquí, no en el panel de resultados. Es
 *   exactamente lo que hace que la selección sobreviva a cambiar de página, de
 *   filtro y de breakpoint: el panel se repinta con otra página de productos y
 *   el `Set` no se entera. Si viviera en el panel, cada recarga lo vaciaría.
 * - **`productCache`** — mapa `id → Product` que solo crece. Alimenta el stack
 *   con nombre y SKU de productos que ya no están en la página cargada, y se
 *   rellena por dos vías: cada página que se carga, y `GET /store/products?ids=`
 *   para los ids que "seleccionar todos" trajo sin materializar.
 * - **`changesForm` + `activeFields`** — el formulario y el conjunto de campos
 *   activados. Están aquí porque esta página es la que construye el payload de
 *   `preview`/`apply`; tenerlos en el panel de cambios obligaría a emitir el
 *   objeto hacia arriba en cada tecla.
 *
 * ## El formulario se crea UNA vez, con todos los controles
 *
 * `buildChangesForm()` crea un control por cada campo del contrato al arrancar y
 * no los toca nunca más. Cambiar el tipo objetivo NO crea ni destruye controles:
 * solo cambia qué se PINTA. Así se evita de raíz la clase de bug que
 * `resetUomControls()` tuvo que mitigar en el formulario individual, donde
 * validadores sobre campos condicionales dejaban el form inválido por un campo
 * que la UI ni mostraba.
 *
 * Ningún control lleva validadores: el panel edita un subconjunto de campos de N
 * productos distintos, así que "validar el producto completo" no está definido.
 * Las reglas cruzadas las evalúa el backend fila por fila y el preview las
 * devuelve como `warning`/`error` antes de escribir.
 *
 * ## Lo que se envía es la intersección
 *
 * `changes` = campos ACTIVADOS ∩ campos que EXISTEN para el tipo objetivo y las
 * industrias de la tienda. La intersección importa: si el usuario activa
 * `service_duration_minutes` y luego cambia el tipo objetivo a `physical`, ese
 * campo desaparece del catálogo y NO debe viajar. El `ValidationPipe` no lo
 * rechazaría (está en la whitelist), pero editar 100 productos físicos con una
 * duración de servicio es basura silenciosa en la base de datos.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
} from '@angular/forms';
import { Router } from '@angular/router';
import type { Observable } from 'rxjs';

import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  IconComponent,
  StickyHeaderComponent,
  ToastService,
  type SelectorOption,
  type StickyHeaderActionButton,
} from '../../../../../shared/components/index';
import { UomService } from '../../inventory/services/uom.service';
import { ProductState, type Product, type ProductQueryDto } from '../interfaces';
import { BulkArchiveConfirmModalComponent } from './bulk-archive-confirm-modal.component';
import { BulkChangesPanelComponent } from './bulk-changes-panel.component';
import { BulkConfirmModalComponent } from './bulk-confirm-modal.component';
import {
  BulkSelectedStackComponent,
  type BulkSelectedEntry,
} from './bulk-selected-stack.component';
import {
  BulkSelectionPanelComponent,
  EMPTY_BULK_SELECTION_FILTERS,
  type BulkSelectionFilters,
} from './bulk-selection-panel.component';
import {
  BULK_EDITABLE_FIELDS,
  findBulkEditableField,
  getBulkEditProductTypeOptions,
  getVisibleBulkEditFields,
  getVisibleBulkEditGroups,
  resolveEffectiveStoreIndustries,
} from './bulk-editable-fields.constant';
import type {
  BulkArchiveResult,
  BulkEditFieldContext,
  BulkEditProductTypeValue,
  BulkEditResult,
  BulkEditVisibleGroup,
  BulkEditableChanges,
  BulkEditableField,
  BulkEditableFieldKey,
} from './bulk-edit.interface';
import {
  ProductsBulkEditService,
  type BulkEditProductQuery,
} from './products-bulk-edit.service';

/** Tope del endpoint de ids (`MAX_PRODUCT_IDS` en el backend). */
const MAX_FILTER_IDS = 1000;

/** Tamaño de página del panel de resultados. */
const PAGE_SIZE = 20;

@Component({
  selector: 'app-products-bulk-edit-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    StickyHeaderComponent,
    BulkSelectionPanelComponent,
    BulkSelectedStackComponent,
    BulkChangesPanelComponent,
    BulkConfirmModalComponent,
    BulkArchiveConfirmModalComponent,
  ],
  templateUrl: './products-bulk-edit-page.component.html',
  styleUrl: './products-bulk-edit-page.component.scss',
})
export class ProductsBulkEditPageComponent {
  private readonly bulkEditService = inject(ProductsBulkEditService);
  private readonly authFacade = inject(AuthFacade);
  private readonly uomService = inject(UomService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ───────────────────────────────────────────────────────────────────────────
  // Resultados y paginación (servidor)
  // ───────────────────────────────────────────────────────────────────────────

  readonly products = signal<Product[]>([]);
  readonly fetching = signal<boolean>(false);
  readonly page = signal<number>(1);
  readonly limit = PAGE_SIZE;
  readonly totalItems = signal<number>(0);
  readonly totalPages = computed<number>(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.limit)),
  );

  readonly selectionFilters = signal<BulkSelectionFilters>({
    ...EMPTY_BULK_SELECTION_FILTERS,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Selección
  // ───────────────────────────────────────────────────────────────────────────

  readonly selectedIds = signal<Set<string | number>>(new Set<string | number>());
  readonly pickingAll = signal<boolean>(false);
  readonly capped = signal<boolean>(false);
  readonly cappedLimit = MAX_FILTER_IDS;

  /** `id → Product`. Solo crece: es lo que hace que el stack no pierda fichas. */
  private readonly productCache = signal<Map<number, Product>>(
    new Map<number, Product>(),
  );
  readonly hydrating = signal<boolean>(false);
  /** Ids ya pedidos al backend, para que la hidratación no entre en bucle. */
  private readonly requestedIds = new Set<number>();

  readonly selectedIdList = computed<number[]>(() =>
    [...this.selectedIds()].map((id) => Number(id)),
  );

  readonly selectedCount = computed<number>(() => this.selectedIds().size);

  /** Filas del stack. Sin ficha todavía → se pinta el id, nunca un hueco. */
  readonly selectedEntries = computed<BulkSelectedEntry[]>(() => {
    const cache = this.productCache();
    return this.selectedIdList().map((id) => {
      const product = cache.get(id);
      if (!product) {
        return { id, name: `Producto #${id}`, sku: null, hydrated: false };
      }
      return {
        id,
        name: product.name,
        sku: product.sku ?? null,
        hydrated: true,
        product,
      };
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Catálogo de campos
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `FormGroup` con un control por campo del contrato. Se crea una vez y no se
   * reconstruye: el catálogo cambia qué se pinta, no qué existe.
   */
  readonly changesForm = buildChangesForm();

  /**
   * Valor del formulario como señal.
   *
   * `computed()` leyendo `changesForm.value` NO sería reactivo — `value` es una
   * propiedad plana, no una señal — y el payload se congelaría en el estado
   * inicial. El puente correcto es `toSignal(valueChanges)`.
   */
  readonly formValue = toSignal(
    this.changesForm.valueChanges as Observable<Record<string, unknown>>,
    { initialValue: this.changesForm.getRawValue() as Record<string, unknown> },
  );

  readonly activeFields = signal<ReadonlySet<BulkEditableFieldKey>>(
    new Set<BulkEditableFieldKey>(),
  );

  /** Tipo objetivo: el propio control `product_type` del formulario. */
  readonly targetType = computed<BulkEditProductTypeValue>(
    () =>
      (this.formValue()['product_type'] as BulkEditProductTypeValue) ||
      'physical',
  );

  /**
   * Industrias efectivas de la tienda, con la cascada canónica del repo
   * (settings → login → `['retail']`), reutilizada del registro para no escribir
   * una cuarta copia.
   */
  readonly industries = computed<readonly string[]>(() => {
    const settings = this.authFacade.storeSettings() as
      | { general?: { industries?: string[] } }
      | null;
    return resolveEffectiveStoreIndustries(
      settings?.general?.industries,
      this.authFacade.userIndustries(),
    );
  });

  /**
   * Tipos que YA tienen los productos seleccionados. Es el escape hatch del
   * formulario individual: un producto que ya es `service` sigue siendo editable
   * como servicio aunque la industria `service` se haya desactivado, para no
   * perder su configuración al guardar.
   */
  readonly currentTypes = computed<readonly BulkEditProductTypeValue[]>(
    () => {
      const cache = this.productCache();
      const types = new Set<BulkEditProductTypeValue>();
      for (const id of this.selectedIdList()) {
        const type = cache.get(id)?.product_type;
        if (type) {
          types.add(type as BulkEditProductTypeValue);
        }
      }
      return [...types].sort();
    },
    {
      /**
       * Comparación por CONTENIDO, no por referencia.
       *
       * Sin esto, cada lote de hidratación produce un arreglo nuevo con los
       * mismos tres tipos y la cascada `currentTypes → fieldContext →
       * typeOptions → typeButtonOptions` se re-evalúa entera. El `@for` interno
       * de `app-input-buttons` traquea por identidad, así que recibía objetos
       * nuevos y destruía/recreaba los botones de tipo en cada lote (Angular lo
       * denuncia con NG0956). Ordenado + comparado por contenido, la identidad
       * se mantiene mientras el conjunto de tipos no cambie de verdad.
       */
      equal: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    },
  );

  readonly fieldContext = computed<BulkEditFieldContext>(() => ({
    targetType: this.targetType(),
    industries: this.industries(),
    currentTypes: this.currentTypes(),
  }));

  readonly typeOptions = computed(() =>
    getBulkEditProductTypeOptions(this.fieldContext()),
  );

  /** Grupos a pintar. El grupo `type` lo renderiza el panel aparte. */
  readonly changeGroups = computed<BulkEditVisibleGroup[]>(() =>
    getVisibleBulkEditGroups(this.fieldContext()).filter(
      (group) => group.key !== 'type',
    ),
  );

  /** Claves que EXISTEN para el contexto actual. Base de la intersección. */
  private readonly availableFieldKeys = computed<ReadonlySet<BulkEditableFieldKey>>(
    () =>
      new Set(
        getVisibleBulkEditFields(this.fieldContext()).map((field) => field.key),
      ),
  );

  /**
   * Payload final: SOLO los campos activados que además existen para el tipo
   * objetivo. Un campo no activado nunca viaja, y uno activado que dejó de
   * aplicar tampoco.
   */
  readonly changes = computed<BulkEditableChanges>(() => {
    const value = this.formValue();
    const active = this.activeFields();
    const available = this.availableFieldKeys();
    const payload: Record<string, unknown> = {};

    for (const key of active) {
      if (!available.has(key)) {
        continue;
      }
      const field = findBulkEditableField(key);
      if (!field) {
        continue;
      }
      const coerced = coerceBulkEditValue(field, value[key]);
      if (coerced === undefined) {
        continue;
      }
      payload[key] = coerced;
    }

    return payload as BulkEditableChanges;
  });

  readonly changedFieldKeys = computed<string[]>(() =>
    Object.keys(this.changes()),
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Catálogos dinámicos
  // ───────────────────────────────────────────────────────────────────────────

  readonly uomOptions = signal<SelectorOption[]>([]);
  readonly templateOptions = signal<SelectorOption[]>([]);

  // ───────────────────────────────────────────────────────────────────────────
  // Confirmación
  // ───────────────────────────────────────────────────────────────────────────

  readonly modalOpen = signal<boolean>(false);

  // ───────────────────────────────────────────────────────────────────────────
  // Zona peligrosa (archivado masivo)
  // ───────────────────────────────────────────────────────────────────────────

  readonly archiveModalOpen = signal<boolean>(false);

  /**
   * `store:products:admin_delete` — el MISMO permiso que el archivado individual
   * (`DELETE /store/products/:id`), no el `bulk_update` de esta vista. Archivar 100
   * productos no puede pedir menos permiso que archivar uno.
   *
   * Misma mecánica que `canBulkEditProducts` en `products.component.ts:168-170`:
   * `AuthFacade.hasPermission` lee el signal `userPermissions`, así que el
   * `computed` es reactivo. Es afordancia de UI; la autorización real la impone el
   * backend y además la refuerza por nombre en el controller.
   */
  readonly canArchiveProducts = computed<boolean>(() =>
    this.authFacade.hasPermission('store:products:admin_delete'),
  );

  /** Resuelve nombres para los lotes que el backend no alcanza a devolver. */
  readonly nameResolver = computed<(id: number) => string | undefined>(() => {
    const cache = this.productCache();
    return (id: number) => cache.get(id)?.name;
  });

  readonly canApply = computed<boolean>(
    () => this.selectedCount() > 0 && this.changedFieldKeys().length > 0,
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'back', label: 'Volver', variant: 'outline', icon: 'arrow-left' },
    {
      id: 'apply',
      label: 'Aplicar cambios',
      variant: 'primary',
      icon: 'save',
      disabled: !this.canApply(),
    },
  ]);

  readonly applyBlockedReason = computed<string>(() => {
    if (this.selectedCount() === 0) {
      return 'Selecciona al menos un producto';
    }
    if (this.changedFieldKeys().length === 0) {
      return 'Activa al menos una configuración para aplicar';
    }
    return '';
  });

  readonly headerMetadata = computed<string>(() => {
    const selected = this.selectedCount();
    const changed = this.changedFieldKeys().length;
    return [
      `${selected} ${selected === 1 ? 'seleccionado' : 'seleccionados'}`,
      `${changed} ${changed === 1 ? 'configuración' : 'configuraciones'}`,
    ].join(' · ');
  });

  constructor() {
    // Hidratación del stack. Se dispara SOLO cuando cambia la selección: la
    // caché se lee con `untracked` a propósito, porque si se leyera de forma
    // reactiva cada respuesta re-ejecutaría el efecto.
    effect(() => {
      const ids = this.selectedIdList();
      untracked(() => this.hydrateMissing(ids));
    });

    this.fetchPage();
    this.loadUomCatalog();
    this.loadTemplateCatalog();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Carga de datos
  // ───────────────────────────────────────────────────────────────────────────

  private fetchPage(): void {
    this.fetching.set(true);
    this.bulkEditService
      .getProductsPage({
        ...this.queryFromFilters(),
        page: this.page(),
        limit: this.limit,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.products.set(result.data);
          this.totalItems.set(result.total);
          this.mergeIntoCache(result.data);
          this.fetching.set(false);
        },
        error: (err: unknown) => {
          this.toastService.error(extractApiErrorMessage(err));
          this.fetching.set(false);
        },
      });
  }

  private loadUomCatalog(): void {
    this.uomService
      .getCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.uomOptions.set(
            (response.data ?? [])
              .filter((unit) => unit.is_active)
              .map((unit) => ({
                value: unit.id,
                label: `${unit.name} (${unit.code})`,
                description: unit.dimension,
              })),
          );
        },
        // Catálogo ausente = los dos selectores de UoM quedan vacíos. No es
        // motivo para tumbar la vista entera.
        error: () => this.uomOptions.set([]),
      });
  }

  private loadTemplateCatalog(): void {
    this.bulkEditService
      .getDataCollectionTemplates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (templates) => this.templateOptions.set(templates),
        error: () => this.templateOptions.set([]),
      });
  }

  private hydrateMissing(ids: readonly number[]): void {
    const cache = this.productCache();
    const missing = ids.filter(
      (id) => !cache.has(id) && !this.requestedIds.has(id),
    );
    if (missing.length === 0) {
      return;
    }
    missing.forEach((id) => this.requestedIds.add(id));
    this.hydrating.set(true);

    this.bulkEditService
      .getProductsByIds(missing)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (products) => {
          this.mergeIntoCache(products);
          this.hydrating.set(false);
        },
        error: () => this.hydrating.set(false),
      });
  }

  /** Publica SIEMPRE un `Map` nuevo: mutarlo no notificaría a la señal. */
  private mergeIntoCache(products: readonly Product[]): void {
    if (products.length === 0) {
      return;
    }
    this.productCache.update((prev) => {
      const next = new Map(prev);
      for (const product of products) {
        next.set(product.id, product);
        this.requestedIds.add(product.id);
      }
      return next;
    });
  }

  /**
   * Traduce los filtros del panel a la query del backend.
   *
   * Los vacíos se OMITEN en lugar de mandarse como `''`: `state=` llegaría al
   * `where` de Prisma como un estado literal vacío y el listado saldría en cero.
   * El servicio también los descarta, pero no se delega una regla de correctitud
   * a la capa de transporte.
   */
  private queryFromFilters(): BulkEditProductQuery {
    const filters = this.selectionFilters();
    const query: BulkEditProductQuery = {};
    if (filters.search) {
      query.search = filters.search;
    }
    if (filters.state) {
      query.state = filters.state as ProductState;
    }
    if (filters.product_type) {
      query.product_type =
        filters.product_type as ProductQueryDto['product_type'];
    }
    return query;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Handlers
  // ───────────────────────────────────────────────────────────────────────────

  onFiltersChanged(filters: BulkSelectionFilters): void {
    this.selectionFilters.set(filters);
    // Filtro nuevo ⇒ la paginación anterior ya no significa nada.
    this.page.set(1);
    this.capped.set(false);
    this.fetchPage();
  }

  onPageChanged(page: number): void {
    this.page.set(page);
    this.fetchPage();
  }

  onRefresh(): void {
    this.fetchPage();
  }

  /**
   * "Seleccionar los N del filtro". Resuelve ids en el servidor porque
   * seleccionar "todos" no puede significar "todos los que cargué".
   */
  onSelectAllFiltered(): void {
    this.pickingAll.set(true);
    this.bulkEditService
      .getProductIds(this.queryFromFilters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          const next = new Set(this.selectedIds());
          result.ids.forEach((id) => next.add(id));
          this.selectedIds.set(next);
          this.capped.set(result.capped);
          this.pickingAll.set(false);
        },
        error: (err: unknown) => {
          this.toastService.error(extractApiErrorMessage(err));
          this.pickingAll.set(false);
        },
      });
  }

  onRemoveFromStack(id: number): void {
    const next = new Set(this.selectedIds());
    next.delete(id);
    this.selectedIds.set(next);
  }

  onClearStack(): void {
    this.selectedIds.set(new Set<string | number>());
    this.capped.set(false);
  }

  /** Desactiva todos los campos y devuelve el formulario a su estado inicial. */
  onResetChanges(): void {
    this.activeFields.set(new Set<BulkEditableFieldKey>());
    this.changesForm.reset(buildChangesFormDefaults());
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'back') {
      void this.router.navigate(['/admin/products']);
      return;
    }
    if (actionId === 'apply') {
      if (!this.canApply()) {
        this.toastService.warning(this.applyBlockedReason());
        return;
      }
      this.modalOpen.set(true);
    }
  }

  /**
   * La edición terminó. Se recarga la página de resultados para que el listado
   * refleje el estado real y se invalida la caché de los productos tocados: sus
   * fichas cambiaron y seguir mostrando las viejas sería mentir.
   */
  onApplied(result: BulkEditResult): void {
    const touched = result.results
      .filter((row) => row.status === 'ok')
      .map((row) => row.id);

    if (touched.length > 0) {
      this.productCache.update((prev) => {
        const next = new Map(prev);
        touched.forEach((id) => {
          next.delete(id);
          this.requestedIds.delete(id);
        });
        return next;
      });
    }

    if (result.failed === 0) {
      this.toastService.success(
        `${result.successful} productos editados correctamente`,
      );
    } else {
      this.toastService.warning(
        `${result.successful} editados y ${result.failed} con error`,
      );
    }

    this.fetchPage();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Zona peligrosa
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * El panel pidió eliminar. Abre el modal de confirmación reforzada, que es la
   * ÚNICA puerta a `POST /bulk-edit/archive`: la página nunca llama al archivado
   * directamente.
   */
  onArchiveRequested(): void {
    if (this.selectedCount() === 0) {
      this.toastService.warning('Selecciona al menos un producto para eliminar');
      return;
    }
    this.archiveModalOpen.set(true);
  }

  /**
   * El archivado terminó. Los ids archivados con éxito SALEN de la selección: ya
   * no existen como productos editables y dejarlos en el stack los volvería a
   * enviar en la siguiente operación, donde el backend los rechazaría con
   * `PROD_FIND_001` ("ya está archivado") y el operador vería fallos que no
   * entiende.
   *
   * Los fallidos SÍ se quedan seleccionados: siguen vivos, su motivo es accionable
   * (liberar reservas, cerrar pedidos) y quitarlos obligaría a volver a buscarlos.
   */
  onArchived(result: BulkArchiveResult): void {
    const removed = result.results
      .filter((row) => row.status === 'ok')
      .map((row) => row.id);

    if (removed.length > 0) {
      const nextSelection = new Set(this.selectedIds());
      // El `Set` guarda `string | number`; los ids del backend llegan numéricos.
      // Se borran ambas formas para no dejar una entrada huérfana si la selección
      // vino de una fuente que los materializó como string.
      removed.forEach((id) => {
        nextSelection.delete(id);
        nextSelection.delete(String(id));
      });
      this.selectedIds.set(nextSelection);

      // Y fuera de la caché: sus fichas ya no reflejan la realidad.
      this.productCache.update((prev) => {
        const next = new Map(prev);
        removed.forEach((id) => {
          next.delete(id);
          this.requestedIds.delete(id);
        });
        return next;
      });
    }

    if (result.failed === 0) {
      this.toastService.success(
        `${result.successful} productos eliminados correctamente`,
      );
    } else {
      this.toastService.warning(
        `${result.successful} eliminados y ${result.failed} sin eliminar`,
      );
    }

    this.fetchPage();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros
// ─────────────────────────────────────────────────────────────────────────────

/** Valores iniciales del formulario, uno por campo del contrato. */
function buildChangesFormDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of BULK_EDITABLE_FIELDS) {
    if (field.control === 'dimensions') {
      defaults[field.key] = { length: null, width: null, height: null };
    } else if (field.control === 'toggle') {
      defaults[field.key] = false;
    } else if (field.key === 'product_type') {
      // El conductor del catálogo arranca con un valor real: sin él, el panel
      // no tendría ningún tipo objetivo con el que resolver los grupos.
      defaults[field.key] = 'physical';
    } else {
      defaults[field.key] = null;
    }
  }
  return defaults;
}

/**
 * `FormGroup` con UN control por campo del contrato, creado una sola vez.
 *
 * Sin validadores, a propósito: ver la cabecera del componente.
 */
function buildChangesForm(): FormGroup<{ [key: string]: AbstractControl }> {
  const controls: { [key: string]: AbstractControl } = {};

  for (const field of BULK_EDITABLE_FIELDS) {
    if (field.control === 'dimensions') {
      controls[field.key] = new FormGroup({
        length: new FormControl<number | null>(null),
        width: new FormControl<number | null>(null),
        height: new FormControl<number | null>(null),
      });
      continue;
    }
    if (field.control === 'toggle') {
      controls[field.key] = new FormControl<boolean>(false, {
        nonNullable: true,
      });
      continue;
    }
    if (field.key === 'product_type') {
      controls[field.key] = new FormControl<string>('physical', {
        nonNullable: true,
      });
      continue;
    }
    controls[field.key] = new FormControl<string | number | null>(null);
  }

  return new FormGroup<{ [key: string]: AbstractControl }>(controls);
}

/**
 * Convierte el valor crudo de un control al tipo que el DTO espera.
 *
 * Devuelve `undefined` para "no mandar este campo". Es la última defensa contra
 * enviar `base_price: NaN` o `stock_uom_id: ''`, que el backend rechazaría con
 * un 400 para el lote entero.
 *
 * Criterio para el vacío:
 * - numéricos y selectores → vacío significa "no elegí", se omite;
 * - texto y textarea → la cadena vacía SÍ se envía, porque activar el campo y
 *   dejarlo en blanco es la única forma de BORRAR unas instrucciones existentes.
 */
export function coerceBulkEditValue(
  field: BulkEditableField,
  raw: unknown,
): unknown {
  switch (field.control) {
    case 'toggle':
      return Boolean(raw);

    case 'number':
    case 'currency': {
      if (raw === null || raw === undefined || raw === '') {
        return undefined;
      }
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    case 'dimensions': {
      if (!raw || typeof raw !== 'object') {
        return undefined;
      }
      const dims = raw as Record<string, unknown>;
      const length = Number(dims['length']);
      const width = Number(dims['width']);
      const height = Number(dims['height']);
      if (
        !Number.isFinite(length) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      ) {
        return undefined;
      }
      return { length, width, height };
    }

    case 'selector': {
      if (raw === null || raw === undefined || raw === '') {
        return undefined;
      }
      // Los selectores del contrato que apuntan a una FK son numéricos
      // (`stock_uom_id`, `purchase_uom_id`, `*_template_id`); el resto son enums
      // de string.
      if (field.key.endsWith('_id')) {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return String(raw);
    }

    case 'input-buttons': {
      if (raw === null || raw === undefined || raw === '') {
        return undefined;
      }
      return String(raw);
    }

    case 'text':
    case 'textarea':
      return raw === null || raw === undefined ? '' : String(raw);

    default:
      return undefined;
  }
}
