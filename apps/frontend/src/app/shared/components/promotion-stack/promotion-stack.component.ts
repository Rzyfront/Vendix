import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';

import {
  BadgeComponent,
  type BadgeVariant,
  type BadgeStyle,
  type BadgeSize,
} from '../badge/badge.component';
import { IconComponent } from '../icon/icon.component';
import { CurrencyPipe } from '../../pipes/currency';

/**
 * Modo de presentación del stack de promos.
 *
 * - `compact-pills`: pills verticales/horizontales minimalistas (cards, sidebar).
 * - `scroll-batch`: carrusel horizontal auto-advance (banners, header).
 * - `expanded-cards`: cards de tiers con progreso (PDP, cart-side).
 */
export type PromotionStackMode = 'compact-pills' | 'scroll-batch' | 'expanded-cards';

export type PromotionType =
  | 'percentage'
  | 'fixed_amount'
  | 'coupon'
  | 'order'
  | 'product'
  | 'category';

export type PromotionScope = 'order' | 'product' | 'category';

/**
 * Ítem normalizado del stack. Acepta promociones simples (percentage /
 * fixed_amount / coupon) y ladders de tiers (con `tier_index` y
 * `min_quantity`/`max_quantity`).
 */
export interface PromotionStackItem {
  id: string | number;
  /** Texto principal visible ("-15% OFF", "Desde 5 und: -10%", etc.). */
  label: string;
  type: PromotionType;
  /** Valor RAW — puntos % (percentage) o monto en centavos (fixed_amount). */
  value?: number;
  scope?: PromotionScope;
  min_quantity?: number;
  max_quantity?: number | null;
  discount_preview?: number;
  tier_index?: number;
  target_product_name?: string | null;
  /** Solo usado en `scroll-batch`. */
  featured?: boolean;
}

/**
 * `app-promotion-stack`
 *
 * Componente compartido (Angular 20, standalone, OnPush, zoneless) que
 * renderiza una lista de promociones en tres modos visuales. Es el destino
 * único de presentación para el módulo `CP-ECOM-PROMO-UX-001` y reemplaza
 * las implementaciones divergentes que existían en cards / cart / PDP /
 * sidebar.
 *
 * Reglas duras:
 * - Empty state: renderiza `null` cuando `items().length === 0`.
 * - Sin `effect()`, sin `@HostListener`. `setInterval` de `scroll-batch`
 *   se limpia por `DestroyRef.onDestroy()`.
 * - Auto-advance solo arranca si el media-query `prefers-reduced-motion`
 *   no está activo.
 * - Todos los `aria-label` en español.
 * - `data-testid` en root (`promotion-stack-{mode}`) y en cada item
 *   (`promotion-stack-item-{index}`).
 */
@Component({
  selector: 'app-promotion-stack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, BadgeComponent, IconComponent, CurrencyPipe],
  templateUrl: './promotion-stack.component.html',
  styleUrl: './promotion-stack.component.scss',
})
export class PromotionStackComponent {
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs (signal-input API) ─────────────────────────────────────────
  readonly items = input<PromotionStackItem[]>([]);
  readonly mode = input<PromotionStackMode>('compact-pills');
  /** Cantidad actual del producto en cotización. Usado por `expanded-cards`. */
  readonly currentQuantity = input<number | null>(null);
  readonly ariaLabel = input<string>('Promociones');
  /** Autoplay en ms para `scroll-batch`. Default 3500. */
  readonly autoplayMs = input<number>(3500);

  // ── Refs ──────────────────────────────────────────────────────────────
  private readonly scrollerRef = viewChild<ElementRef<HTMLElement>>('scroller');

  // ── Estado local (no expuesto por output) ────────────────────────────
  private readonly activeIndexSignal = signal(0);
  private autoplayInterval: ReturnType<typeof setInterval> | null = null;
  private autoplayPaused = false;
  private readonly initialReducedMotion =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  // ── Computeds ─────────────────────────────────────────────────────────
  readonly hasItems = computed(() => this.items().length > 0);

  /** Items del carrusel, con `featured` primero. */
  readonly scrollBatchItems = computed(() => {
    const list = [...this.items()];
    return list.sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  });

  /** Tiers ordenados por min_quantity ASC para `expanded-cards`. */
  readonly expandedTiers = computed(() =>
    this.items()
      .filter((it) => it.tier_index !== undefined || it.min_quantity !== undefined)
      .slice()
      .sort((a, b) => (a.min_quantity ?? 0) - (b.min_quantity ?? 0)),
  );

  /** Tier activo (currentQuantity dentro del rango del tier). */
  readonly currentTier = computed<PromotionStackItem | null>(() => {
    const qty = this.currentQuantity();
    if (qty === null) return null;
    const tiers = this.expandedTiers();
    return (
      tiers.find((t) => {
        const min = t.min_quantity ?? 0;
        const max = t.max_quantity ?? null;
        return qty >= min && (max === null || qty < max);
      }) ?? null
    );
  });

  /** Próximo tier (currentQuantity aún no llega). */
  readonly nextTier = computed<PromotionStackItem | null>(() => {
    const qty = this.currentQuantity();
    if (qty === null) {
      const tiers = this.expandedTiers();
      return tiers.length > 0 ? tiers[0] : null;
    }
    const tiers = this.expandedTiers();
    return tiers.find((t) => (t.min_quantity ?? 0) > qty) ?? null;
  });

  /** Ancho de la barra de progreso (0–100). */
  readonly progressPercent = computed<number>(() => {
    const qty = this.currentQuantity();
    const current = this.currentTier();
    const next = this.nextTier();
    if (qty === null) return 0;
    if (!current && !next) return 0;
    if (!next) return 100;
    if (!current) {
      // Todavía no se cruzó el primer tier; progreso "hacia el primero".
      const target = next.min_quantity ?? 1;
      return Math.min(100, Math.round((qty / target) * 100));
    }
    const min = current.min_quantity ?? 0;
    const target = next.min_quantity ?? min + 1;
    const span = target - min;
    if (span <= 0) return 100;
    const offset = qty - min;
    return Math.min(100, Math.round((offset / span) * 100));
  });

  /** Posición del item activo en scroll-batch (para aria-current). */
  readonly activeIndex = this.activeIndexSignal.asReadonly();

  constructor() {
    // Autoplay del scroll-batch: arranca vía microtask post-construcción
    // para que el viewChild ya esté disponible.
    this.destroyRef.onDestroy(() => this.stopAutoplay());
    queueMicrotask(() => this.syncAutoplay());
  }

  // ── Helpers de variante ──────────────────────────────────────────────
  pillVariant(type: PromotionType): BadgeVariant {
    switch (type) {
      case 'percentage':
        return 'success';
      case 'fixed_amount':
        return 'primary';
      case 'coupon':
        return 'warning';
      default:
        return 'success';
    }
  }

  pillStyle(type: PromotionType): BadgeStyle {
    if (type === 'percentage' || type === 'fixed_amount') return 'solid';
    return 'outline';
  }

  pillSize(): BadgeSize {
    return 'sm';
  }

  pillIcon(type: PromotionType): string {
    switch (type) {
      case 'percentage':
        return 'percent';
      case 'fixed_amount':
        return 'tag';
      case 'coupon':
        return 'ticket';
      case 'order':
        return 'star';
      case 'product':
        return 'shopping-cart';
      case 'category':
        return 'layers';
      default:
        return 'gift';
    }
  }

  /** Texto visible de un pill, con prefijo "Desde N und:". */
  pillText(item: PromotionStackItem): string {
    const min = item.min_quantity ?? 0;
    if (min > 1) return `Desde ${min} und: ${item.label}`;
    return item.label;
  }

  /** Descripción corta para scroll-batch card. */
  scrollBatchDescription(item: PromotionStackItem): string {
    if (item.type === 'percentage' && item.value !== undefined) {
      return `${item.value}% de descuento`;
    }
    if (item.type === 'fixed_amount' && item.value !== undefined) {
      return `${item.value} de descuento`;
    }
    if (item.type === 'coupon') return 'Cupón especial';
    if (item.type === 'order') return 'Promoción sobre el pedido';
    if (item.type === 'product') return 'Promoción de producto';
    if (item.type === 'category') return 'Promoción por categoría';
    return item.label;
  }

  /** Tooltip para tiers en expanded-cards. */
  tierHint(item: PromotionStackItem): string | null {
    const min = item.min_quantity ?? 0;
    if (item.max_quantity === null || item.max_quantity === undefined) {
      return `Desde ${min} unidades`;
    }
    return `De ${min} a ${item.max_quantity} unidades`;
  }

  /** aria-label de un pill. */
  pillAriaLabel(item: PromotionStackItem): string {
    return `Descuento: ${this.pillText(item)}`;
  }

  /** aria-label de un tier card. */
  tierAriaLabel(item: PromotionStackItem, index: number, total: number): string {
    return `Nivel ${index + 1} de ${total}: ${this.pillText(item)}`;
  }

  /** Etiqueta del header "Desde N und". */
  tierHeader(item: PromotionStackItem): string {
    const min = item.min_quantity ?? 0;
    return `Desde ${min} und`;
  }

  /** ¿Este tier es el actual? */
  isCurrentTier(item: PromotionStackItem): boolean {
    return this.currentTier()?.id === item.id;
  }

  /** ¿Este tier es el siguiente? */
  isNextTier(item: PromotionStackItem): boolean {
    return this.nextTier()?.id === item.id;
  }

  /** ¿Es un tier ya superado (current o anterior)? */
  isAchievedTier(item: PromotionStackItem): boolean {
    const qty = this.currentQuantity();
    if (qty === null) return false;
    const min = item.min_quantity ?? 0;
    return qty >= min;
  }

  /** Cantidad que falta para el próximo tier. */
  remainingQty(): number {
    const qty = this.currentQuantity();
    const next = this.nextTier();
    if (qty === null || !next) return 0;
    const need = next.min_quantity ?? 0;
    return Math.max(0, need - qty);
  }

  // ── Scroll-batch: autoplay ────────────────────────────────────────────
  private syncAutoplay(): void {
    if (this.mode() === 'scroll-batch') {
      this.startAutoplay();
    } else {
      this.stopAutoplay();
    }
  }

  private startAutoplay(): void {
    if (this.autoplayInterval || this.initialReducedMotion) return;
    this.autoplayInterval = setInterval(() => this.advanceScroll(), this.autoplayMs());
  }

  private stopAutoplay(): void {
    if (this.autoplayInterval) {
      clearInterval(this.autoplayInterval);
      this.autoplayInterval = null;
    }
  }

  pauseAutoplay(): void {
    this.autoplayPaused = true;
    this.stopAutoplay();
  }

  resumeAutoplay(): void {
    if (this.autoplayPaused) {
      this.autoplayPaused = false;
      this.startAutoplay();
    }
  }

  private advanceScroll(): void {
    const items = this.scrollBatchItems();
    if (items.length === 0) return;
    const next = (this.activeIndexSignal() + 1) % items.length;
    this.scrollTo(next);
  }

  scrollTo(index: number): void {
    const items = this.scrollBatchItems();
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    this.activeIndexSignal.set(clamped);
    const scroller = this.scrollerRef()?.nativeElement;
    if (!scroller) return;
    const child = scroller.children[clamped] as HTMLElement | undefined;
    if (!child) return;
    scroller.scrollTo({ left: child.offsetLeft - scroller.offsetLeft, behavior: 'smooth' });
  }
}
