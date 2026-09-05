import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Portada de impacto visual (Hero).
 * Props: badge?, title, subtitle?, cta_label?, secondary_cta_label?.
 */
@Component({
  selector: 'app-hero-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="hero-container relative overflow-hidden">
      <!-- Decorative background glow -->
      <div class="hero-glow" aria-hidden="true"></div>

      <div class="hero-content relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <!-- Pill Badge -->
        <div class="hero-badge-wrapper inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold shadow-sm mb-6">
          <app-icon name="sparkles" [size]="14" [color]="'var(--crm-primary, #2563eb)'" />
          <span>{{ badgeText() }}</span>
        </div>

        <!-- Headline H1 -->
        <h1 class="hero-title font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
          {{ props()['title'] || 'Bienvenido a nuestra tienda' }}
        </h1>

        <!-- Subheadline -->
        @if (props()['subtitle']) {
          <p class="hero-subtitle text-base sm:text-lg md:text-xl text-slate-600 max-w-3xl mx-auto mb-8 leading-relaxed">
            {{ props()['subtitle'] }}
          </p>
        }

        <!-- Dual CTA Actions -->
        <div class="hero-actions flex flex-col sm:flex-row items-center justify-center gap-3.5 mb-12">
          @if (props()['cta_label']) {
            <button
              type="button"
              class="hero-btn-primary inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full text-white font-semibold shadow-md transition-all duration-200 cursor-pointer"
              (click)="ctaClick.emit()"
            >
              <app-icon name="shopping-bag" [size]="18" color="white" />
              <span>{{ props()['cta_label'] }}</span>
              <app-icon name="arrow-right" [size]="16" color="white" />
            </button>
          }

          <button
            type="button"
            class="hero-btn-secondary inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-white/90 text-slate-700 font-semibold border border-slate-200/90 shadow-xs hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 cursor-pointer"
            (click)="secondaryCtaClick.emit()"
          >
            <app-icon name="headphones" [size]="17" [color]="'var(--crm-primary, #2563eb)'" />
            <span>{{ secondaryCtaLabel() }}</span>
          </button>
        </div>

        <!-- Trust Badges Bar -->
        <div class="hero-trust-bar grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 border-t border-slate-200/60 max-w-3xl mx-auto">
          <div class="trust-item flex items-center justify-center gap-2.5 text-xs sm:text-sm font-medium text-slate-600">
            <div class="trust-icon-box p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <app-icon name="shield-check" [size]="16" color="#059669" />
            </div>
            <span>Garantía & Confianza</span>
          </div>

          <div class="trust-item flex items-center justify-center gap-2.5 text-xs sm:text-sm font-medium text-slate-600">
            <div class="trust-icon-box p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <app-icon name="truck" [size]="16" color="#2563eb" />
            </div>
            <span>Envíos y Retiro Local</span>
          </div>

          <div class="trust-item flex items-center justify-center gap-2.5 text-xs sm:text-sm font-medium text-slate-600">
            <div class="trust-icon-box p-1.5 rounded-lg bg-amber-50 text-amber-600">
              <app-icon name="star" [size]="16" color="#d97706" />
            </div>
            <span>Atención Especializada</span>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .hero-container {
        padding: 56px 16px 44px;
        background: linear-gradient(
          180deg,
          rgba(37, 99, 235, 0.07) 0%,
          rgba(37, 99, 235, 0.02) 60%,
          transparent 100%
        );
      }
      .hero-glow {
        position: absolute;
        top: -120px;
        left: 50%;
        transform: translateX(-50%);
        width: 600px;
        height: 300px;
        background: radial-gradient(
          circle,
          rgba(37, 99, 235, 0.12) 0%,
          transparent 70%
        );
        filter: blur(50px);
        pointer-events: none;
      }
      .hero-badge-wrapper {
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(37, 99, 235, 0.2);
        color: var(--crm-primary, #2563eb);
      }
      .hero-title {
        font-size: clamp(2rem, 4.5vw, 3.25rem);
        letter-spacing: -0.025em;
      }
      .hero-btn-primary {
        background: var(--crm-primary, #2563eb);
      }
      .hero-btn-primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 20px -5px rgba(37, 99, 235, 0.35);
        filter: brightness(1.05);
      }
      .hero-btn-secondary:hover {
        transform: translateY(-1px);
      }
    `,
  ],
})
export class HeroBlockComponent {
  readonly props = input.required<Record<string, string>>();
  readonly ctaClick = output<void>();
  readonly secondaryCtaClick = output<void>();

  readonly badgeText = computed(() => {
    return this.props()['badge'] || '✨ Calidad & Servicio Garantizado';
  });

  readonly secondaryCtaLabel = computed(() => {
    return this.props()['secondary_cta_label'] || 'Contactar un asesor';
  });
}
