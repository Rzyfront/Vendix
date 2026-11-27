import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { VexiPublicPresenceService } from '../vexi-public/vexi-public-presence.service';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  APP_HIGHLIGHTS_ICON_OPTIONS,
  APP_PAGE_TEMPLATES,
  AppBlockSpacing,
  AppGalleryAspectRatio,
  AppGalleryVariant,
  AppHeroHeight,
  AppHeroVariant,
  AppHighlightsIcon,
  AppHighlightsVariant,
  AppPageBlock,
  AppPageDocument,
  AppTextAlign,
  PageAppKind,
} from '../../private/modules/store/apps/templates';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { AppPageProductsViewComponent } from './app-page-products-view.component';
import {
  AppPageProductItem,
  blockProductIds,
  blockProductsLayout,
  blockProductsSelection,
  blockShowVariants,
} from './app-page-products.util';
import {
  BlockItem,
  STAR_SLOTS,
  blockEnum,
  blockInt,
  blockItems,
  blockStrings,
  blockText,
  cssBgUrl,
  fontStack,
  overlayRgba,
  ratingOf,
  safeColor,
  safeUrl,
  whatsappHref,
} from './app-page-view.util';
import { hasTheme, onColor, themeMarkers, themeStyle } from './app-page-theme';
import { AppPageFacts, blockConditionsMet } from './app-page-conditions';
import { AppStayFacts, StayDetailPart, stayDetailParts } from './app-page-stay';

interface PlaceholderView {
  id: string;
  label: string;
}

const HERO_VARIANTS: readonly AppHeroVariant[] = ['centered', 'image_right', 'background'];
const HERO_HEIGHTS: readonly AppHeroHeight[] = ['auto', 'compact', 'full'];
const GALLERY_VARIANTS: readonly AppGalleryVariant[] = ['grid', 'carousel', 'mosaic'];
const GALLERY_ASPECTS: readonly AppGalleryAspectRatio[] = ['1:1', '4:3', '16:9'];
const HIGHLIGHTS_VARIANTS: readonly AppHighlightsVariant[] = ['cards', 'list', 'band'];
const BLOCK_SPACINGS: readonly AppBlockSpacing[] = ['compact', 'normal', 'spacious'];
const TEXT_ALIGNS: readonly AppTextAlign[] = ['left', 'center', 'right'];
const STAY_LAYOUTS: readonly ('card' | 'list')[] = ['card', 'list'];
const HIGHLIGHTS_ICON_SET = new Set<string>(APP_HIGHLIGHTS_ICON_OPTIONS.map((o) => o.value));

/**
 * Renderizador público de las páginas de apps (Product Page, Service Page,
 * Booking y Store Home): portada (hero) y bloques activos en orden.
 *
 * Los bloques que representan una sección que el layout ya dibuja (`existing`)
 * se omiten en público y muestran un recuadro guía en `preview`.
 *
 * Las props de variantes y apariencia por sección son opcionales: un documento
 * viejo o una plantilla existente sin ellas renderiza exactamente igual que
 * antes.
 *
 * Apps F3: `page.theme` adds style tokens on the same host (`themeStyle`).
 * The `ap-*` marker classes below only get rules under `:host(.ap-themed)`
 * and every rule falls back to today's value, so a page without `theme`
 * renders exactly as before.
 *
 * Apps F7: the extended tokens (border, type scale, section gap, cards,
 * shadow, image ratio and veil, hero height) follow the same rule: CSS
 * variables whose rules fall back to today's value, plus `data-ap-*` markers
 * (`themeMarkers`) for the rules that have no neutral fallback.
 */
@Component({
  selector: 'app-app-page-view',
  standalone: true,
  imports: [NgTemplateOutlet, IconComponent, AppPageProductsViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ap-themed]': 'themed()',
    '[class.ap-outline]': 'outlineButtons()',
    '[style]': 'themeVars()',
    '[style.--ap-primary]': 'primary()',
    '[style.--ap-secondary]': 'secondary()',
    '[style.font-family]': 'font()',
    '[attr.data-ap-type]': 'markers().type',
    '[attr.data-ap-card]': 'markers().card',
    '[attr.data-ap-shadow]': 'markers().shadow',
    '[attr.data-ap-overlay]': 'markers().overlay',
    '[attr.data-ap-hero]': 'markers().hero',
  },
  styles: [
    `
      :host {
        display: block;
      }
      .ap-accent-bg {
        background-color: var(--ap-primary, var(--color-primary));
        color: var(--ap-on-primary, #fff);
      }
      .ap-accent-text {
        color: var(--ap-accent, var(--ap-primary, var(--color-primary)));
      }
      .ap-accent-soft {
        background-color: color-mix(
          in srgb,
          var(--ap-accent, var(--ap-primary, var(--color-primary))) 10%,
          transparent
        );
        color: var(--ap-accent, var(--ap-primary, var(--color-primary)));
      }
      /* ---- Apps F3: style tokens, only under a theme ---- */
      :host(.ap-themed) {
        background-color: var(--ap-surface, transparent);
        color: var(--ap-text, inherit);
      }
      :host(.ap-themed) .ap-heading {
        font-family: var(--ap-heading-font, inherit);
      }
      :host(.ap-themed) .ap-wrap {
        max-width: var(--ap-max-width, 72rem);
      }
      :host(.ap-themed) .ap-section {
        max-width: var(--ap-max-width, 72rem);
        padding-top: calc(var(--ap-section-py, 2rem) * var(--ap-section-gap, 1));
        padding-bottom: calc(var(--ap-section-py, 2rem) * var(--ap-section-gap, 1));
      }
      @media (min-width: 768px) {
        :host(.ap-themed) .ap-section {
          padding-top: calc(var(--ap-section-py-md, 2.5rem) * var(--ap-section-gap, 1));
          padding-bottom: calc(var(--ap-section-py-md, 2.5rem) * var(--ap-section-gap, 1));
        }
      }
      :host(.ap-themed) .ap-grid {
        gap: var(--ap-gap, 1rem);
      }
      :host(.ap-themed) .ap-card {
        border-radius: var(--ap-radius-card, 1rem);
        padding: var(--ap-card-padding, 1.25rem);
      }
      :host(.ap-themed) .ap-round {
        border-radius: var(--ap-radius-card, 1rem);
      }
      /* The page's own palette wins over a panel decoration (e.g. the admin
         "aura" preset paints a gradient on every .bg-surface). */
      :host(.ap-themed) .ap-card,
      :host(.ap-themed) .ap-round {
        background-image: none;
      }
      :host(.ap-themed) .ap-cta-box {
        border-radius: var(--ap-radius-card, 1.5rem);
      }
      :host(.ap-themed) .ap-btn {
        border-radius: var(--ap-radius-button, 9999px);
      }
      :host(.ap-themed) .ap-img {
        border-radius: var(--ap-radius-image, 0.75rem);
        aspect-ratio: var(--ap-image-ratio, 1 / 1);
      }
      :host(.ap-themed) .ap-img-hero {
        border-radius: var(--ap-radius-image, 1rem);
        aspect-ratio: var(--ap-image-ratio, auto);
      }
      /* ---- Apps F7: extended tokens ---- */
      :host(.ap-themed) .ap-hero-inner {
        padding-top: var(--ap-hero-py, 3rem);
        padding-bottom: var(--ap-hero-py, 3rem);
      }
      @media (min-width: 768px) {
        :host(.ap-themed) .ap-hero-inner {
          padding-top: var(--ap-hero-py-md, 4rem);
          padding-bottom: var(--ap-hero-py-md, 4rem);
        }
      }
      /* Altura "full" de la portada: una sola regla ganadora usando --ap-hero-min-h
         (el preview del editor fija 620px; en público cae a 100svh).
         Precedencia: el bloque (hero.height) gana sobre el tema (theme.hero_height);
         si el bloque fija auto o compact, anula data-ap-hero="full". */
      .ap-hero.ap-hero--full,
      :host([data-ap-hero='full']) .ap-hero:not(.ap-hero--auto):not(.ap-hero--compact) {
        display: flex;
        align-items: center;
        min-height: var(--ap-hero-min-h, 100svh);
      }
      /* El alto explícito del bloque prevalece sobre el padding vertical del tema. */
      .ap-hero--compact .ap-hero-inner,
      :host(.ap-themed) .ap-hero--compact .ap-hero-inner {
        padding-top: 2rem;
        padding-bottom: 2rem;
      }
      .ap-hero--auto .ap-hero-inner,
      :host(.ap-themed) .ap-hero--auto .ap-hero-inner {
        padding-top: 3rem;
        padding-bottom: 3rem;
      }
      .ap-hero--full .ap-hero-inner,
      :host(.ap-themed) .ap-hero--full .ap-hero-inner {
        padding-top: 4rem;
        padding-bottom: 4rem;
      }
      @media (min-width: 768px) {
        .ap-hero--compact .ap-hero-inner,
        :host(.ap-themed) .ap-hero--compact .ap-hero-inner {
          padding-top: 2.5rem;
          padding-bottom: 2.5rem;
        }
        .ap-hero--auto .ap-hero-inner,
        :host(.ap-themed) .ap-hero--auto .ap-hero-inner {
          padding-top: 4rem;
          padding-bottom: 4rem;
        }
        .ap-hero--full .ap-hero-inner,
        :host(.ap-themed) .ap-hero--full .ap-hero-inner {
          padding-top: 6rem;
          padding-bottom: 6rem;
        }
      }
      :host([data-ap-card='flat']) .ap-card,
      :host([data-ap-card='flat']) .ap-round {
        border-color: transparent;
      }
      :host([data-ap-card='outline']) .ap-card,
      :host([data-ap-card='outline']) .ap-round {
        background-color: transparent;
      }
      :host([data-ap-card='soft']) .ap-card,
      :host([data-ap-card='soft']) .ap-round {
        border-color: transparent;
        background-color: color-mix(
          in srgb,
          var(--ap-primary, var(--color-primary)) 6%,
          var(--ap-surface, #ffffff)
        );
      }
      :host([data-ap-shadow]) .ap-card,
      :host([data-ap-shadow]) .ap-round {
        box-shadow: var(--ap-card-shadow, none);
      }
      :host([data-ap-overlay]) .ap-img,
      :host([data-ap-overlay]) .ap-img-hero {
        filter: brightness(var(--ap-image-brightness, 1));
      }
      .ap-cover-veil,
      :host([data-ap-overlay]) .ap-cover-veil {
        background-color: rgb(0 0 0 / var(--ap-image-overlay, 0.4));
      }
      /* Type scale: same sizes as the Tailwind classes, times the token. */
      :host([data-ap-type]) .text-xs {
        font-size: calc(0.75rem * var(--ap-font-scale, 1));
      }
      :host([data-ap-type]) .text-sm {
        font-size: calc(0.875rem * var(--ap-font-scale, 1));
      }
      :host([data-ap-type]) .text-base {
        font-size: calc(1rem * var(--ap-font-scale, 1));
      }
      :host([data-ap-type]) .text-lg {
        font-size: calc(1.125rem * var(--ap-font-scale, 1));
      }
      :host([data-ap-type]) .ap-heading.text-base {
        font-size: calc(1rem * var(--ap-font-scale, 1) * var(--ap-heading-scale, 1));
      }
      :host([data-ap-type]) .ap-heading.text-xl {
        font-size: calc(1.25rem * var(--ap-font-scale, 1) * var(--ap-heading-scale, 1));
      }
      :host([data-ap-type]) .ap-heading.text-2xl {
        font-size: calc(1.5rem * var(--ap-font-scale, 1) * var(--ap-heading-scale, 1));
      }
      :host([data-ap-type]) .ap-heading.text-3xl {
        font-size: calc(1.875rem * var(--ap-font-scale, 1) * var(--ap-heading-scale, 1));
      }
      @media (min-width: 768px) {
        :host([data-ap-type]) .md\\:text-base {
          font-size: calc(1rem * var(--ap-font-scale, 1));
        }
        :host([data-ap-type]) .md\\:text-lg {
          font-size: calc(1.125rem * var(--ap-font-scale, 1));
        }
        :host([data-ap-type]) .ap-heading.md\\:text-2xl {
          font-size: calc(1.5rem * var(--ap-font-scale, 1) * var(--ap-heading-scale, 1));
        }
        :host([data-ap-type]) .ap-heading.md\\:text-3xl {
          font-size: calc(1.875rem * var(--ap-font-scale, 1) * var(--ap-heading-scale, 1));
        }
        :host([data-ap-type]) .ap-heading.md\\:text-5xl {
          font-size: calc(3rem * var(--ap-font-scale, 1) * var(--ap-heading-scale, 1));
        }
      }
      :host(.ap-themed) .ap-hero-fallback .ap-on-fill {
        color: var(--ap-on-primary, #fff);
      }
      :host(.ap-outline) .ap-btn-primary {
        background-color: transparent;
        color: var(--ap-primary, var(--color-primary));
        box-shadow: inset 0 0 0 2px currentColor;
      }
      :host(.ap-outline) .ap-btn-light {
        background-color: transparent;
        color: inherit;
        box-shadow: inset 0 0 0 2px currentColor;
      }
      .ap-hero-fallback {
        background: linear-gradient(
          135deg,
          var(--ap-primary, var(--color-primary)),
          var(--ap-secondary, var(--ap-primary, var(--color-primary)))
        );
      }
      /* ---- Apps sections: espaciado y acentos opcionales por bloque ---- */
      .ap-section.ap-spacing--compact,
      :host(.ap-themed) .ap-section.ap-spacing--compact {
        padding-top: 1.25rem;
        padding-bottom: 1.25rem;
      }
      .ap-section.ap-spacing--normal,
      :host(.ap-themed) .ap-section.ap-spacing--normal {
        padding-top: 2.5rem;
        padding-bottom: 2.5rem;
      }
      .ap-section.ap-spacing--spacious,
      :host(.ap-themed) .ap-section.ap-spacing--spacious {
        padding-top: 4rem;
        padding-bottom: 4rem;
      }
      .ap-section--bg {
        position: relative;
        overflow: hidden;
        border-radius: var(--ap-radius-card, 1rem);
        margin-top: 0.75rem;
        margin-bottom: 0.75rem;
      }
      .ap-section--on-dark {
        --ap-on-fill: #ffffff;
        --ap-surface: #0f172a;
        --color-text-primary-rgb: 255, 255, 255;
        --color-text-secondary-rgb: 226, 232, 240;
        --color-surface-rgb: 15, 23, 42;
        --color-border: rgba(255, 255, 255, 0.22);
        color: var(--ap-on-fill);
      }
      .ap-section--on-dark .ap-section-content :is(h2, h3, p, dt, dd, summary, blockquote, figcaption, li, a, .ap-accent-text) {
        color: var(--ap-on-fill, #ffffff);
      }
      .ap-section--on-dark .ap-accent-soft {
        background-color: rgba(255, 255, 255, 0.16);
        color: var(--ap-on-fill, #ffffff);
      }
      .ap-section--on-dark .ap-card,
      .ap-section--on-dark .ap-round,
      .ap-section--on-dark .ap-highlights-band-box,
      :host(.ap-themed) .ap-section--on-dark .ap-card,
      :host(.ap-themed) .ap-section--on-dark .ap-round,
      :host([data-ap-card]) .ap-section--on-dark .ap-card,
      :host([data-ap-card]) .ap-section--on-dark .ap-round {
        background-color: rgba(15, 23, 42, 0.55);
        border-color: rgba(255, 255, 255, 0.22);
      }
      .ap-section--on-light {
        --ap-on-fill: #111827;
        --ap-surface: #ffffff;
        --color-text-primary-rgb: 17, 24, 39;
        --color-text-secondary-rgb: 55, 65, 81;
        --color-surface-rgb: 255, 255, 255;
        --color-border: rgba(17, 24, 39, 0.14);
        color: var(--ap-on-fill);
      }
      .ap-section--on-light .ap-section-content :is(h2, h3, p, dt, dd, summary, blockquote, figcaption, li) {
        color: var(--ap-on-fill, #111827);
      }
      /* El recuadro CTA conserva su propio relleno primario y contraste --ap-on-primary. */
      .ap-section--on-dark .ap-cta-box,
      .ap-section--on-light .ap-cta-box {
        color: var(--ap-on-primary, #ffffff);
      }
      .ap-section--on-dark .ap-cta-box :is(h2, p),
      .ap-section--on-light .ap-cta-box :is(h2, p) {
        color: inherit;
      }
      .ap-highlight-icon {
        background-color: color-mix(
          in srgb,
          var(--ap-block-accent, var(--ap-accent, var(--ap-primary, var(--color-primary)))) 14%,
          transparent
        );
        color: var(--ap-block-accent, var(--ap-accent, var(--ap-primary, var(--color-primary))));
      }
      .ap-highlight-accent-top {
        border-top: 3px solid var(--ap-block-accent);
      }
      .ap-highlight-accent-left {
        border-left: 4px solid var(--ap-block-accent, var(--ap-accent, var(--ap-primary, var(--color-primary))));
      }
      .ap-highlights-band-box {
        background-color: color-mix(
          in srgb,
          var(--ap-block-accent, var(--ap-accent, var(--ap-primary, var(--color-primary)))) 9%,
          var(--ap-surface, var(--color-surface, #ffffff))
        );
      }
    `,
  ],
  template: `
    @if (showHero() && hero(); as h) {
      <section
        class="ap-hero relative overflow-hidden border-b border-border"
        [class.ap-hero-fallback]="heroUseFallbackGradient()"
        [class.ap-hero--centered]="h.variant === 'centered'"
        [class.ap-hero--image-right]="h.variant === 'image_right'"
        [class.ap-hero--background]="h.variant === 'background'"
        [class.ap-hero--compact]="h.height === 'compact'"
        [class.ap-hero--auto]="h.height === 'auto'"
        [class.ap-hero--full]="h.height === 'full'"
        [style.background-image]="heroBgCss()"

        [style.background-size]="'cover'"
        [style.background-position]="'center'"
        [attr.data-hero-variant]="h.variant ?? null"
        [attr.data-hero-height]="h.height ?? null"
        [attr.data-hero-align]="h.align ?? null"
        data-testid="app-page-hero"
        [attr.data-block-id]="blockIds() ? 'hero' : null"
      >
        @if (heroLegacyCoverVeil()) {
          <div
            class="ap-cover-veil pointer-events-none absolute inset-0"
            [style.background-color]="heroExplicitOverlayCss()"
          ></div>
        } @else if (heroOverlayCss(); as veil) {
          <div
            class="pointer-events-none absolute inset-0"
            [style.background-color]="veil"
            data-testid="hero-overlay"
          ></div>
        }
        <div
          class="ap-wrap ap-hero-inner relative mx-auto grid w-full max-w-6xl items-center gap-8 px-4"
          [class]="heroContainerClass()"

        >
          <div class="ap-on-fill" [class]="heroCopyClass()">
            @if (h.eyebrow) {
              <p
                class="mb-2 text-xs font-semibold uppercase tracking-wider"
                [class.ap-accent-text]="!heroDarkSurface()"
                data-testid="hero-eyebrow"
              >
                {{ h.eyebrow }}
              </p>
            }
            @if (h.title) {
              <h1 class="ap-heading text-3xl font-bold leading-tight md:text-5xl" data-testid="hero-title">{{ h.title }}</h1>
            }
            @if (h.subtitle) {
              <p
                class="mt-4 max-w-xl text-base opacity-90 md:text-lg"
                [class.mx-auto]="heroTextAlign() === 'center'"
                [class.ml-auto]="heroTextAlign() === 'right'"
                data-testid="hero-subtitle"
              >
                {{ h.subtitle }}
              </p>
            }
            @if (h.button_label) {
              <button
                type="button"
                class="ap-btn mt-6 inline-flex min-h-11 items-center justify-center rounded-full px-6 py-3 text-sm font-semibold"
                [class]="heroDarkSurface() ? 'ap-btn-light bg-white text-gray-900' : 'ap-accent-bg ap-btn-primary'"
                data-testid="hero-button"
                (click)="scrollToMain()"
              >
                {{ h.button_label }}
              </button>
            }
          </div>
          @if (heroShowForegroundImage() && h.image_url) {
            <img
              [src]="h.image_url"
              [alt]="h.title || 'Imagen principal'"
              loading="lazy"
              class="ap-img-hero w-full rounded-2xl object-cover shadow-sm md:max-h-96"
              [class.mx-auto]="h.variant === 'centered'"
              [class.max-w-3xl]="h.variant === 'centered'"
              data-testid="hero-image"
            />
          }
        </div>
      </section>
    }

    @if (showBlocks()) {
      @for (item of views(); track item.block.id) {
        @if (item.placeholder; as ph) {
          <section class="mx-auto w-full max-w-6xl px-4 py-6" data-testid="app-page-placeholder" [attr.data-block-id]="blockIds() ? item.block.id : null">
            <div class="rounded-xl border-2 border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
              Aquí va: {{ ph.label }}
            </div>
          </section>
        } @else {
          <section
            class="ap-section mx-auto w-full max-w-6xl px-4 py-8 md:py-10"
            [class.ap-section--bg]="blockHasBackground(item.block)"
            [class.ap-section--on-image]="!!blockBgImage(item.block)"
            [class.ap-section--on-dark]="blockSurfaceTone(item.block) === 'dark'"
            [class.ap-section--on-light]="blockSurfaceTone(item.block) === 'light'"
            [class.ap-spacing--compact]="blockSpacing(item.block) === 'compact'"
            [class.ap-spacing--normal]="blockSpacing(item.block) === 'normal'"
            [class.ap-spacing--spacious]="blockSpacing(item.block) === 'spacious'"
            [class.text-left]="blockAlign(item.block) === 'left'"
            [class.text-center]="blockAlign(item.block) === 'center'"
            [class.text-right]="blockAlign(item.block) === 'right'"
            [style.background-color]="blockBgColor(item.block)"
            [style.background-image]="blockBgImage(item.block)"
            [style.background-size]="blockBgImage(item.block) ? 'cover' : null"
            [style.background-position]="blockBgImage(item.block) ? 'center' : null"
            [attr.data-block]="item.block.type"
            [attr.data-block-id]="blockIds() ? item.block.id : null"
            [attr.data-spacing]="blockSpacing(item.block)"
            [attr.data-align]="blockAlign(item.block)"
            [attr.aria-labelledby]="titleOf(item.block) ? 'ap-' + item.block.id : null"
          >
            @if (blockBgImage(item.block)) {
              <div
                class="ap-block-overlay pointer-events-none absolute inset-0"
                [style.background-color]="blockOverlayCss(item.block)"
                data-testid="block-overlay"
              ></div>
            }
            <div class="ap-section-content" [class.relative]="blockHasBackground(item.block)" [class.z-10]="blockHasBackground(item.block)">
              @switch (item.block.type) {
                @case ('benefits') {
                  <ng-container *ngTemplateOutlet="highlightsTpl; context: { b: item.block }" />
                }
                @case ('highlights') {
                  <ng-container *ngTemplateOutlet="highlightsTpl; context: { b: item.block }" />
                }
                @case ('how_it_works') {
                  <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                  <ol class="ap-grid grid gap-4 md:grid-cols-3">
                    @for (step of items(item.block); track $index) {
                      <li class="flex gap-4 ap-card rounded-2xl border border-border bg-surface p-5 text-left">
                        <span class="ap-accent-bg flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold">{{ $index + 1 }}</span>
                        <div>
                          <h3 class="ap-heading text-base font-semibold text-text-primary">{{ step['title'] }}</h3>
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
                  <dl class="ap-round grid overflow-hidden rounded-2xl border border-border bg-surface text-left sm:grid-cols-2">
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
                  @if (galleryVariant(item.block) === 'carousel') {
                    <div class="ap-gallery ap-gallery--carousel relative" data-gallery-variant="carousel" data-testid="gallery-carousel">
                      <div
                        #carouselTrack
                        class="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scroll-smooth"
                        data-testid="gallery-carousel-track"
                      >
                        @for (imgUrl of images(item.block); track $index) {
                          <div class="shrink-0 snap-start" [class]="galleryCarouselSlideClass(item.block)">
                            <img
                              [src]="imgUrl"
                              [alt]="titleOf(item.block) || 'Imagen de la galería'"
                              loading="lazy"
                              class="ap-img w-full rounded-xl object-cover"
                              [class]="galleryAspectClass(item.block)"
                            />
                          </div>
                        }
                      </div>
                      @if (images(item.block).length > 1) {
                        <div class="mt-3 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-primary hover:bg-surface-secondary"
                            aria-label="Imagen anterior"
                            data-testid="gallery-carousel-prev"
                            (click)="scrollCarousel(carouselTrack, -1)"
                          >
                            <app-icon name="chevron-left" [size]="16" />
                          </button>
                          <button
                            type="button"
                            class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-primary hover:bg-surface-secondary"
                            aria-label="Imagen siguiente"
                            data-testid="gallery-carousel-next"
                            (click)="scrollCarousel(carouselTrack, 1)"
                          >
                            <app-icon name="chevron-right" [size]="16" />
                          </button>
                        </div>
                      }
                    </div>
                  } @else if (galleryVariant(item.block) === 'mosaic') {
                    <div
                      class="ap-grid ap-gallery ap-gallery--mosaic grid grid-cols-2 gap-3 md:grid-cols-4"
                      data-gallery-variant="mosaic"
                      data-testid="gallery-mosaic"
                    >
                      @for (imgUrl of images(item.block); track $index; let first = $first) {
                        <img
                          [src]="imgUrl"
                          [alt]="titleOf(item.block) || 'Imagen de la galería'"
                          loading="lazy"
                          class="ap-img w-full rounded-xl object-cover"
                          [class]="first ? 'col-span-2 md:col-span-2 md:row-span-2 h-full min-h-[14rem]' : galleryAspectClass(item.block)"
                        />
                      }
                    </div>
                  } @else {
                    <div
                      class="ap-grid ap-gallery ap-gallery--grid grid gap-3"
                      [class]="galleryGridColsClass(item.block)"
                      [attr.data-gallery-variant]="galleryExplicitVariant(item.block)"
                      data-testid="gallery-grid"
                    >
                      @for (imgUrl of images(item.block); track $index) {
                        <img
                          [src]="imgUrl"
                          [alt]="titleOf(item.block) || 'Imagen de la galería'"
                          loading="lazy"
                          class="ap-img w-full rounded-xl object-cover"
                          [class]="galleryAspectClass(item.block)"
                        />
                      }
                    </div>
                  }
                }
                @case ('testimonials') {
                  <div class="mb-6 flex flex-wrap items-baseline gap-3" [class.justify-center]="blockAlign(item.block) === 'center'" [class.justify-end]="blockAlign(item.block) === 'right'">
                    @if (titleOf(item.block)) {
                      <h2 [id]="'ap-' + item.block.id" class="ap-heading text-xl font-bold text-text-primary md:text-2xl">{{ titleOf(item.block) }}</h2>
                    }
                    @if (text(item.block, 'rating_summary')) {
                      <span class="ap-accent-soft rounded-full px-3 py-1 text-sm font-semibold" data-testid="rating-summary">★ {{ text(item.block, 'rating_summary') }}</span>
                    }
                  </div>
                  <div class="ap-grid grid gap-4 md:grid-cols-3 text-left">
                    @for (t of items(item.block); track $index) {
                      <figure class="flex flex-col gap-3 ap-card rounded-2xl border border-border bg-surface p-5">
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
                  <div class="ap-grid grid gap-4 md:grid-cols-3 text-left">
                    @for (part of shippingParts(item.block); track part.label) {
                      <article class="ap-card rounded-2xl border border-border bg-surface p-5">
                        <h3 class="ap-heading text-base font-semibold text-text-primary">{{ part.label }}</h3>
                        <p class="mt-2 text-sm text-text-secondary">{{ part.text }}</p>
                      </article>
                    }
                  </div>
                }
                @case ('faq') {
                  <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                  <div class="ap-round mx-auto max-w-3xl divide-y divide-border rounded-2xl border border-border bg-surface text-left">
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
                  <div
                    class="ap-accent-bg ap-cta-box rounded-3xl px-6 py-10 md:py-14"
                    [class]="url(text(item.block, 'image_url')) ? 'grid items-center gap-6 text-left md:grid-cols-2 md:px-10' : 'text-center'"
                    data-testid="cta"
                  >
                    <div>
                      @if (titleOf(item.block)) {
                        <h2 [id]="'ap-' + item.block.id" class="ap-heading text-2xl font-bold md:text-3xl">{{ titleOf(item.block) }}</h2>
                      }
                      @if (text(item.block, 'text')) {
                        <p
                          class="mt-3 max-w-xl text-sm opacity-90 md:text-base"
                          [class.mx-auto]="!url(text(item.block, 'image_url'))"
                        >
                          {{ text(item.block, 'text') }}
                        </p>
                      }
                      @if (text(item.block, 'button_label')) {
                        <button
                          type="button"
                          class="ap-btn ap-btn-light mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-gray-900"
                          data-testid="cta-button"
                          (click)="scrollToMain()"
                        >
                          {{ text(item.block, 'button_label') }}
                        </button>
                      }
                    </div>
                    @if (url(text(item.block, 'image_url')); as ctaImg) {
                      <img
                        [src]="ctaImg"
                        [alt]="titleOf(item.block) || 'Imagen de llamado a la acción'"
                        loading="lazy"
                        class="ap-img max-h-64 w-full rounded-2xl object-cover"
                        data-testid="cta-image"
                      />
                    }
                  </div>
                }
                @case ('team') {
                  <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                  <div class="ap-grid grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
                    @for (m of items(item.block); track $index) {
                      <article class="ap-round flex gap-4 rounded-2xl border border-border bg-surface p-4">
                        @if (url(m['photo_url']); as photo) {
                          <img [src]="photo" [alt]="m['name']" loading="lazy" class="h-16 w-16 shrink-0 rounded-full object-cover" />
                        }
                        <div class="min-w-0">
                          <h3 class="ap-heading text-base font-semibold text-text-primary">{{ m['name'] }}</h3>
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
                  <dl class="ap-grid grid gap-4 text-left md:grid-cols-2">
                    @for (part of policyParts(item.block); track part.label) {
                      <div class="ap-card rounded-2xl border border-border bg-surface p-5">
                        <dt class="text-sm font-semibold text-text-primary">{{ part.label }}</dt>
                        <dd class="mt-1 text-sm text-text-secondary">{{ part.text }}</dd>
                      </div>
                    }
                  </dl>
                }
                @case ('stay_detail') {
                  <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                  @if (stayLayout(item.block) === 'list') {
                    <dl class="ap-card divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface text-left" data-testid="stay-detail-list">
                      @for (part of stayParts(item.block); track part.key) {
                        <div class="flex gap-3 p-4" [attr.data-stay]="part.key">
                          <app-icon [name]="part.icon" [size]="18" class="ap-accent-text mt-0.5 shrink-0" />
                          <div class="min-w-0">
                            <dt class="text-sm font-semibold text-text-primary">{{ part.label }}</dt>
                            <dd class="mt-0.5 text-sm text-text-secondary">{{ part.text }}</dd>
                          </div>
                        </div>
                      }
                    </dl>
                  } @else {
                    <dl class="ap-grid grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3" data-testid="stay-detail-cards">
                      @for (part of stayParts(item.block); track part.key) {
                        <div class="ap-card rounded-2xl border border-border bg-surface p-5" [attr.data-stay]="part.key">
                          <dt class="flex items-center gap-2 text-sm font-semibold text-text-primary">
                            <app-icon [name]="part.icon" [size]="16" class="ap-accent-text shrink-0" /> {{ part.label }}
                          </dt>
                          @if (part.items) {
                            <dd class="mt-2">
                              <ul class="space-y-1 text-sm text-text-secondary">
                                @for (entry of part.items; track $index) {
                                  <li class="flex items-start gap-1.5"><app-icon name="check" [size]="14" class="ap-accent-text mt-0.5 shrink-0" /> {{ entry }}</li>
                                }
                              </ul>
                            </dd>
                          } @else {
                            <dd class="mt-1 text-sm text-text-secondary">{{ part.text }}</dd>
                          }
                        </div>
                      }
                    </dl>
                  }
                }
                @case ('amenities') {
                  <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                  <ul class="flex flex-wrap gap-2" [class.justify-center]="blockAlign(item.block) === 'center'" [class.justify-end]="blockAlign(item.block) === 'right'">
                    @for (a of strings(item.block, 'items'); track $index) {
                      <li class="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-text-primary">{{ a }}</li>
                    }
                  </ul>
                }
                @case ('location') {
                  <ng-container *ngTemplateOutlet="head; context: { b: item.block }" />
                  <div class="ap-card rounded-2xl border border-border bg-surface p-5 text-sm">
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
                  <div class="ap-card grid gap-3 rounded-2xl border border-border bg-surface p-5 text-left text-sm sm:grid-cols-2">
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
                @case ('products') {
                  <app-page-products-view
                    [title]="titleOf(item.block)"
                    [selection]="productsSelection(item.block)"
                    [productIds]="productsIds(item.block)"
                    [autoProductIds]="autoProductIds()"
                    [showVariants]="productsShowVariants(item.block)"
                    [layout]="productsLayout(item.block)"
                    [preview]="preview() || previewProducts() !== null"
                    [previewItems]="previewProducts()"
                    [allowCatalogFallback]="kind() === 'product_page'"
                  />
                }
              }
            </div>
          </section>
        }
      }
    }

    @if (showBlocks() && whatsappUrl(); as wa) {
      <a
        [href]="wa"
        target="_blank"
        rel="noopener noreferrer"
        class="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl"
        data-testid="app-page-whatsapp"
        aria-label="Escríbenos por WhatsApp"
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5 fill-current" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1.1 2.8 1.2 3c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/></svg>
        WhatsApp
      </a>
    }

    <!-- Destacados y beneficios: tarjetas, lista o banda, con imagen, icono y color de acento -->
    <ng-template #highlightsTpl let-b="b">
      <div [style.--ap-block-accent]="blockAccent(b)">
        <ng-container *ngTemplateOutlet="head; context: { b: b }" />
        @if (highlightsVariant(b) === 'list') {
          <div class="ap-highlights ap-highlights--list flex flex-col gap-3 text-left" data-highlights-variant="list" data-testid="highlights-list">
            @for (card of items(b); track $index) {
              <article class="ap-card ap-highlight-accent-left flex items-start gap-4 rounded-2xl border border-border bg-surface p-5">
                @if (url(card['image_url']); as img) {
                  <img [src]="img" [alt]="card['title'] || 'Destacado'" loading="lazy" class="ap-img h-16 w-16 shrink-0 rounded-xl object-cover" data-testid="highlight-image" />
                } @else if (highlightIcon(card['icon']); as ic) {
                  <span class="ap-highlight-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" data-testid="highlight-icon">
                    <app-icon [name]="ic" [size]="18" />
                  </span>
                }
                <div class="min-w-0">
                  <h3 class="ap-heading text-base font-semibold text-text-primary">{{ card['title'] }}</h3>
                  @if (card['text']) {
                    <p class="mt-1 text-sm text-text-secondary">{{ card['text'] }}</p>
                  }
                </div>
              </article>
            }
          </div>
        } @else if (highlightsVariant(b) === 'band') {
          <div class="ap-highlights ap-highlights--band ap-highlights-band-box ap-round rounded-2xl border border-border p-6" data-highlights-variant="band" data-testid="highlights-band">
            <div class="ap-grid grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              @for (card of items(b); track $index) {
                <article class="flex items-start gap-3 text-left">
                  @if (url(card['image_url']); as img) {
                    <img [src]="img" [alt]="card['title'] || 'Destacado'" loading="lazy" class="ap-img h-12 w-12 shrink-0 rounded-xl object-cover" data-testid="highlight-image" />
                  } @else if (highlightIcon(card['icon']); as ic) {
                    <span class="ap-highlight-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" data-testid="highlight-icon">
                      <app-icon [name]="ic" [size]="18" />
                    </span>
                  }
                  <div class="min-w-0">
                    <h3 class="ap-heading text-base font-semibold text-text-primary">{{ card['title'] }}</h3>
                    @if (card['text']) {
                      <p class="mt-1 text-sm text-text-secondary">{{ card['text'] }}</p>
                    }
                  </div>
                </article>
              }
            </div>
          </div>
        } @else {
          <div
            class="ap-grid ap-highlights ap-highlights--cards grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            [attr.data-highlights-variant]="highlightsExplicitVariant(b)"
            data-testid="highlights-cards"
          >
            @for (card of items(b); track $index) {
              <article
                class="ap-card rounded-2xl border border-border bg-surface p-5"
                [class.ap-highlight-accent-top]="!!blockAccent(b)"
              >
                @if (url(card['image_url']); as img) {
                  <img [src]="img" [alt]="card['title'] || 'Destacado'" loading="lazy" class="ap-img mb-3 aspect-[16/10] w-full rounded-xl object-cover" data-testid="highlight-image" />
                }
                @if (highlightIcon(card['icon']); as ic) {
                  <span class="ap-highlight-icon mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl" data-testid="highlight-icon">
                    <app-icon [name]="ic" [size]="18" />
                  </span>
                }
                <h3 class="ap-heading text-base font-semibold text-text-primary">{{ card['title'] }}</h3>
                @if (card['text']) {
                  <p class="mt-2 text-sm text-text-secondary">{{ card['text'] }}</p>
                }
              </article>
            }
          </div>
        }
      </div>
    </ng-template>

    <ng-template #head let-b="b">
      @if (titleOf(b)) {
        <h2 [id]="'ap-' + b.id" class="ap-heading mb-6 text-xl font-bold text-text-primary md:text-2xl">{{ titleOf(b) }}</h2>
      }
    </ng-template>
  `,
})
export class AppPageViewComponent {
  private readonly vexiPresence = inject(VexiPublicPresenceService);
  private readonly document = inject(DOCUMENT);

  readonly kind = input.required<PageAppKind>();
  readonly page = input<AppPageDocument | null>(null);
  /** `'hero'`: only the hero; `'blocks'`: only the blocks; `'all'`: both. */
  readonly part = input<'hero' | 'blocks' | 'all'>('all');
  /** Admin preview: shows a placeholder where an existing section goes. */
  readonly preview = input(false);
  /**
   * F6-B: marks the hero and each section with `data-block-id`, so the
   * editor's preview frame can select and highlight them. Off on the public
   * page (no extra attributes).
   */
  readonly blockIds = input(false);
  /** Element id the hero and cta buttons scroll to (the page's main content). */
  readonly mainId = input('app-page-main');
  /** IDs automáticos de productos de la página (complementos/secundarios) para bloques `products` en modo `auto`. */
  readonly autoProductIds = input<readonly number[]>([]);
  /** Catálogo pre-resuelto para la vista previa del editor (sin peticiones HTTP). */
  readonly previewProducts = input<readonly AppPageProductItem[] | null>(null);
  /**
   * Datos reales de la página para `visible_when` (fotos, disponibilidad,
   * venta). `null` (apps sin condiciones) muestra todos los bloques.
   */
  readonly facts = input<AppPageFacts | null>(null);
  /** Booking: datos reales de la estadía para `stay_detail` (`stay_facts` del servidor). */
  readonly stayFacts = input<AppStayFacts | null>(null);

  readonly starSlots = STAR_SLOTS;

  readonly showHero = computed(() => this.part() !== 'blocks');
  readonly showBlocks = computed(() => this.part() !== 'hero');

  /** Apps F3: whether the page carries style tokens (`page.theme`). */
  readonly themed = computed(() => hasTheme(this.page()));
  readonly outlineButtons = computed(() => this.page()?.theme?.button_style === 'outline');
  /** CSS custom properties of the theme; `null` (nothing bound) without theme. */
  readonly themeVars = computed(() => themeStyle(this.page()));
  /** Apps F7: `data-ap-*` markers of the extended tokens; all `null` without them. */
  readonly markers = computed(() => themeMarkers(this.page()));

  /** The theme's color wins over the brand's; without theme the brand's, as before. */
  readonly primary = computed(
    () => safeColor(this.page()?.theme?.primary_color) ?? safeColor(this.page()?.brand?.primary_color),
  );
  readonly secondary = computed(
    () => safeColor(this.page()?.theme?.secondary_color) ?? safeColor(this.page()?.brand?.secondary_color),
  );
  readonly font = computed(
    () => fontStack(this.page()?.theme?.body_font) ?? fontStack(this.page()?.brand?.font_family),
  );
  readonly coverCss = computed(() => cssBgUrl(this.page()?.brand?.cover_url));

  /** F6-B: the floating WhatsApp button, only when the owner turned it on with a number. */
  readonly whatsappUrl = computed(() => {
    const brand = this.page()?.brand;
    if (!brand?.whatsapp_floating) return null;
    // Vexi público F2 (D5): where Vexi shows, it IS the WhatsApp-style button
    // (and hands off to the real WhatsApp after an order): never two bubbles.
    if (this.vexiPresence.active()) return null;
    return whatsappHref(brand.whatsapp_number, brand.whatsapp_message);
  });

  readonly hero = computed(() => {
    const h = this.page()?.hero;
    if (!h) return null;
    const image_url = safeUrl(h.image_url) ?? undefined;
    const background_image_url = safeUrl(h.background_image_url) ?? undefined;
    if (!(h.title || h.subtitle || h.eyebrow || image_url || background_image_url)) return null;
    const variant = h.variant && HERO_VARIANTS.includes(h.variant) ? h.variant : undefined;
    const height = h.height && HERO_HEIGHTS.includes(h.height) ? h.height : undefined;
    const align = h.align && TEXT_ALIGNS.includes(h.align) ? h.align : undefined;
    const overlay_opacity =
      typeof h.overlay_opacity === 'number' && Number.isInteger(h.overlay_opacity) && h.overlay_opacity >= 0 && h.overlay_opacity <= 80
        ? h.overlay_opacity
        : undefined;
    return { ...h, image_url, background_image_url, variant, height, align, overlay_opacity };
  });

  /** Imagen de fondo efectiva del hero (prioriza `background_image_url`; en variante `background` usa `image_url` como respaldo). */
  readonly heroBgCss = computed(() => {
    const h = this.hero();
    if (!h) return null;
    if (h.background_image_url) return cssBgUrl(h.background_image_url);
    if (h.variant === 'background') return cssBgUrl(h.image_url) ?? this.coverCss();
    if (!h.image_url) return this.coverCss();
    return null;
  });

  /** Muestra degradado de marca cuando no hay foto de fondo ni imagen principal en primer plano. */
  readonly heroUseFallbackGradient = computed(() => {
    const h = this.hero();
    if (!h) return false;
    if (this.heroBgCss()) return false;
    if (h.variant === 'background') return true;
    return !h.image_url;
  });

  /** Muestra la imagen principal en primer plano (nunca en la variante `background`, donde va de fondo). */
  readonly heroShowForegroundImage = computed(() => {
    const h = this.hero();
    return !!h && h.variant !== 'background' && !!h.image_url;
  });

  /** Superficie oscura del hero (degradado de marca o imagen de fondo con velo): texto blanco. */
  readonly heroDarkSurface = computed(() => !!this.heroBgCss() || this.heroUseFallbackGradient());

  /** Opacidad del velo definida en el tema F7 (`theme.image_overlay`, 0..80), o `null`. */
  readonly themeImageOverlay = computed<number | null>(() => {
    const v = this.page()?.theme?.image_overlay;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 80 ? v : null;
  });

  /**
   * Velo clásico de portada (`.ap-cover-veil`) para documentos sin `image_url`,
   * sin `background_image_url` y fuera de la variante `background`, cuando usan
   * `brand.cover_url`. Su color sale del token `--ap-image-overlay` (F7).
   */
  readonly heroLegacyCoverVeil = computed(() => {
    const h = this.hero();
    return !!h && !h.background_image_url && h.variant !== 'background' && !h.image_url && !!this.coverCss();
  });

  /** Override explícito de `hero.overlay_opacity` sobre `.ap-cover-veil` (`null` si hereda del token). */
  readonly heroExplicitOverlayCss = computed(() => {
    const h = this.hero();
    return h && h.overlay_opacity !== undefined ? overlayRgba(h.overlay_opacity, 40) : null;
  });

  /**
   * Velo propio de la variante `background` o de `hero.background_image_url`
   * (`data-testid="hero-overlay"`). Hereda `theme.image_overlay` si el bloque
   * no fija `overlay_opacity`, con respaldo de 45 % en `background` y 40 % en
   * el resto.
   */
  readonly heroOverlayCss = computed(() => {
    const h = this.hero();
    if (!h || !this.heroBgCss() || this.heroLegacyCoverVeil()) return null;
    const fallback = h.variant === 'background' ? 45 : 40;
    return overlayRgba(h.overlay_opacity ?? this.themeImageOverlay(), fallback);
  });

  /** Alineación efectiva del texto del hero (`center` por defecto en variante `centered`). */
  readonly heroTextAlign = computed<AppTextAlign | null>(() => {
    const h = this.hero();
    if (!h) return null;
    if (h.align) return h.align;
    return h.variant === 'centered' ? 'center' : null;
  });

  readonly heroContainerClass = computed(() => {
    const h = this.hero();
    const classes: string[] = [];
    if (h?.height === 'compact') classes.push('py-8 md:py-10');
    else if (h?.height === 'full') classes.push('py-16 md:py-24');
    else classes.push('py-12 md:py-16');

    if (h?.variant === 'image_right' || (!h?.variant && !!h?.image_url)) {
      classes.push('md:grid-cols-2');
    } else if (h?.variant === 'centered') {
      classes.push('justify-items-center');
    }
    return classes.join(' ');
  });

  readonly heroCopyClass = computed(() => {
    const h = this.hero();
    const classes: string[] = [this.heroDarkSurface() ? 'text-white' : 'text-text-primary'];
    const align = this.heroTextAlign();
    if (align === 'center') classes.push('text-center mx-auto max-w-3xl');
    else if (align === 'right') classes.push('text-right ml-auto');
    else if (align === 'left') classes.push('text-left');
    if (h?.variant === 'background' && !align) classes.push('max-w-2xl');
    return classes.join(' ');
  });

  private readonly catalog = computed(
    () => new Map(APP_PAGE_TEMPLATES[this.kind()].blocks.map((b) => [b.type, b])),
  );

  /** Enabled, known blocks in page order; existing ones only as preview placeholders. */
  readonly views = computed<{ block: AppPageBlock; placeholder: PlaceholderView | null }[]>(() => {
    const catalog = this.catalog();
    const preview = this.preview();
    const out: { block: AppPageBlock; placeholder: PlaceholderView | null }[] = [];
    const facts = this.facts();
    for (const block of this.page()?.blocks ?? []) {
      const def = catalog.get(block.type);
      if (!block.enabled || !def) continue;
      if (!blockConditionsMet(block.props, facts)) continue;
      // Sin nada que mostrar, el detalle de la estadía no deja un hueco.
      if (block.type === 'stay_detail' && this.stayParts(block).length === 0) continue;
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

  // ---- Apariencia común por bloque ----

  blockBgColor(block: AppPageBlock): string | null {
    return safeColor(blockText(block.props, 'background_color') || undefined);
  }

  blockBgImage(block: AppPageBlock): string | null {
    return cssBgUrl(blockText(block.props, 'background_image_url') || undefined);
  }

  blockHasBackground(block: AppPageBlock): boolean {
    return !!this.blockBgColor(block) || !!this.blockBgImage(block);
  }

  blockOverlayCss(block: AppPageBlock): string {
    return overlayRgba(blockInt(block.props, 'overlay_opacity', 0, 80) ?? this.themeImageOverlay(), 40);
  }

  /**
   * Tono de contraste del fondo de una sección:
   * - `'dark'` si tiene imagen de fondo (con velo oscuro) o un `background_color` oscuro.
   * - `'light'` si tiene un `background_color` claro sin imagen de fondo.
   * - `null` si no personaliza fondo (conserva el contraste heredado de la página).
   */
  blockSurfaceTone(block: AppPageBlock): 'dark' | 'light' | null {
    if (this.blockBgImage(block)) return 'dark';
    const bg = this.blockBgColor(block);
    if (!bg) return null;
    return onColor(bg) === '#ffffff' ? 'dark' : 'light';
  }

  blockSpacing(block: AppPageBlock): AppBlockSpacing | null {
    return blockEnum(block.props, 'spacing', BLOCK_SPACINGS);
  }

  blockAlign(block: AppPageBlock): AppTextAlign | null {
    return blockEnum(block.props, 'align', TEXT_ALIGNS);
  }

  blockAccent(block: AppPageBlock): string | null {
    return safeColor(blockText(block.props, 'accent_color') || undefined);
  }

  // ---- Variantes de galería ----

  galleryExplicitVariant(block: AppPageBlock): AppGalleryVariant | null {
    return blockEnum(block.props, 'variant', GALLERY_VARIANTS);
  }

  galleryVariant(block: AppPageBlock): AppGalleryVariant {
    return this.galleryExplicitVariant(block) ?? 'grid';
  }

  galleryGridColsClass(block: AppPageBlock): string {
    const cols = blockInt(block.props, 'columns', 2, 4);
    if (cols === 2) return 'grid-cols-2';
    if (cols === 4) return 'grid-cols-2 md:grid-cols-4';
    return 'grid-cols-2 md:grid-cols-3';
  }

  galleryCarouselSlideClass(block: AppPageBlock): string {
    const cols = blockInt(block.props, 'columns', 2, 4);
    if (cols === 2) return 'basis-[85%] sm:basis-[calc(50%-0.375rem)]';
    if (cols === 4) return 'basis-[85%] sm:basis-[calc(50%-0.375rem)] md:basis-[calc(25%-0.5625rem)]';
    return 'basis-[85%] sm:basis-[calc(50%-0.375rem)] md:basis-[calc(33.333%-0.5rem)]';
  }

  galleryAspectClass(block: AppPageBlock): string {
    const ratio = blockEnum(block.props, 'aspect_ratio', GALLERY_ASPECTS);
    if (ratio === '4:3') return 'aspect-[4/3]';
    if (ratio === '16:9') return 'aspect-video';
    return 'aspect-square';
  }

  scrollCarousel(track: HTMLElement, direction: -1 | 1): void {
    const step = Math.max(track.clientWidth * 0.8, 240);
    track.scrollBy?.({ left: direction * step, behavior: 'smooth' });
  }

  // ---- Variantes de destacados / beneficios ----

  highlightsExplicitVariant(block: AppPageBlock): AppHighlightsVariant | null {
    return blockEnum(block.props, 'variant', HIGHLIGHTS_VARIANTS);
  }

  // ---- Bloque de productos ----

  productsSelection(block: AppPageBlock) {
    return blockProductsSelection(block.props);
  }

  productsIds(block: AppPageBlock): number[] {
    return blockProductIds(block.props);
  }

  productsShowVariants(block: AppPageBlock): boolean {
    return blockShowVariants(block.props);
  }

  productsLayout(block: AppPageBlock) {
    return blockProductsLayout(block.props);
  }

  highlightsVariant(block: AppPageBlock): AppHighlightsVariant {
    return this.highlightsExplicitVariant(block) ?? 'cards';
  }

  highlightIcon(raw: string | undefined): AppHighlightsIcon | null {
    const key = (raw ?? '').trim();
    return key && HIGHLIGHTS_ICON_SET.has(key) ? (key as AppHighlightsIcon) : null;
  }

  shippingParts(block: AppPageBlock): { label: string; text: string }[] {
    return this.parts(block, [
      ['shipping', 'Envío'],
      ['warranty', 'Garantía'],
      ['returns', 'Devoluciones'],
    ]);
  }

  /** Partes del detalle de la estadía con los datos reales (vacío = el bloque no se pinta). */
  stayParts(block: AppPageBlock): StayDetailPart[] {
    return stayDetailParts(block.props, this.stayFacts());
  }

  stayLayout(block: AppPageBlock): 'card' | 'list' {
    return blockEnum(block.props, 'layout', STAY_LAYOUTS) ?? 'card';
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
