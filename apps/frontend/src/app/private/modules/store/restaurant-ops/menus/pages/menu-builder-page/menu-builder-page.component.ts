import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';

import {
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import {
  AvailabilityWindow,
  CreateAvailabilityWindowDto,
  MenuFull,
  MenuSection,
  MenuSectionItem,
  UpdateMenuSectionDto,
  UpdateAvailabilityWindowDto,
} from '../../interfaces';
import { MenusService } from '../../services';
import { ProductsService } from '../../../../products/services/products.service';
import { ProductState } from '../../../../products/interfaces/product.interface';

const DAY_LABELS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

interface ProductOption {
  id: number;
  name: string;
  base_price?: number | string | null;
  is_sellable?: boolean;
  is_combo?: boolean;
  /** Miniatura del producto (Feature C): se muestra a la izquierda del label. */
  imageUrl?: string;
  /** Nombre de categoría (Feature C): se muestra a la derecha del dropdown. */
  category?: string;
}

@Component({
  selector: 'app-menu-builder-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    StickyHeaderComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
  ],
  templateUrl: './menu-builder-page.component.html',
  styleUrl: './menu-builder-page.component.scss',
})
export class MenuBuilderPageComponent implements OnInit {
  private readonly menusService = inject(MenusService);
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly menu = signal<MenuFull | null>(null);
  readonly isLoading = signal(false);
  readonly dayLabels = DAY_LABELS;

  /** Secciones actualmente expandidas (acordeón). Se inicializa con todas las
   * secciones en el primer load y auto-expande las recién creadas, preservando
   * los colapsos manuales del usuario entre recargas. */
  readonly expandedSectionIds = signal<Set<number>>(new Set<number>());
  /** Secciones ya vistas: distingue "recién creada" (auto-expandir) de
   * "existente que el usuario pudo haber colapsado". No es signal — es memoria
   * de control interno, no estado observado por la plantilla. */
  private readonly knownSectionIds = new Set<number>();

  /** Secciones ordenadas por sort_order: fuente única para el @for y para que
   * los índices del drag & drop coincidan con lo renderizado. */
  readonly sortedSections = computed<MenuSection[]>(() => {
    const m = this.menu();
    if (!m) return [];
    return [...m.sections].sort((a, b) => a.sort_order - b.sort_order);
  });

  /** Modo creación: la ruta `new` no trae `:id`. El builder renderiza un
   * formulario de nombre y, al guardar, crea la carta y pasa a modo edición. */
  readonly isCreateMode = signal(false);
  readonly isSaving = signal(false);
  readonly newMenuName = signal('');

  readonly newSectionName = signal('');
  readonly newItemProductId = signal<number | null>(null);
  readonly productOptions = signal<ProductOption[]>([]);
  readonly newWindow = signal<CreateAvailabilityWindowDto>({
    day_of_week: 1,
    start_time: '08:00',
    end_time: '12:00',
  });

  /** Opciones de día de la semana para el app-selector de ventanas. */
  readonly dayOptions: SelectorOption[] = DAY_LABELS.map((d, i) => ({
    value: i,
    label: d,
  }));

  /** Edición inline de nombre de sección (Fase 2 alignment). */
  readonly editingSectionId = signal<number | null>(null);
  readonly editingSectionName = signal<string>('');

  /** Edición inline de ventana horaria (Fase 2 alignment). */
  readonly editingWindowId = signal<number | null>(null);
  readonly editingWindowDraft = signal<{
    day_of_week: number;
    start_time: string;
    end_time: string;
  }>({
    day_of_week: 1,
    start_time: '08:00',
    end_time: '12:00',
  });

  /** Mapea los productos disponibles al contrato SelectorOption del app-selector. */
  readonly productSelectorOptions = computed<SelectorOption[]>(() =>
    this.productOptions().map((p) => ({
      value: p.id,
      label:
        p.name +
        (p.is_combo ? ' · Combo' : '') +
        (p.is_sellable === false ? ' · (no vendible)' : ''),
      // Categoría a la derecha del dropdown (degrada a undefined si no vino).
      description: p.category,
      // Miniatura a la izquierda (el app-selector la renderiza en modo searchable).
      imageUrl: p.imageUrl,
    })),
  );

  /**
   * Patch parcial de newWindow. Los templates de Angular no soportan el
   * operador spread, así que el merge se hace aquí (en TS) y el template solo
   * pasa el campo cambiado: (ngModelChange)="updateNewWindow({ start_time: $event })".
   */
  updateNewWindow(patch: Partial<CreateAvailabilityWindowDto>): void {
    this.newWindow.set({ ...this.newWindow(), ...patch });
  }

  /**
   * Handler tipado para el app-selector de producto. El CVA emite
   * `string | number | null`; lo normalizamos a `number | null` aquí (en TS)
   * para no romper strict templates ni el tipo del signal.
   */
  onProductSelect(value: string | number | null): void {
    this.newItemProductId.set(value == null ? null : Number(value));
  }

  /**
   * Handler tipado para el app-selector de día. Normaliza el valor emitido por
   * el CVA (`string | number | null`) a `number` antes de mergear en newWindow.
   */
  onDaySelect(value: string | number | null): void {
    this.updateNewWindow({ day_of_week: value == null ? 0 : Number(value) });
  }

  readonly selectedProductIsCombo = computed(() => {
    const id = this.newItemProductId();
    if (id == null) return false;
    return this.productOptions().find((p) => p.id === id)?.is_combo === true;
  });

  readonly totalProductsInMenu = computed(() => {
    const m = this.menu();
    if (!m) return 0;
    return m.sections.reduce(
      (acc, s) => acc + (s.items?.length ?? 0),
      0,
    );
  });

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const id = Number(idParam);
    // Sin `:id` válido ⇒ ruta `new` ⇒ modo creación (no rebotar al listado).
    if (!idParam || Number.isNaN(id) || id <= 0) {
      this.isCreateMode.set(true);
      this.loadProducts();
      return;
    }
    this.isCreateMode.set(false);
    this.loadMenu(id);
    this.loadProducts();
  }

  /** Crea la carta desde el formulario de modo creación y pasa a edición. */
  createMenu(): void {
    const name = this.newMenuName().trim();
    if (!name) {
      this.toastService.error('El nombre de la carta es obligatorio');
      return;
    }
    this.isSaving.set(true);
    this.menusService
      .create({ name, is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.isSaving.set(false);
          this.toastService.success('Carta creada');
          // Reemplaza la URL: el builder se recrea en modo edición y carga la carta.
          this.router.navigate(
            ['/admin/restaurant-ops/menus', created.id, 'edit'],
            { replaceUrl: true },
          );
        },
        error: (e: unknown) => {
          this.isSaving.set(false);
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al crear la carta',
          );
        },
      });
  }

  private loadMenu(id: number): void {
    this.isLoading.set(true);
    this.menusService
      .getFull(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.menu.set(data);
          // Auto-expande las secciones no vistas antes (todas en el primer
          // load y cualquier sección recién creada); conserva los colapsos
          // manuales del usuario en las recargas posteriores.
          const expanded = new Set(this.expandedSectionIds());
          for (const s of data.sections ?? []) {
            if (!this.knownSectionIds.has(s.id)) {
              this.knownSectionIds.add(s.id);
              expanded.add(s.id);
            }
          }
          this.expandedSectionIds.set(expanded);
          this.isLoading.set(false);
        },
        error: (e: unknown) => {
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al cargar la carta',
          );
          this.isLoading.set(false);
        },
      });
  }

  private loadProducts(): void {
    // Mostramos productos activos y vendibles para armar la carta. El campo
    // de filtro válido es `is_sellable` (whitelisted en ProductQueryDto); los
    // insumos crudos quedan fuera porque tienen is_sellable=false. NO usar
    // `is_ingredient` ni `is_active`: NO existen en ProductQueryDto y
    // forbidNonWhitelisted devuelve 400, dejando el selector vacío
    // ("nunca aparecen resultados"). El backend promueve available_for_ecommerce
    // al agregar el producto a una sección (invariante carta⇒comprable).
    this.productsService
      .getProducts({
        limit: 200,
        state: ProductState.ACTIVE,
        is_sellable: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          this.productOptions.set(
            (resp.data ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              base_price: p.base_price,
              is_sellable: (p as any).is_sellable,
              is_combo: (p as any).is_combo,
              // Feature C: miniatura + categoría. Degradan a undefined si la
              // respuesta del backend no los trae (sin romper el selector).
              imageUrl: p.image_url,
              category: p.category?.name ?? p.categories?.[0]?.name,
            })),
          );
        },
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al cargar los productos',
          ),
      });
  }

  // -------------------------- sections ---------------------------------

  addSection(): void {
    const menu = this.menu();
    const name = this.newSectionName().trim();
    if (!menu || !name) return;
    this.menusService
      .createSection(menu.id, { name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.newSectionName.set('');
          // La sección nueva entra expandida (loadMenu la auto-expande al ser
          // desconocida, pero lo hacemos explícito para dejar la intención clara).
          this.expandSection(created.id);
          this.loadMenu(menu.id);
        },
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al crear sección',
          ),
      });
  }

  // -------------------------- accordion (expand/collapse) --------------

  isSectionExpanded(id: number): boolean {
    return this.expandedSectionIds().has(id);
  }

  toggleSection(id: number): void {
    const next = new Set(this.expandedSectionIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.expandedSectionIds.set(next);
  }

  private expandSection(id: number): void {
    const next = new Set(this.expandedSectionIds());
    next.add(id);
    this.knownSectionIds.add(id);
    this.expandedSectionIds.set(next);
  }

  /** Ítems de una sección ordenados por sort_order (fuente para el @for y el
   * drag & drop de productos). Devuelve copia nueva: seguro para moveItemInArray. */
  sortedItems(section: MenuSection): MenuSectionItem[] {
    return [...(section.items ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
  }

  async deleteSection(section: MenuSection): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar sección',
      message: `¿Eliminar la sección "${section.name}"?`,
      confirmText: 'Eliminar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    const menu = this.menu();
    if (!menu) return;
    this.menusService
      .removeSection(menu.id, section.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadMenu(menu.id),
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al eliminar sección',
          ),
      });
  }

  /** Drop de sección (drag & drop). Reordena la lista visible y persiste el
   * nuevo orden con sortSections (reemplaza las flechas chevron-up/down). */
  onSectionDrop(event: CdkDragDrop<MenuSection[]>): void {
    const menu = this.menu();
    if (!menu || event.previousIndex === event.currentIndex) return;
    const ordered = [...this.sortedSections()];
    moveItemInArray(ordered, event.previousIndex, event.currentIndex);
    this.menusService
      .sortSections(
        menu.id,
        ordered.map((s) => s.id),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadMenu(menu.id),
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al reordenar',
          ),
      });
  }

  // -------------------------- section items ----------------------------

  addItem(section: MenuSection): void {
    const menu = this.menu();
    const pid = this.newItemProductId();
    if (!menu || !pid) return;
    this.menusService
      .addItem(menu.id, section.id, { product_id: pid })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.newItemProductId.set(null);
          this.loadMenu(menu.id);
        },
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al agregar producto',
          ),
      });
  }

  async removeItem(section: MenuSection, item: MenuSectionItem): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Quitar producto',
      message: '¿Quitar este producto de la sección?',
      confirmText: 'Eliminar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    const menu = this.menu();
    if (!menu) return;
    this.menusService
      .removeItem(menu.id, section.id, item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadMenu(menu.id),
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al quitar producto',
          ),
      });
  }

  /** Drop de ítem dentro de una sección (drag & drop). Cada sección tiene su
   * propia cdkDropList (no conectadas entre sí), así que un ítem no salta de
   * sección. Persiste con sortItems (reemplaza las flechas chevron-up/down). */
  onItemDrop(event: CdkDragDrop<MenuSectionItem[]>, section: MenuSection): void {
    const menu = this.menu();
    if (!menu || event.previousIndex === event.currentIndex) return;
    const items = this.sortedItems(section);
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    this.menusService
      .sortItems(
        menu.id,
        section.id,
        items.map((i) => i.id),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadMenu(menu.id),
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al reordenar',
          ),
      });
  }

  // -------------------------- section rename (inline) ---------------

  startEditSection(section: MenuSection): void {
    this.editingSectionId.set(section.id);
    this.editingSectionName.set(section.name);
  }

  cancelEditSection(): void {
    this.editingSectionId.set(null);
    this.editingSectionName.set('');
  }

  saveSectionName(section: MenuSection): void {
    const name = this.editingSectionName().trim();
    const menu = this.menu();
    if (!menu || !name || name === section.name) {
      this.cancelEditSection();
      return;
    }
    const dto: UpdateMenuSectionDto = { name };
    this.menusService
      .updateSection(menu.id, section.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Sección renombrada');
          this.cancelEditSection();
          this.loadMenu(menu.id);
        },
        error: (e: unknown) => {
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al renombrar la sección',
          );
        },
      });
  }

  onEditSectionName(value: string): void {
    this.editingSectionName.set(value);
  }

  // -------------------------- window edit (inline) --------------------

  startEditWindow(w: AvailabilityWindow): void {
    this.editingWindowId.set(w.id);
    this.editingWindowDraft.set({
      day_of_week: w.day_of_week,
      start_time: w.start_time,
      end_time: w.end_time,
    });
  }

  cancelEditWindow(): void {
    this.editingWindowId.set(null);
  }

  saveWindow(w: AvailabilityWindow): void {
    const draft = this.editingWindowDraft();
    const menu = this.menu();
    if (!menu) return;
    // No-op si nada cambió.
    if (
      draft.day_of_week === w.day_of_week &&
      draft.start_time === w.start_time &&
      draft.end_time === w.end_time
    ) {
      this.cancelEditWindow();
      return;
    }
    if (!draft.start_time || !draft.end_time) {
      this.toastService.error('Hora de inicio y fin son obligatorias');
      return;
    }
    const dto: UpdateAvailabilityWindowDto = {
      day_of_week: draft.day_of_week,
      start_time: draft.start_time,
      end_time: draft.end_time,
    };
    this.menusService
      .updateAvailability(menu.id, w.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Ventana actualizada');
          this.cancelEditWindow();
          this.loadMenu(menu.id);
        },
        error: (e: unknown) => {
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al actualizar la ventana',
          );
        },
      });
  }

  updateEditingWindow(patch: Partial<{ day_of_week: number; start_time: string; end_time: string }>): void {
    this.editingWindowDraft.set({ ...this.editingWindowDraft(), ...patch });
  }

  onEditingDaySelect(value: string | number | null): void {
    this.updateEditingWindow({
      day_of_week: value == null ? 0 : Number(value),
    });
  }

  isEditingSection(id: number): boolean {
    return this.editingSectionId() === id;
  }

  isEditingWindow(id: number): boolean {
    return this.editingWindowId() === id;
  }

  // -------------------------- availability windows ---------------------

  addWindow(): void {
    const menu = this.menu();
    if (!menu) return;
    const w = this.newWindow();
    this.menusService
      .createAvailability(menu.id, w)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.newWindow.set({
            day_of_week: 1,
            start_time: '08:00',
            end_time: '12:00',
          });
          this.loadMenu(menu.id);
        },
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al crear ventana',
          ),
      });
  }

  async deleteWindow(window: AvailabilityWindow): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar ventana',
      message: '¿Eliminar la ventana?',
      confirmText: 'Eliminar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    const menu = this.menu();
    if (!menu) return;
    this.menusService
      .removeAvailability(menu.id, window.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadMenu(menu.id),
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al eliminar ventana',
          ),
      });
  }

  // -------------------------- helpers ----------------------------------

  getProductName(productId: number): string {
    return (
      this.productOptions().find((p) => p.id === productId)?.name ??
      `#${productId}`
    );
  }
}
