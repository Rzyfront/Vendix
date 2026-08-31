import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CrmBlock } from './landing-blocks.types';

/**
 * Portada de la landing. Props: title, subtitle?, cta_label?.
 * El click del CTA se delega al host (editor muestra toast; render público
 * navega al storefront — Fase 4).
 */
@Component({
  selector: 'app-hero-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <h1>{{ props()['title'] || 'Bienvenidos' }}</h1>
      @if (props()['subtitle']) {
        <p class="hero-subtitle">{{ props()['subtitle'] }}</p>
      }
      @if (props()['cta_label']) {
        <button type="button" class="hero-cta" (click)="ctaClick.emit()">
          {{ props()['cta_label'] }}
        </button>
      }
    </section>
  `,
  styles: [
    `
      .hero {
        text-align: center;
        padding: 48px 16px 40px;
        background: linear-gradient(
          180deg,
          rgba(59, 130, 246, 0.08),
          transparent
        );
      }
      h1 {
        font-size: 2rem;
        font-weight: 800;
        margin: 0 0 8px;
        letter-spacing: -0.02em;
      }
      .hero-subtitle {
        color: #4b5563;
        max-width: 560px;
        margin: 0 auto 20px;
        line-height: 1.6;
      }
      .hero-cta {
        border: 0;
        background: var(--crm-primary, #3b82f6);
        color: #fff;
        font-weight: 600;
        padding: 12px 28px;
        border-radius: 999px;
        cursor: pointer;
      }
    `,
  ],
})
export class HeroBlockComponent {
  readonly props = input.required<Record<string, string>>();
  readonly ctaClick = output<void>();
}
