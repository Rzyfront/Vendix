import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CrmBlock } from './landing-blocks.types';

/**
 * Contacto. Props: title?, description?.
 * El formulario público (creación de cliente + notificación) se conecta en
 * la Fase 4; el CTA se delega al host igual que hero/footer_cta.
 */
@Component({
  selector: 'app-contact-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="contact">
      @if (props()['title']) {
        <h2>{{ props()['title'] }}</h2>
      }
      @if (props()['description']) {
        <p class="contact-description">{{ props()['description'] }}</p>
      }
      <button type="button" class="contact-cta" (click)="ctaClick.emit()">
        Quiero que me contacten
      </button>
    </section>
  `,
  styles: [
    `
      .contact {
        text-align: center;
        padding: 36px 16px;
        background: rgba(59, 130, 246, 0.06);
      }
      h2 {
        font-size: 1.4rem;
        margin: 0 0 8px;
      }
      .contact-description {
        color: #4b5563;
        max-width: 520px;
        margin: 0 auto 18px;
        line-height: 1.6;
      }
      .contact-cta {
        border: 0;
        background: var(--crm-primary, #3b82f6);
        color: #fff;
        font-weight: 600;
        padding: 12px 26px;
        border-radius: 999px;
        cursor: pointer;
      }
    `,
  ],
})
export class ContactBlockComponent {
  readonly props = input.required<Record<string, string>>();
  readonly ctaClick = output<void>();
}
