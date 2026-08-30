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
import { AboutBlockComponent } from '../about-block.component';
import { ContactBlockComponent } from '../contact-block.component';
import { FooterCtaBlockComponent } from '../footer-cta-block.component';

/**
 * Registry único de bloques: los MISMOS componentes renderizan la preview
 * del editor (panel) y la landing pública (STORE_LANDING, Fase 4).
 * Agregar un tipo nuevo = componente + @case + campos en CRM_BLOCK_FIELDS.
 */

@Component({
  selector: 'app-block-renderer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HeroBlockComponent,
    FeaturesBlockComponent,
    ProductsGridBlockComponent,
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

  readonly label = computed(() => CRM_BLOCK_LABELS[this.block().type]);
}
