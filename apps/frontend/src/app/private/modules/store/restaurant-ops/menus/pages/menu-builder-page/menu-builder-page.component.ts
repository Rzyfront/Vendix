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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
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
    RouterLink,
    StickyHeaderComponent,
    CardComponent,
  ],
  templateUrl: './menu-builder-page.component.html',
  styleUrl: './menu-builder-page.component.scss',
})
export class MenuBuilderPageComponent implements OnInit {
  private readonly menusService = inject(MenusService);
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);
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

  deleteSection(section: MenuSection): void {
    if (!confirm(`¿Eliminar la sección "${section.name}"?`)) return;
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

  removeItem(section: MenuSection, item: MenuSectionItem): void {
    if (!confirm('¿Quitar este producto de la sección?')) return;
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

  deleteWindow(window: AvailabilityWindow): void {
    if (!confirm('¿Eliminar la ventana?')) return;
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
