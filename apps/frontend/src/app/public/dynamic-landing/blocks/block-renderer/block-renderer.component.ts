import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  CRM_BLOCK_LABELS,
  CrmBlock,
} from '../landing-blocks.types';
import { HeroBlockComponent } from '../hero-block.component';
import { FeaturesBlockComponent } from '../features-block.component';
import { ProductsGridBlockComponent } from '../products-grid-block.component';
import { GalleryBlockComponent } from '../gallery-block.component';
import { TestimonialsBlockComponent } from '../testimonials-block.component';
import { FaqBlockComponent } from '../faq-block.component';
import { LocationBlockComponent } from '../location-block.component';
import { PromoBlockComponent } from '../promo-block.component';
import { AboutBlockComponent } from '../about-block.component';
import { ContactBlockComponent } from '../contact-block.component';
import { FooterCtaBlockComponent } from '../footer-cta-block.component';

/**
 * Registry único de bloques: los MISMOS componentes renderizan la preview
 * del editor (panel) y la landing pública (STORE_LANDING).
 */
@Component({
  selector: 'app-block-renderer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HeroBlockComponent,
    FeaturesBlockComponent,
    ProductsGridBlockComponent,
    GalleryBlockComponent,
    TestimonialsBlockComponent,
    FaqBlockComponent,
    LocationBlockComponent,
    PromoBlockComponent,
    AboutBlockComponent,
    ContactBlockComponent,
    FooterCtaBlockComponent,
  ],
  template: `
    @switch (block().type) {
      @case ('hero') {
        <app-hero-block
          [props]="block().props"
          (ctaClick)="ctaClick.emit()"
          (secondaryCtaClick)="secondaryCtaClick.emit()"
        />
      }
      @case ('features') {
        <app-features-block [props]="block().props" />
      }
      @case ('products_grid') {
        <app-products-grid-block
          [props]="block().props"
          [baseUrl]="baseUrl()"
        />
      }
      @case ('store_gallery') {
        <app-gallery-block [props]="block().props" />
      }
      @case ('testimonials') {
        <app-testimonials-block [props]="block().props" />
      }
      @case ('faq') {
        <app-faq-block [props]="block().props" />
      }
      @case ('location_hours') {
        <app-location-block [props]="block().props" />
      }
      @case ('promo_banner') {
        <app-promo-block
          [props]="block().props"
          (ctaClick)="ctaClick.emit()"
        />
      }
      @case ('about') {
        <app-about-block [props]="block().props" />
      }
      @case ('contact') {
        <app-contact-block
          [props]="block().props"
          (ctaClick)="ctaClick.emit()"
        />
      }
      @case ('footer_cta') {
        <app-footer-cta-block
          [props]="block().props"
          (ctaClick)="ctaClick.emit()"
        />
      }
    }
  `,
})
export class BlockRendererComponent {
  readonly block = input.required<CrmBlock>();
  /** Base del ecommerce para deep-links de productos (opcional). */
  readonly baseUrl = input<string | null>(null);
  readonly ctaClick = output<void>();
  readonly secondaryCtaClick = output<void>();

  readonly label = computed(() => CRM_BLOCK_LABELS[this.block().type] || this.block().type);
}
