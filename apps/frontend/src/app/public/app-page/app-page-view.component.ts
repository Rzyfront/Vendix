import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  APP_PAGE_TEMPLATES,
  AppPageBlock,
  AppPageDocument,
  PageAppKind,
} from '../../private/modules/store/apps/templates';
import {
  BlockItem,
  STAR_SLOTS,
  blockItems,
  blockStrings,
  blockText,
  fontStack,
  ratingOf,
  safeColor,
  safeUrl,
} from './app-page-view.util';

interface PlaceholderView {
  id: string;
  label: string;
}

/**
 * Apps F2 — public renderer of an app's own page: the hero and the app's own
 * enabled blocks, in page order. Blocks that stand for a section the layout
 * already renders (`existing` in the template) are skipped; in `preview` they
 * show a dashed placeholder. Unknown block types are ignored.
 *
 * Brand colors and font are scoped to the host (CSS custom properties), so
 * nothing leaks to the rest of the page.
 */
@Component({
  selector: 'app-app-page-view',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--ap-primary]': 'primary()',
    '[style.--ap-secondary]': 'secondary()',
    '[style.font-family]': 'font()',
  },
  styles: [
    `
      :host {
        display: block;
      }
      .ap-accent-bg {
        background-color: var(--ap-primary, var(--color-primary));
        color: #fff;
      }
      .ap-accent-text {
        color: var(--ap-primary, var(--color-primary));
      }
      .ap-accent-soft {
        background-color: color-mix(in srgb, var(--ap-primary, var(--color-primary)) 10%, transparent);
        color: var(--ap-primary, var(--color-primary));
      }
      .ap-hero-fallback {
        background: linear-gradient(
          135deg,
          var(--ap-primary, var(--color-primary)),
          var(--ap-secondary, var(--ap-primary, var(--color-primary)))
        );
      }
    `,
  ],
  template: `
    @if (showHero() && hero(); as h) {
      <section
        class="relative overflow-hidden border-b border-border"
        [class.ap-hero-fallback]="!h.image_url && !coverCss()"
        [style.background-image]="!h.image_url ? coverCss() : null"
        [style.background-size]="'cover'"
        [style.background-position]="'center'"
        data-testid="app-page-hero"
      >
        @if (!h.image_url && coverCss()) {
          <div class="pointer-events-none absolute inset-0 bg-black/40"></div>
        }
        <div
          class="relative mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-12 md:py-16"
          [class.md:grid-cols-2]="!!h.image_url"
        >
          <div [class]="h.image_url ? 'text-text-primary' : 'text-white'">
            @if (h.eyebrow) {
              <p class="mb-2 text-xs font-semibold uppercase tracking-wider" [class.ap-accent-text]="!!h.image_url" data-testid="hero-eyebrow">{{ h.eyebrow }}</p>
            }
            @if (h.title) {
              <h1 class="text-3xl font-bold leading-tight md:text-5xl" data-testid="hero-title">{{ h.title }}</h1>
            }
            @if (h.subtitle) {
              <p class="mt-4 max-w-xl text-base opacity-90 md:text-lg" data-testid="hero-subtitle">{{ h.subtitle }}</p>
            }
            @if (h.button_label) {
              <button
                type="button"
                class="mt-6 inline-flex min-h-11 items-center justify-center rounded-full px-6 py-3 text-sm font-semibold"
                [class]="h.image_url ? 'ap-accent-bg' : 'bg-white text-gray-900'"
                data-testid="hero-button"
                (click)="scrollToMain()"
              >
                {{ h.button_label }}
              </button>
            }
          </div>
          @if (h.image_url) {
            <img
              [src]="h.image_url"
              [alt]="h.title || 'Imagen principal'"
              loading="lazy"
              class="w-full rounded-2xl object-cover shadow-sm md:max-h-96"
            />
          }
        </div>
      </section>
    }

    @if (showBlocks()) {
      @for (item of views(); track item.block.id) {
        @if (item.placeholder; as ph) {
          <section class="mx-auto w-full max-w-6xl px-4 py-6" data-testid="app-page-placeholder">
            <div class="rounded-xl border-2 border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
              Aquí va: {{ ph.label }}
            </div>
          </section>
        } @else {
          <section
            class="mx-auto w-full max-w-6xl px-4 py-8 md:py-10"
            [attr.data-block]="item.block.type"
            [attr.aria-labelledby]="titleOf(item.block) ? 'ap-' + item.block.id : null"
          >
            @switch (item.block.type) {
              @case ('benefits') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  @for (card of items(item.block); track $index) {
                    <article class="rounded-2xl border border-border bg-surface p-5">
                      <h3 class="text-base font-semibold text-text-primary">{{ card['title'] }}</h3>
                      @if (card['text']) {
                        <p class="mt-2 text-sm text-text-secondary">{{ card['text'] }}</p>
                      }
                    </article>
                  }
                </div>
              }
              @case ('highlights') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  @for (card of items(item.block); track $index) {
                    <article class="rounded-2xl border border-border bg-surface p-5">
                      <h3 class="text-base font-semibold text-text-primary">{{ card['title'] }}</h3>
                      @if (card['text']) {
                        <p class="mt-2 text-sm text-text-secondary">{{ card['text'] }}</p>
                      }
                    </article>
                  }
                </div>
              }
              @case ('how_it_works') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <ol class="grid gap-4 md:grid-cols-3">
                  @for (step of items(item.block); track $index) {
                    <li class="flex gap-4 rounded-2xl border border-border bg-surface p-5">
                      <span class="ap-accent-bg flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold">{{ $index + 1 }}</span>
                      <div>
                        <h3 class="text-base font-semibold text-text-primary">{{ step['title'] }}</h3>
                        @if (step['text']) {
                          <p class="mt-1 text-sm text-text-secondary">{{ step['text'] }}</p>
                        }
                      </div>
                    </li>
                  }
                </ol>
              }
              @case ('specifications') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <dl class="grid overflow-hidden rounded-2xl border border-border bg-surface sm:grid-cols-2">
                  @for (row of items(item.block); track $index) {
                    <div class="grid grid-cols-2 gap-2 border-b border-border px-4 py-3 text-sm last:border-b-0">
                      <dt class="font-medium text-text-primary">{{ row['label'] }}</dt>
                      <dd class="text-text-secondary">{{ row['value'] }}</dd>
                    </div>
                  }
                </dl>
              }
              @case ('gallery') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
                  @for (url of images(item.block); track $index) {
                    <img [src]="url" [alt]="titleOf(item.block) || 'Imagen de la galería'" loading="lazy" class="aspect-square w-full rounded-xl object-cover" />
                  }
                </div>
              }
              @case ('testimonials') {
                <div class="mb-6 flex flex-wrap items-baseline gap-3">
                  @if (titleOf(item.block)) {
                    <h2 [id]="'ap-' + item.block.id" class="text-xl font-bold text-text-primary md:text-2xl">{{ titleOf(item.block) }}</h2>
                  }
                  @if (text(item.block, 'rating_summary')) {
                    <span class="ap-accent-soft rounded-full px-3 py-1 text-sm font-semibold" data-testid="rating-summary">★ {{ text(item.block, 'rating_summary') }}</span>
                  }
                </div>
                <div class="grid gap-4 md:grid-cols-3">
                  @for (t of items(item.block); track $index) {
                    <figure class="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
                      @if (stars(t) > 0) {
                        <div class="ap-accent-text text-base" role="img" [attr.aria-label]="stars(t) + ' de 5 estrellas'" data-testid="stars">
                          @for (n of starSlots; track n) {
                            <span aria-hidden="true">{{ n <= stars(t) ? '★' : '☆' }}</span>
                          }
                        </div>
                      }
                      <blockquote class="text-sm text-text-primary">{{ t['quote'] }}</blockquote>
                      <figcaption class="mt-auto text-xs text-text-secondary">
                        <span class="font-semibold text-text-primary">{{ t['name'] }}</span>
                        @if (t['city']) {
                          <span> · {{ t['city'] }}</span>
                        }
                      </figcaption>
                    </figure>
                  }
                </div>
              }
              @case ('shipping_warranty') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <div class="grid gap-4 md:grid-cols-3">
                  @for (part of shippingParts(item.block); track part.label) {
                    <article class="rounded-2xl border border-border bg-surface p-5">
                      <h3 class="text-base font-semibold text-text-primary">{{ part.label }}</h3>
                      <p class="mt-2 text-sm text-text-secondary">{{ part.text }}</p>
                    </article>
                  }
                </div>
              }
              @case ('faq') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <div class="mx-auto max-w-3xl divide-y divide-border rounded-2xl border border-border bg-surface">
                  @for (q of items(item.block); track $index) {
                    <details class="group px-5 py-4">
                      <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-text-primary">
                        {{ q['question'] }}
                        <span class="ap-accent-text text-lg transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                      </summary>
                      <p class="mt-3 text-sm text-text-secondary">{{ q['answer'] }}</p>
                    </details>
                  }
                </div>
              }
              @case ('cta') {
                <div class="ap-accent-bg rounded-3xl px-6 py-10 text-center md:py-14" data-testid="cta">
                  @if (titleOf(item.block)) {
                    <h2 [id]="'ap-' + item.block.id" class="text-2xl font-bold md:text-3xl">{{ titleOf(item.block) }}</h2>
                  }
                  @if (text(item.block, 'text')) {
                    <p class="mx-auto mt-3 max-w-xl text-sm opacity-90 md:text-base">{{ text(item.block, 'text') }}</p>
                  }
                  @if (text(item.block, 'button_label')) {
                    <button
                      type="button"
                      class="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-gray-900"
                      data-testid="cta-button"
                      (click)="scrollToMain()"
                    >
                      {{ text(item.block, 'button_label') }}
                    </button>
                  }
                </div>
              }
              @case ('team') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  @for (m of items(item.block); track $index) {
                    <article class="flex gap-4 rounded-2xl border border-border bg-surface p-4">
                      @if (url(m['photo_url']); as photo) {
                        <img [src]="photo" [alt]="m['name']" loading="lazy" class="h-16 w-16 shrink-0 rounded-full object-cover" />
                      }
                      <div class="min-w-0">
                        <h3 class="text-base font-semibold text-text-primary">{{ m['name'] }}</h3>
                        @if (m['role']) {
                          <p class="ap-accent-text text-xs font-medium">{{ m['role'] }}</p>
                        }
                        @if (m['bio']) {
                          <p class="mt-1 text-sm text-text-secondary">{{ m['bio'] }}</p>
                        }
                      </div>
                    </article>
                  }
                </div>
              }
              @case ('policies') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <dl class="grid gap-4 md:grid-cols-2">
                  @for (part of policyParts(item.block); track part.label) {
                    <div class="rounded-2xl border border-border bg-surface p-5">
                      <dt class="text-sm font-semibold text-text-primary">{{ part.label }}</dt>
                      <dd class="mt-1 text-sm text-text-secondary">{{ part.text }}</dd>
                    </div>
                  }
                </dl>
              }
              @case ('amenities') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <ul class="flex flex-wrap gap-2">
                  @for (a of strings(item.block, 'items'); track $index) {
                    <li class="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-text-primary">{{ a }}</li>
                  }
                </ul>
              }
              @case ('location') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <div class="rounded-2xl border border-border bg-surface p-5 text-sm">
                  @if (text(item.block, 'address')) {
                    <p class="font-medium text-text-primary">{{ text(item.block, 'address') }}</p>
                  }
                  @if (text(item.block, 'text')) {
                    <p class="mt-2 text-text-secondary">{{ text(item.block, 'text') }}</p>
                  }
                  @if (url(text(item.block, 'map_url')); as map) {
                    <a [href]="map" target="_blank" rel="noopener noreferrer" class="ap-accent-text mt-3 inline-block font-semibold underline">Ver en el mapa</a>
                  }
                </div>
              }
              @case ('contact') {
                <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                <div class="grid gap-3 rounded-2xl border border-border bg-surface p-5 text-sm sm:grid-cols-2">
                  @if (text(item.block, 'phone'); as phone) {
                    <p><span class="block text-xs text-text-secondary">Teléfono</span><a [href]="'tel:' + phone" class="ap-accent-text font-semibold">{{ phone }}</a></p>
                  }
                  @if (text(item.block, 'email'); as email) {
                    <p><span class="block text-xs text-text-secondary">Correo</span><a [href]="'mailto:' + email" class="ap-accent-text font-semibold">{{ email }}</a></p>
                  }
                  @if (text(item.block, 'address'); as address) {
                    <p><span class="block text-xs text-text-secondary">Dirección</span><span class="text-text-primary">{{ address }}</span></p>
                  }
                  @if (text(item.block, 'hours'); as hours) {
                    <p><span class="block text-xs text-text-secondary">Horario</span><span class="text-text-primary">{{ hours }}</span></p>
                  }
                </div>
              }
            }
          </section>
        }
      }
    }

    <ng-template #head let-b="b">
      @if (titleOf(b)) {
        <h2 [id]="'ap-' + b.id" class="mb-6 text-xl font-bold text-text-primary md:text-2xl">{{ titleOf(b) }}</h2>
      }
    </ng-template>
  `,
})
export class AppPageViewComponent {
  private readonly document = inject(DOCUMENT);

  readonly kind = input.required<PageAppKind>();
  readonly page = input<AppPageDocument | null>(null);
  /** `'hero'`: only the hero; `'blocks'`: only the blocks; `'all'`: both. */
  readonly part = input<'hero' | 'blocks' | 'all'>('all');
  /** Admin preview: shows a placeholder where an existing section goes. */
  readonly preview = input(false);
  /** Element id the hero and cta buttons scroll to (the page's main content). */
  readonly mainId = input('app-page-main');

  readonly starSlots = STAR_SLOTS;

  readonly showHero = computed(() => this.part() !== 'blocks');
  readonly showBlocks = computed(() => this.part() !== 'hero');

  readonly primary = computed(() => safeColor(this.page()?.brand?.primary_color));
  readonly secondary = computed(() => safeColor(this.page()?.brand?.secondary_color));
  readonly font = computed(() => fontStack(this.page()?.brand?.font_family));
  readonly coverCss = computed(() => {
    const url = safeUrl(this.page()?.brand?.cover_url);
    return url ? `url("${url.replace(/["()\s\\]/g, (c) => '%' + c.charCodeAt(0).toString(16))}")` : null;
  });

  readonly hero = computed(() => {
    const h = this.page()?.hero;
    if (!h || !(h.title || h.subtitle || h.eyebrow || h.image_url)) return null;
    return { ...h, image_url: safeUrl(h.image_url) ?? undefined };
  });

  private readonly catalog = computed(
    () => new Map(APP_PAGE_TEMPLATES[this.kind()].blocks.map((b) => [b.type, b])),
  );

  /** Enabled, known blocks in page order; existing ones only as preview placeholders. */
  readonly views = computed<{ block: AppPageBlock; placeholder: PlaceholderView | null }[]>(() => {
    const catalog = this.catalog();
    const preview = this.preview();
    const out: { block: AppPageBlock; placeholder: PlaceholderView | null }[] = [];
    for (const block of this.page()?.blocks ?? []) {
      const def = catalog.get(block.type);
      if (!block.enabled || !def) continue;
      if (def.existing) {
        if (preview) out.push({ block, placeholder: { id: block.id, label: def.label } });
        continue;
      }
      out.push({ block, placeholder: null });
    }
    return out;
  });

  titleOf(block: AppPageBlock): string {
    return blockText(block.props, 'title');
  }
  text(block: AppPageBlock, key: string): string {
    return blockText(block.props, key);
  }
  items(block: AppPageBlock): BlockItem[] {
    return blockItems(block.props);
  }
  strings(block: AppPageBlock, key: string): string[] {
    return blockStrings(block.props, key);
  }
  images(block: AppPageBlock): string[] {
    return blockStrings(block.props, 'image_urls')
      .map((u) => safeUrl(u))
      .filter((u): u is string => !!u);
  }
  url(value: string | undefined): string | null {
    return safeUrl(value);
  }
  stars(item: BlockItem): number {
    return ratingOf(item);
  }

  shippingParts(block: AppPageBlock): { label: string; text: string }[] {
    return this.parts(block, [
      ['shipping', 'Envío'],
      ['warranty', 'Garantía'],
      ['returns', 'Devoluciones'],
    ]);
  }

  policyParts(block: AppPageBlock): { label: string; text: string }[] {
    return this.parts(block, [
      ['deposit', 'Anticipo'],
      ['cancellation', 'Cancelación'],
      ['reminders', 'Recordatorios'],
      ['check_in', 'Check-in'],
      ['check_out', 'Check-out'],
      ['house_rules', 'Reglas de la casa'],
    ]);
  }

  scrollToMain(): void {
    this.document
      .getElementById(this.mainId())
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  private parts(block: AppPageBlock, defs: [string, string][]): { label: string; text: string }[] {
    return defs
      .map(([key, label]) => ({ label, text: blockText(block.props, key) }))
      .filter((p) => p.text);
  }
}
