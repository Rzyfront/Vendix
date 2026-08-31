import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CrmBlock } from './landing-blocks.types';

/** Llamado final. Props: title?, subtitle?, cta_label?. */
@Component({
  selector: 'app-footer-cta-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="footer-cta">
      @if (props()['title']) {
        <h2>{{ props()['title'] }}</h2>
      }
      @if (props()['subtitle']) {
        <p class="footer-cta-subtitle">{{ props()['subtitle'] }}</p>
      }
      @if (props()['cta_label']) {
        <button type="button" class="footer-cta-button" (click)="ctaClick.emit()">
          {{ props()['cta_label'] }}
        </button>
      }
    </section>
  `,
  styles: [
    `
      .footer-cta {
        text-align: center;
        padding: 44px 16px;
        background: var(--crm-secondary, #111827);
        color: #fff;
      }
      h2 {
        font-size: 1.5rem;
        margin: 0 0 8px;
      }
      .footer-cta-subtitle {
        color: rgba(255, 255, 255, 0.75);
        margin: 0 0 18px;
      }
      .footer-cta-button {
        border: 0;
        background: #fff;
        color: #111827;
        font-weight: 700;
        padding: 12px 28px;
        border-radius: 999px;
        cursor: pointer;
      }
    `,
  ],
})
export class FooterCtaBlockComponent {
  readonly props = input.required<Record<string, string>>();
  readonly ctaClick = output<void>();
}
