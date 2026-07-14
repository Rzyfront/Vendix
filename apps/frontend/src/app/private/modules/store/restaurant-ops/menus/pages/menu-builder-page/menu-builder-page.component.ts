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
import { forkJoin } from 'rxjs';
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
  ModalComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import type { StickyHeaderActionButton } from '../../../../../../../shared/components/sticky-header/sticky-header.component';

import {
  AvailabilityWindow,
  MenuFull,
  MenuSection,
  MenuSectionItem,
  UpdateMenuSectionDto,
} from '../../interfaces';
import { MenusService } from '../../services';
import { ProductsService } from '../../../../products/services/products.service';
import { ProductState } from '../../../../products/interfaces/product.interface';
import {
  MenuProductPickerModalComponent,
  MenuProductOption,
} from '../../components/menu-product-picker-modal/menu-product-picker-modal.component';
import {
  MenuWindowModalComponent,
  MenuWindowValue,
} from '../../components/menu-window-modal/menu-window-modal.component';

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
    ModalComponent,
    MenuProductPickerModalComponent,
    MenuWindowModalComponent,
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

  readonly productOptions = signal<ProductOption[]>([]);

  /** R2 — edición del nombre de la carta vía modal (antes barra inline, retirada
   * porque gastaba espacio vertical). `editingMenuName` abre/cierra el modal;
   * `editingMenuNameDraft` es el borrador enlazado al input del modal. */
  readonly editingMenuName = signal(false);
  readonly editingMenuNameDraft = signal('');

  /** Acciones del sticky-header en modo edición: renombrar (abre modal) y
   * guardar y salir (la vista autoguarda; el botón navega al listado). */
  readonly headerActions: StickyHeaderActionButton[] = [
    {
      id: 'rename',
      label: 'Cambiar nombre',
      variant: 'outline',
      icon: 'pencil',
    },
    {
      id: 'exit',
      label: 'Guardar y salir',
      variant: 'primary',
      icon: 'check',
    },
  ];

  /** R3 — modal "Nueva sección" (botón compacto en el header de la card). */
  readonly sectionModalOpen = signal(false);
  readonly sectionModalName = signal('');

  /** R4 — picker multi-select de productos por sección. `pickerSectionId`
   * recuerda a qué sección aplicar los ids confirmados. */
  readonly pickerOpen = signal(false);
  readonly pickerSectionId = signal<number | null>(null);

  /** R5/R6 — modal de ventana horaria. `editingWindow` null ⇒ modo creación;
   * con valor ⇒ modo edición (el modal precarga `initialValue`). */
  readonly windowModalOpen = signal(false);
  readonly editingWindow = signal<AvailabilityWindow | null>(null);

  /** Edición inline de nombre de sección (Fase 2 alignment). */
  readonly editingSectionId = signal<number | null>(null);
  readonly editingSectionName = signal<string>('');

  /** R4 — universo de productos para el picker, mapeado a su contrato plano
   * (`MenuProductOption`) desde la data ya cargada en `loadProducts`. */
  readonly pickerProducts = computed<MenuProductOption[]>(() =>
    this.productOptions().map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      imageUrl: p.imageUrl,
      isCombo: p.is_combo,
      isSellable: p.is_sellable,
    })),
  );

  /** R4 — ids de productos ya presentes en CUALQUIER sección de la carta. El
   * picker los muestra marcados como "En la carta" y no seleccionables, para
   * evitar duplicar el mismo producto dentro de la carta (antes solo se
   * excluían los de la sección activa, ocultándolos). */
  readonly pickerInMenuIds = computed<number[]>(() => {
    const m = this.menu();
    if (!m) return [];
    const ids = new Set<number>();
    for (const s of m.sections) {
      for (const it of s.items ?? []) ids.add(it.product_id);
    }
    return Array.from(ids);
  });

  /** R6 — valor inicial del modal de ventana en modo edición (null = creación). */
  readonly windowInitialValue = computed<MenuWindowValue | null>(() => {
    const w = this.editingWindow();
    if (!w) return null;
    return {
      day_of_week: w.day_of_week,
      start_time: w.start_time,
      end_time: w.end_time,
    };
  });

  readonly totalProductsInMenu = computed(() => {
    const m = this.menu();
    if (!m) return 0;
    return m.sections.reduce((acc, s) => acc + (s.items?.length ?? 0), 0);
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
              // respuesta del backend no los trae (sin romper el picker).
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

  // -------------------------- sticky-header actions --------------------

  /** Despacha las acciones del sticky-header (renombrar / salir). */
  onHeaderAction(id: string): void {
    if (id === 'rename') {
      this.startEditMenuName();
    } else if (id === 'exit') {
      this.exitBuilder();
    }
  }

  /** Vuelve al listado de cartas. La vista autoguarda cada cambio, así que no
   * hay nada pendiente que persistir aquí. */
  exitBuilder(): void {
    this.router.navigate(['/admin/restaurant-ops/menus']);
  }

  // -------------------------- menu name (modal, R2) --------------------

  startEditMenuName(): void {
    const m = this.menu();
    if (!m) return;
    this.editingMenuNameDraft.set(m.name);
    this.editingMenuName.set(true);
  }

  cancelEditMenuName(): void {
    this.editingMenuName.set(false);
    this.editingMenuNameDraft.set('');
  }

  onEditMenuName(value: string): void {
    this.editingMenuNameDraft.set(value);
  }

  saveMenuName(): void {
    const m = this.menu();
    const name = this.editingMenuNameDraft().trim();
    if (!m || !name || name === m.name) {
      this.cancelEditMenuName();
      return;
    }
    this.menusService
      .update(m.id, { name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          // Refresca el nombre mostrado (sticky header + name bar) sin recargar
          // la carta completa: conserva secciones/ventanas ya cargadas.
          this.menu.set({ ...m, name: updated.name });
          this.toastService.success('Nombre de la carta actualizado');
          this.cancelEditMenuName();
        },
        error: (e: unknown) => {
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al actualizar el nombre',
          );
        },
      });
  }

  // -------------------------- sections (R3) ----------------------------

  openSectionModal(): void {
    this.sectionModalName.set('');
    this.sectionModalOpen.set(true);
  }

  closeSectionModal(): void {
    this.sectionModalOpen.set(false);
    this.sectionModalName.set('');
  }

  confirmSectionModal(): void {
    const name = this.sectionModalName().trim();
    if (!name) return;
    this.createSectionWithName(name);
  }

  /** Crea una sección con el nombre dado (reusa la lógica del antiguo
   * `addSection`, ahora alimentado por el modal en vez del input fijo). */
  private createSectionWithName(name: string): void {
    const menu = this.menu();
    if (!menu) return;
    this.menusService
      .createSection(menu.id, { name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          // La sección nueva entra expandida (loadMenu la auto-expande al ser
          // desconocida, pero lo hacemos explícito para dejar la intención clara).
          this.expandSection(created.id);
          this.toastService.success('Sección creada');
          this.closeSectionModal();
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

  // -------------------------- section items (R4) -----------------------

  /** Abre el picker multi-select recordando la sección destino. */
  openProductPicker(section: MenuSection): void {
    this.pickerSectionId.set(section.id);
    this.pickerOpen.set(true);
  }

  /** Agrega TODOS los ids elegidos con forkJoin y refresca al completar. */
  onPickerConfirmed(ids: number[]): void {
    const menu = this.menu();
    const sectionId = this.pickerSectionId();
    if (!menu || sectionId == null || ids.length === 0) {
      this.closeProductPicker();
      return;
    }
    forkJoin(
      ids.map((id) =>
        this.menusService.addItem(menu.id, sectionId, { product_id: id }),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            ids.length === 1
              ? 'Producto agregado'
              : `${ids.length} productos agregados`,
          );
          this.closeProductPicker();
          this.loadMenu(menu.id);
        },
        error: (e: unknown) => {
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al agregar productos',
          );
          this.closeProductPicker();
        },
      });
  }

  onPickerClosed(): void {
    this.closeProductPicker();
  }

  private closeProductPicker(): void {
    this.pickerOpen.set(false);
    this.pickerSectionId.set(null);
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

  isEditingSection(id: number): boolean {
    return this.editingSectionId() === id;
  }

  // -------------------------- availability windows (R5/R6) -------------

  /** Abre el modal de ventana en modo creación. */
  openWindowCreate(): void {
    this.editingWindow.set(null);
    this.windowModalOpen.set(true);
  }

  /** Abre el modal de ventana en modo edición precargado. */
  openWindowEdit(w: AvailabilityWindow): void {
    this.editingWindow.set(w);
    this.windowModalOpen.set(true);
  }

  /** Crea o actualiza según `editingWindow`. Captura el 422 real del backend
   * (llega como string vía MenusService.handleError) y lo muestra como toast,
   * dejando el modal abierto para que el usuario corrija. */
  onWindowConfirmed(value: MenuWindowValue): void {
    const menu = this.menu();
    if (!menu) return;
    const editing = this.editingWindow();
    const request$ = editing
      ? this.menusService.updateAvailability(menu.id, editing.id, value)
      : this.menusService.createAvailability(menu.id, value);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.success(
          editing ? 'Ventana actualizada' : 'Ventana creada',
        );
        this.closeWindowModal();
        this.loadMenu(menu.id);
      },
      error: (e: unknown) => {
        this.toastService.error(
          typeof e === 'string' ? e : 'Error al guardar la ventana',
        );
        // No cerramos el modal: el usuario conserva sus datos y puede corregir.
      },
    });
  }

  onWindowClosed(): void {
    this.closeWindowModal();
  }

  private closeWindowModal(): void {
    this.windowModalOpen.set(false);
    this.editingWindow.set(null);
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

  /** Miniatura del producto de un ítem de carta. Prioriza `image_url` del
   * snapshot del backend (autoritativo, viene en getFull) y cae al lookup de
   * `productOptions` (limitado a 200 activos) sólo si el snapshot no la trae.
   * Devuelve null ⇒ la plantilla pinta un placeholder de ícono. */
  itemImage(item: MenuSectionItem): string | null {
    return (
      item.product?.image_url ??
      this.productOptions().find((p) => p.id === item.product_id)?.imageUrl ??
      null
    );
  }
}
