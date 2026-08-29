import { Component, ChangeDetectionStrategy, inject, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { HighConversionService } from '../../services/high-conversion.service';

export interface IncentiveProgressData {
  title?: string;
  current_quantity?: number;
  target_quantity?: number;
  remaining_quantity?: number;
  benefit_label?: string;
  target_product_name?: string | null;
  progress_percentage?: number;
  unlocked?: boolean;
}

@Component({
  selector: 'app-gamified-incentive-bar',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as d) {
      @if (highConversionService.enabled()) {
      <div
        class="gamified-bar rounded-xl p-3 border transition-all duration-300 shadow-xs"
        [ngClass]="
          d.unlocked
            ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950 dark:bg-emerald-950/30 dark:border-emerald-700/50 dark:text-emerald-200'
            : 'bg-gradient-to-r from-amber-500/10 via-primary/10 to-primary/5 border-primary/20 text-text-primary'
        "
        data-testid="gamified-incentive-bar"
      >
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0"
              [ngClass]="
                d.unlocked
                  ? 'bg-emerald-500 text-white'
                  : 'bg-primary/20 text-primary'
              "
            >
              @if (d.unlocked) {
                <app-icon name="check" [size]="14"></app-icon>
              } @else {
                <app-icon name="sparkles" [size]="14"></app-icon>
              }
            </span>

            <span class="text-xs font-semibold truncate">
              @if (d.unlocked) {
                ¡Nivel desbloqueado! {{ d.benefit_label }} aplicado.
              } @else if (d.remaining_quantity && d.benefit_label) {
                Agrega
                <strong class="font-bold text-primary dark:text-primary-light">
                  {{ d.remaining_quantity }} {{ d.remaining_quantity === 1 ? 'unidad' : 'unidades' }}
                </strong>
                @if (d.target_product_name) {
                  de <em>{{ d.target_product_name }}</em>
                }
                para ganar <strong class="text-primary dark:text-primary-light">{{ d.benefit_label }}</strong>
              } @else if (d.title) {
                {{ d.title }}
              }
            </span>
          </div>

          <span class="text-[11px] font-bold text-primary shrink-0">
            {{ effectiveProgress() }}%
          </span>
        </div>

        <!-- Animated Progress Track -->
        <div
          class="h-2 w-full rounded-full bg-surface-hover/80 overflow-hidden relative shadow-inner"
          role="progressbar"
          [attr.aria-valuenow]="effectiveProgress()"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full rounded-full transition-all duration-500 ease-out relative"
            [ngClass]="
              d.unlocked
                ? 'bg-emerald-500'
                : 'bg-gradient-to-r from-primary/80 to-primary'
            "
            [style.width.%]="effectiveProgress()"
          >
            <!-- High-conversion sheen animation -->
            @if (!d.unlocked) {
              <div
                class="absolute inset-0 bg-white/25 animate-[shimmer_2s_infinite] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.4)_50%,transparent_100%)]"
              ></div>
            }
          </div>
        </div>
      </div>
      }
    }
  `,
  styles: [
    `
      @keyframes shimmer {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(100%);
        }
      }
    `,
  ],
})
export class GamifiedIncentiveBarComponent {
  readonly data = input<IncentiveProgressData | null>(null);
  protected readonly highConversionService = inject(HighConversionService);

  readonly effectiveProgress = computed(() => {
    const d = this.data();
    if (!d) return 0;
    if (d.unlocked) return 100;
    if (d.progress_percentage !== undefined) {
      return Math.min(100, Math.max(0, Math.round(d.progress_percentage)));
    }
    if (d.current_quantity !== undefined && d.target_quantity && d.target_quantity > 0) {
      return Math.min(
        100,
        Math.max(0, Math.round((d.current_quantity / d.target_quantity) * 100)),
      );
    }
    return 0;
  });
}
