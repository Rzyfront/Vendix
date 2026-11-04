import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import type { Product } from '../../products/interfaces/product.interface';
import { ProductsService } from '../../products/services/products.service';
import { MAX_OFFER_DESCRIPTION, MAX_OFFER_TITLE } from '../components/landing-settings-panel.component';
import type { ProductPageCustomDomain, StoreAppDetail } from '../interfaces/store-app.interface';
import type { LandingOfferDraft } from './landing-preview';

/** Generation state of the landing content (CRM). */
export type LandingGenerationState = 'idle' | 'pending' | 'generating' | 'ready' | 'failed';

const GENERATION_LABEL: Record<LandingGenerationState, string> = {
  idle: 'Sin generar',
  pending: 'En cola para generar con IA',
  generating: 'Generando con IA…',
  ready: 'Contenido listo',
  failed: 'La IA no pudo generarla: edítala a mano',
};

/**
 * F6-A — "General" of the landing: whether it is on, its content generation,
 * the offer it shows on its own domain and the domain itself. Publishing is
 * not here: it lives once, in the view header.
 */
@Component({
  selector: 'app-landing-general-panel',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4" data-testid="landing-general-panel">
      <!-- Estado -->
      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Estado</h3>
            <p class="mt-1 text-sm text-[var(--color-text-primary)]" data-testid="landing-status-label">{{ statusLabel() }}</p>
            <p class="mt-0.5 text-xs text-[var(--color-text-secondary)]">
              Contenido: {{ generationLabel() }}@if (publishedAt()) { · publicado el {{ publishedAt() }} }
            </p>
          </div>
          @if (detail()?.status === 'draft') {
            <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
                    [disabled]="busy()" (click)="power.emit('deactivate')" data-testid="landing-deactivate">
              <app-icon name="power" [size]="14" /> Apagar
            </button>
          } @else if (isOff()) {
            <button type="button" class="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text-on-primary,#fff)] disabled:opacity-50"
                    [disabled]="busy()" (click)="power.emit('activate')" data-testid="landing-activate">
              <app-icon name="power" [size]="14" /> Encender
            </button>
          }
        </div>
        @if (detail()?.status === 'published') {
          <p class="mt-2 text-xs text-[var(--color-text-secondary)]">Para apagarla, primero despublícala desde la barra superior.</p>
        }

        @if (!isOff()) {
          <div class="mt-4 border-t border-[var(--color-border)] pt-3">
            @if (confirmingRegenerate()) {
              <div class="rounded-lg bg-[var(--color-background)] p-3" data-testid="landing-regenerate-confirm">
                <p class="text-sm text-[var(--color-text-primary)]">La IA reescribe todo el borrador con los datos de tu tienda. Lo publicado no cambia hasta que publiques.</p>
                <div class="mt-2 flex gap-2">
                  <button type="button" class="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-on-primary,#fff)]"
                          (click)="confirmingRegenerate.set(false); regenerate.emit()">Reescribir borrador</button>
                  <button type="button" class="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-secondary)]" (click)="confirmingRegenerate.set(false)">Cancelar</button>
                </div>
              </div>
            } @else {
              <button type="button" class="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] disabled:opacity-50"
                      [disabled]="busy() || generating()" (click)="confirmingRegenerate.set(true)" data-testid="landing-regenerate">
                <app-icon [name]="generating() ? 'loader' : 'sparkles'" [size]="14" [class.animate-spin]="generating()" />
                {{ generating() ? 'Generando con IA…' : 'Regenerar con IA' }}
              </button>
            }
          </div>
        }
      </section>

      <!-- Oferta -->
      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Oferta</h3>
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Se muestra en tu dominio propio, debajo de la portada.</p>
        <div class="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de oferta">
          <label class="flex cursor-pointer items-start gap-2 rounded-lg border p-3"
                 [class]="offer().mode === 'info' ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'">
            <input type="radio" name="lb-offer-mode" [checked]="offer().mode === 'info'" (change)="patchOffer({ mode: 'info' })" data-testid="landing-mode-info" />
            <span><span class="block text-sm font-medium">Informativa</span><span class="block text-xs text-[var(--color-text-secondary)]">Solo captura los datos del cliente.</span></span>
          </label>
          <label class="flex cursor-pointer items-start gap-2 rounded-lg border p-3"
                 [class]="offer().mode === 'product' ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'">
            <input type="radio" name="lb-offer-mode" [checked]="offer().mode === 'product'" (change)="patchOffer({ mode: 'product' })" data-testid="landing-mode-product" />
            <span><span class="block text-sm font-medium">Vender un producto</span><span class="block text-xs text-[var(--color-text-secondary)]">Con botón de compra en tu tienda.</span></span>
          </label>
        </div>

        @if (offer().mode === 'product') {
          <div class="mt-3">
            @if (offer().product; as p) {
              <div class="flex items-center justify-between rounded-lg bg-[var(--color-background)] px-3 py-2 text-sm" data-testid="landing-offer-product">
                <span class="truncate">{{ p.name }}</span>
                <button type="button" class="rounded p-1 text-[var(--color-text-secondary)]" [attr.aria-label]="'Quitar ' + p.name" (click)="patchOffer({ product: null })">
                  <app-icon name="x" [size]="14" />
                </button>
              </div>
            } @else {
              <label class="relative block">
                <app-icon name="search" [size]="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                <input type="search" placeholder="Busca el producto de la oferta" data-testid="landing-product-search"
                       class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-2 text-sm"
                       [value]="query()" (input)="query.set($any($event.target).value)" />
              </label>
              @if (results().length) {
                <ul class="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                  @for (r of results(); track r.id) {
                    <li><button type="button" class="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-background)]" (click)="pick(r)">{{ r.name }}</button></li>
                  }
                </ul>
              }
              <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Elige el producto para poder guardar la oferta.</p>
            }
          </div>
        }

        <div class="mt-3 grid gap-3">
          <label class="block">
            <span class="mb-1 flex justify-between text-xs font-semibold"><span>Título de la oferta</span>
              <span class="font-normal text-[var(--color-text-secondary)]">{{ offer().title.length }}/{{ maxTitle }}</span></span>
            <input type="text" [attr.maxlength]="maxTitle" data-testid="landing-offer-title"
                   [attr.placeholder]="offer().mode === 'product' && offer().product ? offer().product!.name : 'Déjanos tus datos y te contactamos'"
                   class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                   [value]="offer().title" (input)="patchOffer({ title: $any($event.target).value })" />
          </label>
          <label class="block">
            <span class="mb-1 flex justify-between text-xs font-semibold"><span>Descripción</span>
              <span class="font-normal text-[var(--color-text-secondary)]">{{ offer().description.length }}/{{ maxDescription }}</span></span>
            <textarea rows="2" [attr.maxlength]="maxDescription"
                      class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                      [value]="offer().description" (input)="patchOffer({ description: $any($event.target).value })"></textarea>
          </label>
        </div>
      </section>

      <!-- Dominio -->
      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Dominio</h3>
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]" data-testid="app-domain-hint">
          La dirección de Vendix queda siempre activa. Si eliges uno de tus dominios, se suma como alias al publicar.
        </p>
        @if (aliasHostnames().length) {
          <p class="mt-2 text-sm" data-testid="app-domain-aliases">También responde en: {{ aliasHostnames().join(', ') }}</p>
        }
        <label class="mt-2 flex items-start gap-2 text-sm">
          <input type="radio" name="lb-domain" [checked]="customDomainId() === null" (change)="customDomainId.set(null)" />
          <span>Dirección de Vendix para tu landing</span>
        </label>
        @for (d of domains(); track d.id) {
          <label class="mt-2 flex items-start gap-2 text-sm">
            <input type="radio" name="lb-domain" [checked]="customDomainId() === d.id" (change)="customDomainId.set(d.id)" />
            <span>{{ d.hostname }}</span>
          </label>
        }
      </section>
    </div>
  `,
})
export class LandingGeneralPanelComponent {
  private readonly productsService = inject(ProductsService);

  readonly detail = input<StoreAppDetail | null>(null);
  readonly generation = input<LandingGenerationState>('idle');
  readonly generating = input(false);
  readonly publishedAt = input<string | null>(null);
  readonly busy = input(false);
  readonly domains = input<readonly ProductPageCustomDomain[]>([]);
  readonly aliasHostnames = input<readonly string[]>([]);

  readonly offer = model.required<LandingOfferDraft>();
  readonly customDomainId = model<number | null>(null);

  readonly power = output<'activate' | 'deactivate'>();
  readonly regenerate = output<void>();

  readonly maxTitle = MAX_OFFER_TITLE;
  readonly maxDescription = MAX_OFFER_DESCRIPTION;
  readonly confirmingRegenerate = signal(false);
  readonly query = signal('');
  readonly results = signal<Product[]>([]);

  readonly isOff = computed(() => {
    const status = this.detail()?.status;
    return status === 'not_installed' || status === 'disabled';
  });
  readonly generationLabel = computed(() => GENERATION_LABEL[this.generation()] ?? this.generation());
  readonly statusLabel = computed(() => {
    const app = this.detail();
    if (!app) return '';
    if (app.status === 'published') {
      return app.domain ? `Publicada en ${app.domain.hostname}` : 'Publicada en el dominio de la tienda';
    }
    if (app.status === 'draft') return 'Encendida, sin publicar';
    if (app.status === 'disabled') return 'Apagada';
    return 'Sin instalar';
  });

  constructor() {
    toObservable(this.query)
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          term.trim().length < 2
            ? of([] as Product[])
            : this.productsService
                .getProducts({ search: term.trim(), limit: 10, state: 'active' as Product['state'] })
                .pipe(
                  map((res) => res.data ?? []),
                  catchError(() => of([] as Product[])),
                ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((products) => this.results.set(products));
  }

  patchOffer(change: Partial<LandingOfferDraft>): void {
    this.offer.update((current) => ({ ...current, ...change }));
  }

  pick(product: Product): void {
    this.patchOffer({ product: { id: product.id, name: product.name, slug: product.slug } });
    this.query.set('');
    this.results.set([]);
  }
}
