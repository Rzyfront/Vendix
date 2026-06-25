import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CatalogService,
  MenuItem,
  MenuNextAvailable,
  MenuSection,
  PublicMenu,
} from '../../services/catalog.service';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';

type AvailabilityDisplay = 'hide' | 'badge';

interface RenderSection extends MenuSection {
  visibleItems: MenuItem[];
}

interface RenderMenu extends PublicMenu {
  visibleSections: RenderSection[];
}

/**
 * Dedicated storefront page (`/cartas`) showing the full restaurant menus
 * grouped by section, schedule-aware. Independent from the general catalog:
 * it consumes `/ecommerce/catalog/menus`, which returns nothing for
 * non-restaurant stores. The `hide`/`badge` behavior mirrors the store
 * setting `home_sections.menus.availability_display`.
 */
@Component({
  selector: 'app-menus-page',
  standalone: true,
  imports: [RouterModule, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './menus-page.component.html',
  styleUrls: ['./menus-page.component.scss'],
})
export class MenusPageComponent implements OnInit {
  private readonly catalogService = inject(CatalogService);
  private readonly tenantFacade = inject(TenantFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly availabilityDisplay = signal<AvailabilityDisplay>('hide');
  private readonly menus = signal<PublicMenu[]>([]);

  private static readonly DAY_LABELS = [
    'Domingo',
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
  ];

  /** Menus filtered/annotated for rendering per the availability setting. */
  readonly renderMenus = computed<RenderMenu[]>(() => {
    const display = this.availabilityDisplay();
    const out: RenderMenu[] = [];
    for (const menu of this.menus()) {
      const sections: RenderSection[] = [];
      for (const section of menu.sections ?? []) {
        const items = (section.items ?? []).filter((it) => {
          if (!it.product) return false;
          if (display === 'hide' && !it.is_available_now) return false;
          return true;
        });
        if (items.length === 0) continue;
        sections.push({ ...section, visibleItems: items });
      }
      if (sections.length === 0) continue;
      out.push({ ...menu, visibleSections: sections });
    }
    return out;
  });

  readonly hasMenus = computed(() => this.renderMenus().length > 0);

  ngOnInit(): void {
    this.tenantFacade.domainConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((domainConfig: any) => {
        const menusCfg =
          domainConfig?.customConfig?.ecommerce?.home_sections?.menus;
        const display = menusCfg?.availability_display;
        this.availabilityDisplay.set(display === 'badge' ? 'badge' : 'hide');
      });

    this.catalogService
      .getMenus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.menus.set(res.data?.menus ?? []);
          this.isLoading.set(false);
        },
        error: () => {
          this.menus.set([]);
          this.isLoading.set(false);
        },
      });
  }

  dishPrice(item: MenuItem): number {
    const p = item.product;
    if (!p) return 0;
    return p.is_on_sale && p.sale_price != null ? p.sale_price : p.base_price;
  }

  nextLabel(entity: { next_available: MenuNextAvailable | null }): string {
    const na = entity.next_available;
    if (!na) return 'pronto';
    const day = MenusPageComponent.DAY_LABELS[na.day_of_week] ?? '';
    return `${day} a las ${na.start_time}`.trim();
  }
}
