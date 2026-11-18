import { Component, computed, input, output } from '@angular/core';

import { AiJobErrorCategory } from '../../../core/utils/ai-job-error';
import { AiJobProgress } from '../../utils/ai-job-progress';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons.registry';

const ERROR_LOOK: Readonly<
  Record<AiJobErrorCategory, { icon: IconName; container: string; icon_cls: string }>
> = {
  document: {
    icon: 'alert-triangle',
    container: 'border-warning/30 bg-warning-light',
    icon_cls: 'text-warning',
  },
  stalled: {
    icon: 'hourglass',
    container: 'border-warning/30 bg-warning-light',
    icon_cls: 'text-warning',
  },
  technical: {
    icon: 'alert-circle',
    container: 'border-error/30 bg-error-light',
    icon_cls: 'text-error',
  },
  ai_unavailable: {
    icon: 'zap-off',
    container: 'border-error/30 bg-error-light',
    icon_cls: 'text-error',
  },
};

/**
 * Shared progress bar of every AI process (QUI-1020): phase, percentage,
 * elapsed time, «Sigue procesando…» past the estimate, a notice when the
 * server flags the job as stuck, and the failure explained by category
 * (document / Vendix / AI service) with an optional retry.
 *
 * The state lives in an {@link AiJobProgress} the host creates; this
 * component only renders it.
 */
@Component({
  selector: 'app-ai-job-progress',
  standalone: true,
  imports: [IconComponent, ButtonComponent],
  host: { class: 'block' },
  template: `
    @let p = progress();
    @if (p.visible()) {
      @if (p.error(); as err) {
        <div
          class="rounded-xl border p-3 flex gap-3 items-start"
          [class]="errorLook().container"
          role="alert"
          data-testid="ai-job-error"
          [attr.data-category]="err.category"
        >
          <span class="shrink-0 mt-0.5" [class]="errorLook().icon_cls">
            <app-icon [name]="errorLook().icon" [size]="20" />
          </span>
          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-sm font-semibold text-text-primary">{{ err.title }}</p>
            <p class="text-sm text-text-secondary">{{ err.message }}</p>
            @if (showRetry()) {
              <div class="pt-1">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="retry.emit()"
                >
                  <app-icon slot="icon" name="refresh-cw" [size]="14" />
                  {{ retryLabel() }}
                </app-button>
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="space-y-1.5" data-testid="ai-job-progress">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="min-w-0 truncate font-medium text-text-primary">
              {{ p.label() }}
              @if (p.stepLabel(); as step) {
                <span class="font-normal text-text-secondary">· {{ step }}</span>
              }
            </span>
            <span class="shrink-0 tabular-nums text-text-secondary">
              {{ p.percent() }} % · {{ p.elapsedLabel() }}
            </span>
          </div>
          <div
            class="h-2 w-full overflow-hidden rounded-full bg-surface-hover"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="p.percent()"
            [attr.aria-valuetext]="p.label() + ', ' + p.percent() + ' %'"
          >
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              [style.width.%]="p.percent()"
            ></div>
          </div>
          @if (p.stalled()) {
            <p class="text-xs text-warning" data-testid="ai-job-stalled">
              Está tardando más de lo normal. Ya avisamos al equipo de Vendix;
              puedes esperar o volver más tarde, el trabajo sigue en curso.
            </p>
          } @else if (p.overtime()) {
            <p class="text-xs text-text-secondary">
              Tarda más de lo habitual.
              @if (p.resumable()) {
                <span data-testid="ai-job-resumable">
                  Puedes cerrar esta ventana: al volver retomamos el estado
                  real.
                </span>
              }
            </p>
          } @else if (hint()) {
            <p class="text-xs text-text-secondary">{{ hint() }}</p>
          }
          @if (p.resumable() && !p.overtime() && !p.stalled()) {
            <p
              class="text-xs text-text-secondary"
              data-testid="ai-job-resumable"
            >
              Puedes cerrar esta ventana: al volver retomamos el estado real.
            </p>
          }
        </div>
      }
    }
  `,
})
export class AiJobProgressComponent {
  readonly progress = input.required<AiJobProgress>();
  /** Small helper text under the bar while it runs normally. */
  readonly hint = input<string | null>(null);
  readonly showRetry = input(false);
  readonly retryLabel = input('Intentar de nuevo');
  readonly retry = output<void>();

  protected readonly errorLook = computed(() => {
    const category = this.progress().error()?.category ?? 'technical';
    return ERROR_LOOK[category];
  });
}
