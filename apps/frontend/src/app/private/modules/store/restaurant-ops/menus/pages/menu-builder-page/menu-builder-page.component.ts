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
} from '../../interfaces';
import { MenusService } from '../../services';
import { ProductsService } from '../../../../products/services/products.service';

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

  readonly totalProductsInMenu = computed(() => {
    const m = this.menu();
    if (!m) return 0;
    return m.sections.reduce(
      (acc, s) => acc + (s.items?.length ?? 0),
      0,
    );
  });

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id') ?? 0);
    if (!id) {
      this.router.navigate(['/admin/restaurant-ops/menus']);
      return;
    }
    this.loadMenu(id);
    this.loadProducts();
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
    this.productsService
      .getProducts({ limit: 200, is_active: true } as any)
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
            })),
          );
        },
        error: () => undefined,
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
