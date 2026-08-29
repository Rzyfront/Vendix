import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgClass, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { HighConversionService } from '../../services/high-conversion.service';

import {
  BadgeComponent,
  type BadgeVariant,
  type BadgeStyle,
  type BadgeSize,
} from '../badge/badge.component';
import { IconComponent } from '../icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../pipes/currency';

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
 * - Sin `@HostListener`. `setInterval` de `scroll-batch` y
 *   `IntersectionObserver` se limpian por `DestroyRef.onDestroy()`.
 * - `effect()` se permite SOLO para side-effects (emitir outputs
 *   `promotionViewed` / `promotionIntent`); la UI re-renderea por
 *   signals nativos (zoneless CD).
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
  imports: [NgClass, NgSwitch, NgSwitchCase, BadgeComponent, IconComponent],
  templateUrl: './promotion-stack.component.html',
  styleUrl: './promotion-stack.component.scss',
})
export class PromotionStackComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly currencyFormat = inject(CurrencyFormatService);
  protected readonly highConversionService = inject(HighConversionService);

  // (Constructor original al final del archivo)

  // ── Inputs (signal-input API) ─────────────────────────────────────────
  readonly items = input<PromotionStackItem[]>([]);
  readonly mode = input<PromotionStackMode>('compact-pills');
  /** Cantidad actual del producto en cotización. Usado por `expanded-cards`. */
  readonly currentQuantity = input<number | null>(null);
  /** Unidades base por presentación/paquete (default 1 para unidades sueltas). */
  readonly unitsPerPackage = input<number>(1);
  readonly ariaLabel = input<string>('Promociones');
  /** Autoplay en ms para `scroll-batch`. Default 3500. */
  readonly autoplayMs = input<number>(3500);

  // ── Outputs (signal-output API) ──────────────────────────────────────
  /**
   * Emitted when a stack becomes visible (scroll-batch) or a tier
   * boundary is crossed (expanded-cards). Útil para analíticas de
   * exposición de promociones.
   *
   * En `compact-pills` no emite (todos los items son visibles a la vez).
   *
   * REQUIRES an external sink (analytics service, telemetry) — see
   * consumers in catalog.component.ts, product-detail.component.ts,
   * cart-promotions.component.ts. If no sink is wired, events are
   * emitted and discarded.
   */
  readonly promotionViewed = output<{
    promotion_id: string | number;
    mode: PromotionStackMode;
  }>();

  /**
   * Emite cuando `currentQuantity` cruza la frontera de un tier
   * (`expanded-cards`). El payload incluye el `tier_index` del nuevo
   * nivel y la `quantity` que disparó el cruce.
   *
   * Solo aplica en `expanded-cards`.
   *
   * REQUIRES an external sink (analytics service, telemetry) — see
   * consumers in catalog.component.ts, product-detail.component.ts,
   * cart-promotions.component.ts. If no sink is wired, events are
   * emitted and discarded.
   */
  readonly promotionIntent = output<{
    promotion_id: string | number;
    tier_index: number;
    quantity: number;
  }>();

  /**
   * Emite cuando el usuario hace clic en una tarjeta de tramo (tier) en expanded-cards.
   * Permite que la vista (PDP/Modal) seleccione automáticamente la cantidad necesaria en paquetes o unidades.
   */
  readonly tierSelected = output<{
    min_quantity: number;
    tier_index: number;
    package_quantity: number;
  }>();

  // ── Refs ──────────────────────────────────────────────────────────────
  private readonly scrollerRef = viewChild<ElementRef<HTMLElement>>('scroller');

  // ── Estado local (no expuesto por output) ────────────────────────────
  private readonly activeIndexSignal = signal(0);
  private autoplayInterval: ReturnType<typeof setInterval> | null = null;
  private autoplayPaused = false;
  /** Última entrada observada en `scroll-batch` (id del item visible). */
  private readonly lastViewedPromotionId = signal<string | number | null>(null);
  /** Último tier cuyo cruce se emitió (id o null). */
  private readonly lastEmittedTierId = signal<string | number | null>(null);
  /** Bandera para evitar emitir el mismo view antes de que cambie. */
  private intersectionObserver: IntersectionObserver | null = null;
  /** `matchMedia` reactivo: si el usuario cambia el setting mid-session,
   *  el listener en `constructor()` detiene/arranca el autoplay sin
   *  requerir un rebuild del componente. */
  private readonly reducedMotionQuery =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

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

  /** Cantidad base acumulada considerando unidades por paquete. */
  readonly effectiveBaseQuantity = computed<number | null>(() => {
    const q = this.currentQuantity();
    if (q === null) return null;
    const scale = Math.max(1, this.unitsPerPackage());
    return q * scale;
  });

  /** Tier activo (effectiveBaseQuantity dentro del rango del tier). */
  readonly currentTier = computed<PromotionStackItem | null>(() => {
    const qty = this.effectiveBaseQuantity();
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

  /** Próximo tier (effectiveBaseQuantity aún no llega). */
  readonly nextTier = computed<PromotionStackItem | null>(() => {
    const qty = this.effectiveBaseQuantity();
    if (qty === null) {
      const tiers = this.expandedTiers();
      return tiers.length > 0 ? tiers[0] : null;
    }
    const tiers = this.expandedTiers();
    return tiers.find((t) => (t.min_quantity ?? 0) > qty) ?? null;
  });

  /**
   * Ancho de la barra de progreso (0–100).
   */
  readonly progressPercent = computed<number>(() => {
    const qty = this.effectiveBaseQuantity();
    const current = this.currentTier();
    const next = this.nextTier();
    if (qty === null) return 0;
    if (!current && !next) return 0;
    if (!next) return 100;
    if (!current) {
      const target = next.min_quantity ?? 1;
      return Math.min(100, Math.round((qty / target) * 100));
    }
    const lowerBound = (current.min_quantity ?? 0) - 1;
    const upperBound = next.min_quantity ?? lowerBound + 1;
    const span = upperBound - lowerBound;
    if (span <= 0) return 100;
    if (qty <= lowerBound) return 0;
    if (qty >= upperBound) return 100;
    return Math.min(100, Math.round(((qty - lowerBound) / span) * 100));
  });

  /** Paquetes que faltan para el próximo tier cuando unitsPerPackage > 1. */
  readonly remainingPackages = computed<number>(() => {
    const rem = this.remainingQty();
    const scale = Math.max(1, this.unitsPerPackage());
    return Math.ceil(rem / scale);
  });

  /** Posición del item activo en scroll-batch (para aria-current). */
  readonly activeIndex = this.activeIndexSignal.asReadonly();

  constructor() {
    // Autoplay del scroll-batch: arranca vía microtask post-construcción
    // para que el viewChild ya esté disponible.
    this.destroyRef.onDestroy(() => this.stopAutoplay());
    this.destroyRef.onDestroy(() => this.disconnectIntersectionObserver());
    queueMicrotask(() => this.syncAutoplay());

    // Listener reactivo de `prefers-reduced-motion`: si el usuario cambia
    // el setting mid-session (común en macOS desde Configuración del
    // sistema), detenemos o arrancamos el autoplay sin necesidad de
    // recargar el componente. CP-ECOM-PROMO-UX-001 R3-M2.
    if (this.reducedMotionQuery) {
      this.reducedMotionQuery.addEventListener(
        'change',
        this.handleReducedMotionChange,
      );
      this.destroyRef.onDestroy(() => {
        this.reducedMotionQuery?.removeEventListener(
          'change',
          this.handleReducedMotionChange,
        );
      });
    }

    // IntersectionObserver para `scroll-batch`: se monta después del
    // primer render para que el `<div #scroller>` y sus `<article>`
    // existan en el DOM.
    afterNextRender(() => this.setupScrollBatchObserver());

    // `effect()` SOLO para side-effects (emitir eventos analytics).
    // No se usa para re-render ni para sincronizar UI: la UI ya
    // reacciona al signal `currentTier()` vía zoneless CD. La skill
    // `vendix-zoneless-signals` permite `effect()` con fines de
    // side-effects cuando el cambio viene de un input reactivo.
    effect(() => {
      const m = this.mode();
      if (m !== 'expanded-cards') return;
      const tier = this.currentTier();
      if (!tier || tier.tier_index === undefined) {
        this.lastEmittedTierId.set(null);
        return;
      }
      const tierId = tier.id;
      if (this.lastEmittedTierId() === tierId) return;
      this.lastEmittedTierId.set(tierId);
      const qty = this.currentQuantity() ?? 0;
      this.promotionIntent.emit({
        promotion_id: tier.id,
        tier_index: tier.tier_index,
        quantity: qty,
      });
    });
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
      return `${this.currencyFormat.format(item.value)} de descuento`;
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

  /** Monto del descuento formateado con signo negativo (e.g. "-$400.00"). Null si es 0. */
  formattedValue(item: PromotionStackItem): string | null {
    if (!item.value || item.value <= 0) return null;
    return `-${this.currencyFormat.format(item.value)}`;
  }

  /** aria-label de un pill. */
  pillAriaLabel(item: PromotionStackItem): string {
    return `Descuento: ${this.pillText(item)}`;
  }

  /** aria-label de un tier card. */
  tierAriaLabel(item: PromotionStackItem, index: number, total: number): string {
    return `Nivel ${index + 1} de ${total}: ${this.pillText(item)}`;
  }

  /** Etiqueta del header "Desde N und" (o "Desde N und (M paquetes)"). */
  tierHeader(item: PromotionStackItem): string {
    const min = item.min_quantity ?? 0;
    const scale = Math.max(1, this.unitsPerPackage());
    if (scale > 1) {
      const packages = Math.ceil(min / scale);
      return `Desde ${min} und (${packages} ${packages === 1 ? 'paquete' : 'paquetes'})`;
    }
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
    const qty = this.effectiveBaseQuantity();
    if (qty === null) return false;
    const min = item.min_quantity ?? 0;
    return qty >= min;
  }

  /** Cantidad que falta para el próximo tier en unidades base. */
  remainingQty(): number {
    const qty = this.effectiveBaseQuantity();
    const next = this.nextTier();
    if (qty === null || !next) return 0;
    const need = next.min_quantity ?? 0;
    return Math.max(0, need - qty);
  }

  /**
   * Texto accesible del progressbar. WCAG 1.1.1 / 4.1.2: describe el
   * estado del progreso en lenguaje humano (no solo el porcentaje), para
   * que screen readers anuncien "Te faltan 3 und para -10% en Promo X"
   * en lugar de "Progreso hacia la próxima promoción, 47".
   *
   * CP-ECOM-PROMO-UX-001 R3-M1.
   */
  progressAriaValueText(): string {
    const next = this.nextTier();
    if (!next) return 'Sin siguiente tramo disponible';
    const remaining = this.remainingQty();
    const y = this.formatNextTierValue(next);
    const tierName = next.target_product_name?.trim() || next.label;
    return `Te faltan ${remaining} und para ${y} en ${tierName}`;
  }

  /** Formato humano del valor de una promoción de tier (ej: `-10%`, `-$5.000`). */
  private formatNextTierValue(item: PromotionStackItem): string {
    if (item.type === 'percentage' && item.value !== undefined) {
      return `-${item.value}%`;
    }
    if (item.type === 'fixed_amount' && item.value !== undefined) {
      return `-${this.currencyFormat.format(item.value)}`;
    }
    if (item.type === 'coupon') return 'cupón especial';
    return item.label;
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
    if (this.autoplayInterval || this.reducedMotionQuery?.matches) return;
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

  /**
   * Reacciona a cambios en `prefers-reduced-motion`. Si el usuario
   * activa el setting, detiene el autoplay; si lo desactiva y estamos
   * en modo `scroll-batch` con items, lo arranca (respetando el flag
   * `autoplayPaused` para no interrumpir un hover/focus manual).
   */
  private handleReducedMotionChange = (): void => {
    if (this.reducedMotionQuery?.matches) {
      this.stopAutoplay();
    } else if (
      this.mode() === 'scroll-batch' &&
      this.hasItems() &&
      !this.autoplayPaused
    ) {
      this.startAutoplay();
    }
  };

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

  // ── Scroll-batch: IntersectionObserver (analytics) ────────────────────
  /**
   * Observa cada `<article>` del scroller. Cuando un item cruza el 50%
   * de visibilidad y es el más visible del momento, emite
   * `promotionViewed` con su id.
   *
   * `IntersectionObserver` (NO `effect()`) — el requisito del plan
   * `CP-ECOM-PROMO-UX-001` G.1 es detectar entrada al viewport, lo cual
   * es side-effect puro (no re-render). `effect()` se reserva para
   * cambios de `currentTier()` en `expanded-cards`.
   */
  private setupScrollBatchObserver(): void {
    const scroller = this.scrollerRef()?.nativeElement;
    if (!scroller) return;
    if (this.intersectionObserver) return;

    const articles = Array.from(
      scroller.querySelectorAll<HTMLElement>('.promotion-stack__card'),
    );
    if (articles.length === 0) return;

    const items = this.scrollBatchItems();
    if (items.length === 0) return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        // Encontrar la entry más visible actualmente.
        let best: { id: string | number; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idxAttr = entry.target.getAttribute('data-promo-idx');
          if (idxAttr === null) continue;
          const idx = Number(idxAttr);
          const item = items[idx];
          if (!item) continue;
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { id: item.id, ratio: entry.intersectionRatio };
          }
        }
        if (!best) return;
        if (best.ratio < 0.5) return;
        if (this.lastViewedPromotionId() === best.id) return;
        this.lastViewedPromotionId.set(best.id);
        this.promotionViewed.emit({
          promotion_id: best.id,
          mode: 'scroll-batch',
        });
      },
      {
        root: scroller,
        threshold: [0.25, 0.5, 0.75, 1],
      },
    );

    articles.forEach((el) => this.intersectionObserver!.observe(el));
  }

  private disconnectIntersectionObserver(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
  }

  onTierClick(item: PromotionStackItem): void {
    if (item && item.min_quantity !== undefined && Number.isFinite(item.min_quantity)) {
      const scale = Math.max(1, this.unitsPerPackage());
      const packageQty = Math.max(1, Math.ceil(item.min_quantity / scale));
      this.tierSelected.emit({
        min_quantity: item.min_quantity,
        tier_index: item.tier_index ?? 0,
        package_quantity: packageQty,
      });
    }
  }
}

