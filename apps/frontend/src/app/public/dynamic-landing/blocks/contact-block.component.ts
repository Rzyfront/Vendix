import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Encabezado de la sección de contacto.
 * Props: title?, description?.
 */
@Component({
  selector: 'app-contact-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="contact-header-section max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 pb-6 text-center">
      <div class="contact-badge inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold mb-3">
        <app-icon name="mail" [size]="13" [color]="'var(--crm-primary, #2563eb)'" />
        <span>Estamos para ayudarte</span>
      </div>

      <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
        {{ props()['title'] || 'Visítanos o contáctanos' }}
      </h2>

      @if (props()['description']) {
        <p class="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto mb-6 leading-relaxed">
          {{ props()['description'] }}
        </p>
      }
    </section>
  `,
  styles: [
    `
      .contact-badge {
        background: rgba(37, 99, 235, 0.08);
        color: var(--crm-primary, #2563eb);
      }
    `,
  ],
})
export class ContactBlockComponent {
  readonly props = input.required<Record<string, string>>();
  readonly ctaClick = output<void>();
}
