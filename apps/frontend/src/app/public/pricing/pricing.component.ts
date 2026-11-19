import { Component, computed, effect, inject, signal, DestroyRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { CommonModule, DOCUMENT } from '@angular/common';
import { PublicPlansService, PublicPlan } from './services/public-plans.service';
import { PricingCardComponent } from '../../shared/components';
import {
  PricingCardPlan,
  PricingCardSelectEvent,
} from '../../shared/components/pricing-card/pricing-card.component';
import { PlanComparisonTableComponent } from './components/plan-comparison-table/plan-comparison-table.component';
import { Meta, Title } from '@angular/platform-browser';
import { applyMarketingPageMetadata, MARKETING_PAGES, marketingOrigin } from '../marketing-page-metadata';

type PricingViewMode = 'cards' | 'compare';

/** SEO-OPS-18: ciclos de cobro que se muestran por separado, en este orden. */
export type PricingCycle = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'lifetime';
export const PRICING_CYCLES: readonly { value: PricingCycle; label: string }[] = [
  { value: 'monthly', label: 'Mensual' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual', label: 'Anual' },
  { value: 'lifetime', label: 'Pago único' },
];

/** `yearly` y `annual` son el mismo ciclo; cualquier valor desconocido queda fuera del selector. */
export function normalizePricingCycle(cycle: string | null | undefined): PricingCycle | null {
  if (cycle === 'monthly' || cycle === 'quarterly' || cycle === 'semiannual' || cycle === 'lifetime') {
    return cycle;
  }
  if (cycle === 'annual' || cycle === 'yearly') return 'annual';
  return null;
}
const VIEW_MODE_STORAGE_KEY = 'pricingViewMode';

/**
 * SEO-OPS-18: vigencia de la oferta publicada. Responsable comercial: Adel Toro
 * (registrado en el seguimiento del plan SEO, 17-nov-2026). Cambiar esta fecha cada
 * vez que cambien los precios publicados.
 */
export const PRICING_VALID_FROM = '2026-11-12';
/** Una sola fuente: la etiqueta sale de la fecha (en UTC, para que no se corra un día en Bogotá). */
export const PRICING_VALID_FROM_LABEL = `Precios vigentes desde el ${new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeZone: 'UTC',
}).format(new Date(PRICING_VALID_FROM + 'T12:00:00Z'))}.`;
const PRICING_JSON_LD_ID = 'vendix-pricing-offers';
/** Duración de cada ciclo para la especificación de precio (ISO 8601). Pago único: sin duración. */
const BILLING_DURATION: Record<PricingCycle, string | null> = {
  monthly: 'P1M',
  quarterly: 'P3M',
  semiannual: 'P6M',
  annual: 'P1Y',
  lifetime: null,
};

/**
 * SEO-OPS-18: datos estructurados de las ofertas, armados con los mismos planes de la
 * API que pintan las tarjetas, para que el schema y el texto digan lo mismo.
 */
export function buildPricingJsonLd(
  plans: readonly PublicPlan[],
  origin = 'https://vendix.online',
  validFrom = PRICING_VALID_FROM,
): object | null {
  const offers = plans
    .map((p) => ({ p, cycle: normalizePricingCycle(p.billing_cycle) }))
    .filter(({ p, cycle }) => cycle !== null && Number.isFinite(Number(p.base_price)) && !!p.currency)
    .map(({ p, cycle }) => {
      const price = String(Number(p.base_price));
      const priceCurrency = String(p.currency).toUpperCase();
      const duration = BILLING_DURATION[cycle as PricingCycle];
      return {
        '@type': 'Offer',
        name: `${p.name} · ${PRICING_CYCLES.find((c) => c.value === cycle)!.label}`,
        price,
        priceCurrency,
        validFrom,
        url: `${origin}/pricing`,
        availability: 'https://schema.org/InStock',
        // Que Google sepa si $969.000 es por mes o por año.
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price,
          priceCurrency,
          ...(duration ? { billingDuration: duration } : {}),
        },
      };
    });
  if (offers.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${origin}/pricing#product`,
    // Enlaza con la entidad que publica la portada (vendix-landing-structured-data.ts).
    isRelatedTo: { '@id': `${origin}/#software` },
    url: `${origin}/pricing`,
    name: 'Vendix',
    description: 'Software de punto de venta, inventario, tienda en línea y facturación electrónica para negocios en Colombia.',
    brand: { '@type': 'Brand', name: 'Vendix' },
    offers,
  };
}

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, RouterLink, PricingCardComponent, PlanComparisonTableComponent],
  templateUrl: './pricing.component.html',
  styleUrls: ['./pricing.component.scss'],
})
export class PricingComponent {
  // SEO-TECH-04: título, descripción, robots y canonical propios en el host comercial.
  private readonly restoreMarketingMetadata = applyMarketingPageMetadata(
    inject(DOCUMENT),
    inject(Title),
    inject(Meta),
    MARKETING_PAGES.pricing,
  );
  private readonly marketingMetadataCleanup = inject(DestroyRef).onDestroy(
    this.restoreMarketingMetadata,
  );

  private readonly document = inject(DOCUMENT);
  readonly validFromLabel = PRICING_VALID_FROM_LABEL;
  private readonly removeJsonLd = inject(DestroyRef).onDestroy(() =>
    this.document.getElementById(PRICING_JSON_LD_ID)?.remove(),
  );

  private publicPlansService = inject(PublicPlansService);
  private router = inject(Router);

  readonly response = toSignal(this.publicPlansService.list$);
  readonly plans = computed<PublicPlan[]>(() => this.response()?.data ?? []);
  readonly loading = computed(() => this.response() === undefined);
  readonly hasPlans = computed(() => this.plans().length > 0);

  readonly viewMode = signal<PricingViewMode>(this.readStoredViewMode());

  /**
   * SEO-OPS-18: antes se mostraban los 12 planes (mensual, trimestral y anual)
   * mezclados en una sola lista. Ahora se elige el ciclo y solo se ven sus planes.
   */
  readonly cycle = signal<PricingCycle>('monthly');
  readonly availableCycles = computed(() =>
    PRICING_CYCLES.filter((c) => this.plans().some((p) => normalizePricingCycle(p.billing_cycle) === c.value)),
  );
  /** Moneda de los planes mostrados: una sola se nombra, varias se explican. */
  readonly currencyNote = computed(() => {
    const codes = Array.from(
      new Set(this.visiblePlans().map((p) => (p.currency || '').toUpperCase()).filter(Boolean)),
    );
    if (codes.length === 0) return 'Precios en la moneda de cada plan';
    if (codes.length > 1) return 'Precios en la moneda de cada plan';
    return codes[0] === 'COP' ? 'Precios en pesos colombianos (COP)' : `Precios en ${codes[0]}`;
  });
  readonly cycleNote = computed(() => (this.cycle() === 'lifetime' ? ' en un solo pago' : ' por el ciclo elegido'));

  readonly visiblePlans = computed<PublicPlan[]>(() => {
    const all = this.plans();
    const inCycle = all.filter((p) => normalizePricingCycle(p.billing_cycle) === this.cycle());
    return inCycle.length > 0 ? inCycle : all;
  });

  setCycle(cycle: PricingCycle): void {
    this.cycle.set(cycle);
  }

  readonly dummyPlan = {
    id: 0,
    code: 'dummy',
    name: '',
    base_price: 0,
    currency: 'COP',
    billing_cycle: 'monthly',
    features: [],
  } as PricingCardPlan;

  constructor() {
    // SEO-OPS-18: JSON-LD de ofertas con los mismos datos que las tarjetas.
    effect(() => {
      // Solo en el host comercial: en tiendas y dominios propios /pricing no publica a Vendix.
      const origin = this.jsonLdOrigin();
      const data = origin === null ? null : buildPricingJsonLd(this.plans(), origin);
      const head = this.document.head;
      let script = this.document.getElementById(PRICING_JSON_LD_ID) as HTMLScriptElement | null;
      if (!data) { script?.remove(); return; }
      if (!script) {
        script = this.document.createElement('script');
        script.type = 'application/ld+json';
        script.id = PRICING_JSON_LD_ID;
        head.appendChild(script);
      }
      script.textContent = JSON.stringify(data);
    });
    // Persist view mode preference across visits
    effect(() => {
      const mode = this.viewMode();
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
        }
      } catch {
        // localStorage unavailable (SSR / private mode) — silently ignore
      }
    });
  }

  /** Origen comercial o `null` fuera de vendix.online / vendix.com. Separado para las pruebas. */
  protected jsonLdOrigin(): string | null {
    return marketingOrigin(this.document);
  }

  setViewMode(mode: PricingViewMode): void {
    this.viewMode.set(mode);
  }

  onSelectPlan(
    event: PricingCardSelectEvent | PricingCardPlan | PublicPlan,
  ): void {
    // Pricing-card now emits `{ plan, retry }`; the comparison table still
    // emits a bare plan. Accept both shapes so we don't force a refactor of
    // the table for this change.
    const plan: { id: number | string } =
      'plan' in event ? (event as PricingCardSelectEvent).plan : event;
    this.router.navigate(['/auth/register'], { queryParams: { plan: plan.id } });
  }

  private readStoredViewMode(): PricingViewMode {
    try {
      if (typeof window === 'undefined') return 'cards';
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      return stored === 'compare' ? 'compare' : 'cards';
    } catch {
      return 'cards';
    }
  }
}
