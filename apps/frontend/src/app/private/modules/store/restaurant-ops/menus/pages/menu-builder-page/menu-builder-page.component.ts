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
}

@Component({
  selector: 'app-menu-builder-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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
      description: p.is_combo ? 'Combo' : undefined,
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
    // Solo productos vendibles y activos: `is_active` NO existe en el
    // ProductQueryDto del backend (con forbidNonWhitelisted dispara 400);
    // los campos válidos son `state` e `is_sellable`.
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
            (resp.data ?? [])
              .filter((p) => (p as any).is_sellable !== false)
              .map((p) => ({
                id: p.id,
                name: p.name,
                base_price: p.base_price,
                is_sellable: (p as any).is_sellable,
                is_combo: (p as any).is_combo,
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
        next: () => {
          this.newSectionName.set('');
          this.loadMenu(menu.id);
        },
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al crear sección',
          ),
      });
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

  moveSection(section: MenuSection, direction: -1 | 1): void {
    const menu = this.menu();
    if (!menu) return;
    const ordered = [...(menu.sections ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    const idx = ordered.findIndex((s) => s.id === section.id);
    const target = idx + direction;
    if (target < 0 || target >= ordered.length) return;
    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    this.menusService
      .sortSections(menu.id, ordered.map((s) => s.id))
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

  moveItem(section: MenuSection, item: MenuSectionItem, dir: -1 | 1): void {
    const menu = this.menu();
    if (!menu) return;
    const items = [...(section.items ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    const idx = items.findIndex((i) => i.id === item.id);
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    this.menusService
      .sortItems(menu.id, section.id, items.map((i) => i.id))
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
      .updateAvailability(w.id, dto)
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
    this.menusService
      .removeAvailability(window.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const m = this.menu();
          if (m) this.loadMenu(m.id);
        },
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
