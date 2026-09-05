import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Banner Promocional con urgencia y oferta especial.
 * Props: badge?, title?, subtitle?, cta_label?.
 */
@Component({
  selector: 'app-promo-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="promo-container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <div class="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 p-8 sm:p-12 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div class="relative z-10 max-w-2xl text-center md:text-left">
          <div class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold bg-white/20 text-white backdrop-blur-xs mb-4 border border-white/30">
            <app-icon name="tag" [size]="13" color="white" />
            <span>{{ props()['badge'] || '⚡ Oferta Especial del Mes' }}</span>
          </div>

          <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight mb-3 leading-tight">
            {{ props()['title'] || '¡Aprovecha descuentos exclusivos de temporada!' }}
          </h2>

          @if (props()['subtitle']) {
            <p class="text-white/90 text-sm sm:text-base leading-relaxed max-w-xl">
              {{ props()['subtitle'] }}
            </p>
          }
        </div>

        <div class="relative z-10 flex-shrink-0">
          <button
            type="button"
            class="px-8 py-4 rounded-full bg-white text-slate-900 font-extrabold text-sm sm:text-base shadow-2xl hover:scale-105 hover:bg-slate-50 transition-all duration-200 cursor-pointer flex items-center gap-2"
            (click)="ctaClick.emit()"
          >
            <span>{{ props()['cta_label'] || 'Ver Ofertas Ahora' }}</span>
            <app-icon name="arrow-right" [size]="16" color="#0f172a" />
          </button>
        </div>
      </div>
    </section>
  `,
})
export class PromoBlockComponent {
  readonly props = input.required<Record<string, string>>();
  readonly ctaClick = output<void>();
}
