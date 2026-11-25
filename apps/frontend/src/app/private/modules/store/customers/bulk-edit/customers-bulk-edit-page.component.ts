/**
 * Página de edición masiva de clientes.
 *
 * ## Layout
 *
 * Dos paneles: a la izquierda buscar/filtrar/seleccionar; a la derecha el stack
 * de seleccionados y, debajo, el panel de cambios. Arriba, `app-sticky-header`
 * con «Volver» y «Aplicar cambios», que es la única puerta a la escritura (y esa
 * puerta es un modal con preview obligatorio).
 *
 * Sigue el lenguaje visual y la estructura del masivo de productos: los mismos
 * dos paneles, los mismos contadores en vivo, el mismo patrón de
 * «activar campo → definir valor → previsualizar → aplicar».
 *
 * ## Quién es dueño de qué
 *
 * Esta página es dueña de TODO el estado compartido, igual que el masivo de
 * productos:
 *
 * - **`selectedIds`** — el `Set` vive aquí y no en el panel de resultados: es lo
 *   que hace que la selección sobreviva a cambiar de página y de filtro. Si
 *   viviera en el panel, cada recarga lo vaciaría.
 * - **`rowCache`** — mapa `id → fila` que solo crece. Alimenta el stack con
 *   nombre y documento de clientes que ya no están en la página cargada, y se
 *   rellena por dos vías: cada página que se carga y `GET /bulk-edit/list?ids=`
 *   para los ids que «seleccionar todos» trajo sin materializar.
 * - **`changesForm` + `activeFields`** — están aquí porque esta página construye
 *   el payload de `preview`/`apply`.
 *
 * ## El formulario se crea UNA vez, con todos los controles
 *
 * `buildChangesForm()` crea un control por campo del contrato al arrancar y no
 * los toca nunca más. Activar o desactivar un campo cambia qué viaja, no qué
 * existe; así se evita la clase de bug en la que un validador sobre un campo
 * oculto bloquea el guardado.
 *
 * Ningún control lleva validadores: las reglas cruzadas las evalúa el backend
 * fila por fila y el preview las devuelve como `warning`/`error` antes de
 * escribir.
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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import type { Observable } from 'rxjs';

import {
  ButtonComponent,
  IconComponent,
  StickyHeaderComponent,
  ToastService,
  type SelectorOption,
  type StickyHeaderActionButton,
} from '../../../../../shared/components/index';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { CustomersService } from '../services/customers.service';
import { CrmService } from '../crm/shared/crm.service';
import {
  PriceTiersService,
} from '../../price-tiers/services/price-tiers.service';
import { BulkCustomerChangesPanelComponent } from './bulk-customer-changes-panel.component';
import { BulkCustomerConfirmModalComponent } from './bulk-customer-confirm-modal.component';
import {
  BulkCustomerSelectedStackComponent,
  type BulkCustomerSelectedEntry,
} from './bulk-customer-selected-stack.component';
import {
  BulkCustomerSelectionPanelComponent,
  displayCustomerName,
  type BulkCustomerFilterOption,
} from './bulk-customer-selection-panel.component';
import {
  BULK_CUSTOMER_EDITABLE_FIELDS,
  BulkCustomerField,
  BulkCustomerFieldKey,
  findBulkCustomerField,
  NO_PRICE_TIER_VALUE,
} from './bulk-editable-customer-fields.constant';
import {
  BulkCustomerFilters,
  BulkCustomerRow,
  BulkCustomerResult,
  BulkEditableCustomerChanges,
  EMPTY_BULK_CUSTOMER_FILTERS,
  MAX_BULK_CUSTOMER_FILTER_IDS,
} from './bulk-edit-customers.interface';
import { CustomersBulkEditService } from './customers-bulk-edit.service';

/** Tamaño de página del panel de resultados. */
const PAGE_SIZE = 20;

@Component({
  selector: 'app-customers-bulk-edit-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    IconComponent,
    StickyHeaderComponent,
    BulkCustomerSelectionPanelComponent,
    BulkCustomerSelectedStackComponent,
    BulkCustomerChangesPanelComponent,
    BulkCustomerConfirmModalComponent,
  ],
  templateUrl: './customers-bulk-edit-page.component.html',
})
export class CustomersBulkEditPageComponent {
  private readonly bulkEditService = inject(CustomersBulkEditService);
  private readonly customersService = inject(CustomersService);
  private readonly crmService = inject(CrmService);
  private readonly priceTiersService = inject(PriceTiersService);
  private readonly authFacade = inject(AuthFacade);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ───────────────────────────────────────────────────────────────────────────
  // Resultados y paginación
  // ───────────────────────────────────────────────────────────────────────────

  readonly rows = signal<BulkCustomerRow[]>([]);
  readonly fetching = signal<boolean>(false);
  readonly page = signal<number>(1);
  readonly limit = PAGE_SIZE;
  readonly totalItems = signal<number>(0);
  readonly totalPages = computed<number>(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.limit)),
  );

  readonly filters = signal<BulkCustomerFilters>({
    ...EMPTY_BULK_CUSTOMER_FILTERS,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Selección
  // ───────────────────────────────────────────────────────────────────────────

  readonly selectedIds = signal<Set<string | number>>(new Set<string | number>());
  readonly pickingAll = signal<boolean>(false);
  readonly capped = signal<boolean>(false);
  readonly cappedLimit = MAX_BULK_CUSTOMER_FILTER_IDS;

  /** `id → fila`. Solo crece: es lo que hace que el stack no pierda fichas. */
  private readonly rowCache = signal<Map<number, BulkCustomerRow>>(new Map());
  readonly hydrating = signal<boolean>(false);
  /** Ids ya pedidos al backend, para que la hidratación no entre en bucle. */
  private readonly requestedIds = new Set<number>();

  readonly selectedIdList = computed<number[]>(() =>
    [...this.selectedIds()].map((id) => Number(id)),
  );

  readonly selectedCount = computed<number>(() => this.selectedIds().size);

  /** Filas del stack. Sin ficha todavía → se pinta el id, nunca un hueco. */
  readonly selectedEntries = computed<BulkCustomerSelectedEntry[]>(() => {
    const cache = this.rowCache();
    return this.selectedIdList().map((id) => {
      const row = cache.get(id);
      if (!row) {
        return {
          id,
          name: `Cliente #${id}`,
          document: null,
          hydrated: false,
        };
      }
      return {
        id,
        name: displayCustomerName(row),
        document: row.document_number ?? null,
        hydrated: true,
      };
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Catálogo de campos y formulario
  // ───────────────────────────────────────────────────────────────────────────

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

  readonly activeFields = signal<ReadonlySet<BulkCustomerFieldKey>>(
    new Set<BulkCustomerFieldKey>(),
  );

  /** Campos que viajan: activados y existentes en el contrato. */
  readonly changes = computed<BulkEditableCustomerChanges>(() => {
    const value = this.formValue();
    const active = this.activeFields();
    const payload: Record<string, unknown> = {};

    for (const key of active) {
      const field = findBulkCustomerField(key);
      if (!field) continue;
      const coerced = coerceCustomerFieldValue(field, value[key]);
      if (coerced === undefined) continue;
      payload[key] = coerced;
    }

    return payload as BulkEditableCustomerChanges;
  });

  readonly changedFieldKeys = computed<string[]>(() => Object.keys(this.changes()));

  // ───────────────────────────────────────────────────────────────────────────
  // Catálogos
  // ───────────────────────────────────────────────────────────────────────────

  readonly priceTierCatalog = signal<readonly BulkCustomerFilterOption[]>([]);
  readonly tagCatalog = signal<readonly BulkCustomerFilterOption[]>([]);
  readonly segmentCatalog = signal<readonly BulkCustomerFilterOption[]>([]);

  /** Opciones del selector de tarifa: «Sin tarifa» + catálogo de cliente. */
  readonly priceTierOptions = computed<SelectorOption[]>(() => [
    { value: NO_PRICE_TIER_VALUE, label: 'Sin tarifa' },
    ...this.priceTierCatalog().map((tier) => ({
      value: tier.id,
      label: tier.name,
    })),
  ]);

  readonly tagOptions = computed<SelectorOption[]>(() =>
    this.tagCatalog().map((tag) => ({ value: tag.id, label: tag.name })),
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Confirmación
  // ───────────────────────────────────────────────────────────────────────────

  readonly modalOpen = signal<boolean>(false);

  readonly canApply = computed<boolean>(
    () => this.selectedCount() > 0 && this.changedFieldKeys().length > 0,
  );

  /** Permiso de edición de clientes: la vista es afordancia, el backend manda. */
  readonly canEditCustomers = computed<boolean>(() =>
    this.authFacade.isOwner() ||
    this.authFacade.isAdmin() ||
    this.authFacade.hasPermission('store:customers:update'),
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'back', label: 'Volver', variant: 'outline', icon: 'arrow-left' },
    {
      id: 'apply',
      label: 'Aplicar cambios',
      variant: 'primary',
      icon: 'save',
      disabled: !this.canApply() || !this.canEditCustomers(),
    },
  ]);

  readonly applyBlockedReason = computed<string>(() => {
    if (!this.canEditCustomers()) {
      return 'Tu usuario no tiene permiso para editar clientes';
    }
    if (this.selectedCount() === 0) {
      return 'Selecciona al menos un cliente';
    }
    if (this.changedFieldKeys().length === 0) {
      return 'Activa al menos un campo para aplicar';
    }
    return '';
  });

  readonly headerMetadata = computed<string>(() => {
    const selected = this.selectedCount();
    const changed = this.changedFieldKeys().length;
    return [
      `${selected} ${selected === 1 ? 'seleccionado' : 'seleccionados'}`,
      `${changed} ${changed === 1 ? 'campo' : 'campos'}`,
    ].join(' · ');
  });

  /** Resuelve nombres para los lotes que el backend no alcanza a devolver. */
  readonly nameResolver = computed<(id: number) => string | undefined>(() => {
    const cache = this.rowCache();
    return (id: number) => {
      const row = cache.get(id);
      return row ? displayCustomerName(row) : undefined;
    };
  });

  constructor() {
    // Hidratación del stack. Se dispara SOLO cuando cambia la selección: la
    // caché se lee con `untracked` porque, si se leyera de forma reactiva, cada
    // respuesta re-ejecutaría el efecto.
    effect(() => {
      const ids = this.selectedIdList();
      untracked(() => this.hydrateMissing(ids));
    });

    this.fetchPage();
    this.loadPriceTiers();
    this.loadCrmCatalogs();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Carga de datos
  // ───────────────────────────────────────────────────────────────────────────

  private fetchPage(): void {
    this.fetching.set(true);
    this.bulkEditService
      .getPage(this.filters(), this.page(), this.limit)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.rows.set(result.data);
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

  /** Tarifas de CLIENTE activas de la tienda (nunca unidades de venta). */
  private loadPriceTiers(): void {
    this.priceTiersService
      .list({ is_active: true, kind: 'customer_tier', limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tiers) =>
          this.priceTierCatalog.set(
            (tiers ?? [])
              .filter(
                (tier) =>
                  (tier.kind ?? 'customer_tier') === 'customer_tier' &&
                  tier.is_active !== false,
              )
              .map((tier) => ({ id: tier.id, name: tier.name })),
          ),
        // Sin catálogo el selector queda vacío y el campo no se puede activar:
        // es exactamente lo que debe pasar si la tienda no tiene tarifas.
        error: () => this.priceTierCatalog.set([]),
      });
  }

  /** Etiquetas y segmentos vivos de la tienda para filtros y acciones. */
  private loadCrmCatalogs(): void {
    this.crmService
      .tags()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) =>
          this.tagCatalog.set(
            (tags ?? []).map((tag) => ({ id: tag.id, name: tag.name })),
          ),
        error: () => this.tagCatalog.set([]),
      });

    this.customersService
      .getFilterOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.segmentCatalog.set(
            (options?.segments ?? []).map((segment) => ({
              id: segment.id,
              name: segment.name,
            })),
          );
          // El catálogo de ACCIONES sale de `crmService.tags()` (todas las
          // etiquetas, incluidas las nuevas sin clientes). `options.tags` solo
          // trae las que ya tienen uso y pisaba el catálogo, ocultando las
          // recién creadas; aquí solo se usa para los segmentos.
          if ((options?.tags ?? []).length > 0 && this.tagCatalog().length === 0) {
            this.tagCatalog.set(
              options.tags.map((tag) => ({ id: tag.id, name: tag.name })),
            );
          }
        },
        error: () => this.segmentCatalog.set([]),
      });
  }

  private hydrateMissing(ids: readonly number[]): void {
    const cache = this.rowCache();
    const missing = ids.filter(
      (id) => !cache.has(id) && !this.requestedIds.has(id),
    );
    if (missing.length === 0) return;

    missing.forEach((id) => this.requestedIds.add(id));
    this.hydrating.set(true);

    this.bulkEditService
      .getByIds(missing)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.mergeIntoCache(rows);
          this.hydrating.set(false);
        },
        error: () => this.hydrating.set(false),
      });
  }

  /** Publica SIEMPRE un `Map` nuevo: mutarlo no notificaría a la señal. */
  private mergeIntoCache(rows: readonly BulkCustomerRow[]): void {
    if (rows.length === 0) return;
    this.rowCache.update((prev) => {
      const next = new Map(prev);
      for (const row of rows) {
        next.set(row.id, row);
        this.requestedIds.add(row.id);
      }
      return next;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Handlers
  // ───────────────────────────────────────────────────────────────────────────

  onFiltersChanged(filters: BulkCustomerFilters): void {
    this.filters.set(filters);
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
   * «Seleccionar todos los del filtro». Resuelve ids en el servidor porque
   * seleccionar «todos» no puede significar «todos los que cargué».
   */
  onSelectAllFiltered(): void {
    this.pickingAll.set(true);
    this.bulkEditService
      .getIds(this.filters())
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
    next.delete(String(id));
    this.selectedIds.set(next);
  }

  onClearStack(): void {
    this.selectedIds.set(new Set<string | number>());
    this.capped.set(false);
  }

  /** Desactiva todos los campos y devuelve el formulario a su estado inicial. */
  onResetChanges(): void {
    this.activeFields.set(new Set<BulkCustomerFieldKey>());
    this.changesForm.reset(buildChangesFormDefaults());
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'back') {
      void this.router.navigate(['/admin/customers/all']);
      return;
    }
    if (actionId === 'apply') {
      if (!this.canApply() || !this.canEditCustomers()) {
        this.toastService.warning(this.applyBlockedReason());
        return;
      }
      this.modalOpen.set(true);
    }
  }

  /**
   * La edición terminó. Se recarga la página para que el listado refleje el
   * estado real y se invalida la caché de las fichas tocadas: su tarifa y sus
   * datos cambiaron y seguir mostrando los viejos sería mentir.
   */
  onApplied(result: BulkCustomerResult): void {
    const touched = result.results
      .filter((row) => row.status === 'ok')
      .map((row) => row.id);

    // Un fallo tras la escritura escalar (p. ej. las etiquetas) deja al cliente
    // con parte de los cambios: la ficha cacheada tampoco sirve y se invalida.
    const stale = result.results
      .filter((row) => row.status === 'error')
      .map((row) => row.id);

    if (touched.length > 0 || stale.length > 0) {
      this.rowCache.update((prev) => {
        const next = new Map(prev);
        touched.forEach((id) => {
          next.delete(id);
          this.requestedIds.delete(id);
        });
        stale.forEach((id) => next.delete(id));
        return next;
      });
    }

    if (result.failed === 0) {
      this.toastService.success(
        `${result.successful} ${result.successful === 1 ? 'cliente editado' : 'clientes editados'} correctamente`,
      );
    } else {
      this.toastService.warning(
        `${result.successful} editados y ${result.failed} con error`,
      );
    }

    this.fetchPage();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros
// ─────────────────────────────────────────────────────────────────────────────

/** Valores iniciales del formulario, uno por campo del contrato. */
export function buildChangesFormDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of BULK_CUSTOMER_EDITABLE_FIELDS) {
    switch (field.control) {
      case 'toggle':
        defaults[field.key] = false;
        break;
      case 'multiselect':
        defaults[field.key] = [];
        break;
      case 'tag-action':
        defaults[field.key] = { mode: 'add', ids: [] };
        break;
      default:
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
export function buildChangesForm(): FormGroup<{
  [key: string]: AbstractControl;
}> {
  const controls: { [key: string]: AbstractControl } = {};

  for (const field of BULK_CUSTOMER_EDITABLE_FIELDS) {
    if (field.control === 'toggle') {
      controls[field.key] = new FormControl<boolean>(false, {
        nonNullable: true,
      });
      continue;
    }
    if (field.control === 'multiselect') {
      controls[field.key] = new FormControl<string[]>([], {
        nonNullable: true,
      });
      continue;
    }
    if (field.control === 'tag-action') {
      controls[field.key] = new FormGroup({
        mode: new FormControl<string>('add', { nonNullable: true }),
        ids: new FormControl<number[]>([], { nonNullable: true }),
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
 * Devuelve `undefined` para «no mandar este campo». Es la última defensa contra
 * enviar `price_tier_id: ''` o `fiscal_responsibilities: null`, que el backend
 * rechazaría con un 400 para el lote entero.
 *
 * Criterio para el vacío:
 * - texto → se envía el `emptyValue` del registro (`''` o `null`), porque
 *   activar el campo y dejarlo en blanco es la única forma de BORRAR el dato;
 * - selector de enum → `null` (limpia el régimen o el tipo de persona);
 * - tarifa → `undefined` si no se eligió nada, `null` si se eligió «Sin tarifa»;
 * - etiquetas → `undefined` si no hay ids: una acción sin etiquetas no hace nada.
 */
export function coerceCustomerFieldValue(
  field: BulkCustomerField,
  raw: unknown,
): unknown {
  switch (field.control) {
    case 'toggle':
      return Boolean(raw);

    case 'multiselect': {
      if (!Array.isArray(raw)) return [];
      return raw.map((entry) => String(entry));
    }

    case 'price-tier': {
      if (raw === null || raw === undefined || raw === '') return undefined;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return undefined;
      // Sentinela «Sin tarifa» → `null` en el payload.
      return parsed === NO_PRICE_TIER_VALUE ? null : parsed;
    }

    case 'tag-action': {
      if (!raw || typeof raw !== 'object') return undefined;
      const action = raw as { mode?: unknown; ids?: unknown };
      const ids = Array.isArray(action.ids)
        ? action.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
        : [];
      if (ids.length === 0) return undefined;
      return {
        mode: action.mode === 'remove' ? 'remove' : 'add',
        ids: [...new Set(ids)],
      };
    }

    case 'selector': {
      if (raw === null || raw === undefined || raw === '') return null;
      return String(raw);
    }

    case 'text':
    default: {
      const text = raw === null || raw === undefined ? '' : String(raw).trim();
      if (text === '' && field.emptyValue === null) return null;
      return text;
    }
  }
}
