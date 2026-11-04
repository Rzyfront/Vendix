import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import {
  CrmLandingSeo,
  MAX_LANDING_SEO_DESCRIPTION,
  MAX_LANDING_SEO_TITLE,
} from '../../../../../public/dynamic-landing/blocks/landing-blocks.types';

const HTTPS = /^https:\/\/\S+$/i;

/**
 * F6-A — "SEO" of the landing: the title, description and share image search
 * engines and social networks show, with a live search-result snippet. Empty
 * fields keep the page's current behavior (store name, no description).
 */
@Component({
  selector: 'app-landing-seo-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-5" data-testid="landing-seo-panel">
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="landing-seo-snippet">
        <p class="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Así se verá en Google</p>
        <p class="mt-2 truncate text-xs text-[var(--color-text-secondary)]">{{ host() || 'tu-dominio' }}</p>
        <p class="truncate text-lg text-[var(--color-primary)]">{{ snippetTitle() }}</p>
        <p class="line-clamp-2 text-sm text-[var(--color-text-secondary)]">{{ seo().description || 'Agrega una descripción para que la gente sepa qué encontrará.' }}</p>
      </div>

      <label class="block">
        <span class="mb-1 flex justify-between text-xs font-semibold text-[var(--color-text-primary)]">
          <span>Título</span>
          <span class="font-normal text-[var(--color-text-secondary)]">{{ (seo().title ?? '').length }}/{{ maxTitle }}</span>
        </span>
        <input type="text" [attr.maxlength]="maxTitle" [attr.placeholder]="storeName()" data-testid="landing-seo-title"
               class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
               [value]="seo().title ?? ''" (input)="set('title', $any($event.target).value)" />
        <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">Vacío: el nombre de tu tienda.</span>
      </label>

      <label class="block">
        <span class="mb-1 flex justify-between text-xs font-semibold text-[var(--color-text-primary)]">
          <span>Descripción</span>
          <span class="font-normal text-[var(--color-text-secondary)]">{{ (seo().description ?? '').length }}/{{ maxDescription }}</span>
        </span>
        <textarea rows="3" [attr.maxlength]="maxDescription" data-testid="landing-seo-description"
                  class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                  [value]="seo().description ?? ''" (input)="set('description', $any($event.target).value)"></textarea>
      </label>

      <label class="block">
        <span class="mb-1 block text-xs font-semibold text-[var(--color-text-primary)]">Imagen al compartir</span>
        <input type="url" placeholder="https://…/portada.jpg" data-testid="landing-seo-image"
               class="w-full rounded-lg border bg-[var(--color-surface)] px-3 py-2 text-sm"
               [class]="imageError() ? 'border-[var(--color-error,#dc2626)]' : 'border-[var(--color-border)]'"
               [value]="seo().image_url ?? ''" (input)="set('image_url', $any($event.target).value)" />
        @if (imageError()) {
          <span class="mt-1 block text-[11px] text-[var(--color-error,#dc2626)]">Usa un enlace que empiece por https://</span>
        } @else {
          <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">Se ve al compartir el enlace en WhatsApp o redes. Ideal 1200 × 630.</span>
        }
      </label>
    </div>
  `,
})
export class LandingSeoPanelComponent {
  readonly seo = input.required<CrmLandingSeo>();
  readonly storeName = input('');
  readonly host = input<string | null>(null);
  readonly seoChange = output<CrmLandingSeo>();

  readonly maxTitle = MAX_LANDING_SEO_TITLE;
  readonly maxDescription = MAX_LANDING_SEO_DESCRIPTION;

  readonly snippetTitle = computed(() => this.seo().title?.trim() || this.storeName() || 'Tu tienda');
  readonly imageError = computed(() => !!this.seo().image_url && !HTTPS.test(this.seo().image_url ?? ''));

  /** Empty text removes the key, so an untouched document saves as before. */
  set(key: keyof CrmLandingSeo, value: string): void {
    const next: CrmLandingSeo = { ...this.seo() };
    if (value.trim()) next[key] = value;
    else delete next[key];
    this.seoChange.emit(next);
  }
}
