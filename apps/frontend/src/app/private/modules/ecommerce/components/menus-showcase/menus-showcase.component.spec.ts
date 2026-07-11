import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { MenusShowcaseComponent } from './menus-showcase.component';
import {
  CatalogService,
  MenuItem,
  PublicMenu,
  PublicMenusResponse,
} from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

/** Minimal product shape attached to each item (only fields the showcase reads). */
function makeItem(
  id: number,
  opts: Partial<Pick<MenuItem, 'is_available_now' | 'next_available'>> = {},
): MenuItem {
  return {
    id,
    product_id: id * 10,
    sort_order: 0,
    is_available_now: opts.is_available_now ?? true,
    next_available: opts.next_available ?? null,
    product: {
      id: id * 10,
      name: `Plato ${id}`,
      slug: `plato-${id}`,
      base_price: 10000,
      sale_price: null,
      is_on_sale: false,
      is_combo: false,
      has_variants: false,
      variant_count: 0,
      image_url: null,
    },
  };
}

function makeMenu(
  id: number,
  opts: {
    is_active?: boolean;
    is_available_now?: boolean;
    next_available?: MenuItem['next_available'];
    items?: MenuItem[];
  } = {},
): PublicMenu {
  const items = opts.items ?? [];
  return {
    id,
    name: `Carta ${id}`,
    is_active: opts.is_active ?? true,
    is_available_now: opts.is_available_now ?? false,
    next_available: opts.next_available ?? null,
    availability_windows: [],
    sections: items.length
      ? [
          {
            id: id * 100,
            name: 'Sección 1',
            sort_order: 0,
            is_available_now: opts.is_available_now ?? false,
            next_available: null,
            availability_windows: [],
            items,
          },
        ]
      : [],
  };
}

function makeResponse(
  now: { day_of_week: number; minutes: number },
  menus: PublicMenu[],
): { success: boolean; data: PublicMenusResponse } {
  return {
    success: true,
    data: { store_timezone: 'America/Bogota', now, menus },
  };
}

describe('MenusShowcaseComponent', () => {
  let fixture: ComponentFixture<MenusShowcaseComponent>;
  let component: MenusShowcaseComponent;
  let getMenus$: { success: boolean; data: PublicMenusResponse };

  function configureWith(menus: PublicMenu[], now: { day_of_week: number; minutes: number }): void {
    getMenus$ = makeResponse(now, menus);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: CatalogService,
          useValue: { getMenus: () => of(getMenus$) },
        },
        { provide: CartService, useValue: {} },
        { provide: ToastService, useValue: {} },
      ],
    });
    fixture = TestBed.createComponent(MenusShowcaseComponent);
    component = fixture.componentInstance;
    // Lógica-only: disparar ngOnInit a mano evita renderizar el template (que
    // usa CurrencyPipe → CurrencyFormatService → HttpClient) y aisla el spec a
    // los computed signals. `of(...)` es síncrono, así los signals quedan listos.
    component.ngOnInit();
  }

  it('(a) renderiza un bloque por carta disponible', () => {
    const now = { day_of_week: 2, minutes: 600 };
    const m1 = makeMenu(1, {
      is_available_now: true,
      items: [makeItem(11, { is_available_now: true }), makeItem(12, { is_available_now: true })],
    });
    const m2 = makeMenu(2, {
      is_available_now: true,
      items: [makeItem(21, { is_available_now: true })],
    });
    // Carta 3 cerrada → no debe aparecer en renderCartas
    const m3 = makeMenu(3, {
      is_available_now: false,
      next_available: { day_of_week: 3, start_time: '08:00' },
      items: [makeItem(31, { is_available_now: false })],
    });
    configureWith([m1, m2, m3], now);

    expect(component.renderCartas().length).toBe(2);
    expect(component.renderCartas()[0].menu.id).toBe(1);
    expect(component.renderCartas()[0].dishes.length).toBe(2);
    expect(component.renderCartas()[1].menu.id).toBe(2);
    expect(component.showFallback()).toBeFalse();
  });

  it('(b) fallback elige la carta con menor delta incluyendo wrap semanal', () => {
    // Lunes mediodía: day_of_week=1, minutes=720
    const now = { day_of_week: 1, minutes: 720 };
    // Carta A: cierra ahora, reapertura hoy Lunes 18:00 → delta 360
    const a = makeMenu(10, {
      is_available_now: false,
      next_available: { day_of_week: 1, start_time: '18:00' },
      items: [makeItem(101, { is_available_now: false })],
    });
    // Carta B: reapertura Domingo (day 0) 12:00 → dayDiff=6 → delta 8640
    // (un día "anterior" en la semana ⇒ delta MAYOR por wrap, no menor)
    const b = makeMenu(20, {
      is_available_now: false,
      next_available: { day_of_week: 0, start_time: '12:00' },
      items: [makeItem(201, { is_available_now: false })],
    });
    // Carta C: reapertura Martes (day 2) 08:00 → dayDiff=1 → delta 1200
    const c = makeMenu(30, {
      is_available_now: false,
      next_available: { day_of_week: 2, start_time: '08:00' },
      items: [makeItem(301, { is_available_now: false })],
    });
    configureWith([a, b, c], now);

    expect(component.renderCartas().length).toBe(0);
    expect(component.showFallback()).toBeTrue();
    // Menor delta = A (360) < C (1200) < B (8640)
    expect(component.fallbackMenu()?.menu.id).toBe(10);
  });

  it('(c) sin cartas → sin fallback y sección vacía', () => {
    configureWith([], { day_of_week: 1, minutes: 0 });

    expect(component.renderCartas().length).toBe(0);
    expect(component.fallbackMenu()).toBeNull();
    expect(component.showFallback()).toBeFalse();
  });
});