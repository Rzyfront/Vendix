import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Llamado a la acción final de alta conversión.
 * Props: title?, subtitle?, cta_label?.
 */
@Component({
  selector: 'app-footer-cta-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="footer-cta-container relative overflow-hidden bg-slate-900 text-white py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
      <!-- Glow background decoration -->
      <div class="footer-cta-glow" aria-hidden="true"></div>

      <div class="relative z-10 max-w-4xl mx-auto text-center">
        <div class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/90 border border-white/20 mb-6 backdrop-blur-xs">
          <app-icon name="sparkles" [size]="13" color="#facc15" />
          <span>Atención Inmediata</span>
        </div>

        <h2 class="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-5 leading-tight">
          {{ props()['title'] || 'Equípate con lo mejor' }}
        </h2>

        @if (props()['subtitle']) {
          <p class="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            {{ props()['subtitle'] }}
          </p>
        }

        @if (props()['cta_label']) {
          <div class="flex items-center justify-center">
            <button
              type="button"
              class="footer-cta-btn inline-flex items-center gap-2.5 px-8 py-4 rounded-full bg-white text-slate-900 font-bold text-base shadow-xl hover:bg-slate-100 hover:scale-105 transition-all duration-200 cursor-pointer"
              (click)="ctaClick.emit()"
            >
              <span>{{ props()['cta_label'] }}</span>
              <app-icon name="arrow-right" [size]="18" color="#0f172a" />
            </button>
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .footer-cta-container {
        background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
      }
      .footer-cta-glow {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 600px;
        height: 300px;
        background: radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, transparent 70%);
        filter: blur(60px);
        pointer-events: none;
      }
      .footer-cta-btn:hover {
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      }
    `,
  ],
})
export class FooterCtaBlockComponent {
  readonly props = input.required<Record<string, string>>();
  readonly ctaClick = output<void>();
}
