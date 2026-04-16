import { Component, input, output } from '@angular/core';
import { NgStyle } from '@angular/common';

import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [NgStyle, ButtonComponent, IconComponent],
  template: `
    <div
      class="empty-state-container"
      [class.empty-state--sm]="size() === 'sm'"
      [class.empty-state--xsm]="size() === 'xsm'"
    >
      <div class="empty-state-icon" [ngStyle]="iconBgStyle">
        <app-icon
          [name]="icon()"
          [size]="size() === 'xsm' ? 24 : size() === 'sm' ? 32 : 48"
          class="empty-state-icon-svg"
          [ngStyle]="iconColorStyle"
        ></app-icon>
      </div>

      <h3 class="empty-state-title">{{ title() }}</h3>

      @if (description()) {
        <p class="empty-state-description">{{ description() }}</p>
      }

      @if (showActionButton() || showRefreshButton() || showClearFilters()) {
        <div class="empty-state-actions">
          @if (showActionButton() && actionButtonText()) {
            <app-button
              variant="primary"
              size="sm"
              (clicked)="actionClick.emit()"
            >
              @if (actionButtonIcon()) {
                <app-icon
                  [name]="actionButtonIcon()"
                  [size]="16"
                  slot="icon"
                ></app-icon>
              }
              {{ actionButtonText() }}
            </app-button>
          }
          @if (showRefreshButton()) {
            <app-button
              variant="outline"
              size="sm"
              (clicked)="refreshClick.emit()"
            >
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Actualizar
            </app-button>
          }
          @if (showClearFilters()) {
            <app-button
              variant="outline"
              size="sm"
              (clicked)="clearFiltersClick.emit()"
            >
              <app-icon name="x" [size]="16" slot="icon"></app-icon>
              Limpiar Filtros
            </app-button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        height: 100%;
      }

      .empty-state-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        padding: 3rem 1rem;
        text-align: center;
      }

      .empty-state-icon {
        width: 6rem;
        height: 6rem;
        border-radius: 50%;
        background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 1.5rem;
      }

      .empty-state-icon-svg {
        color: #9ca3af;
      }

      .empty-state-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
        margin-bottom: 0.5rem;
      }

      .empty-state-description {
        color: var(--color-text-secondary, #6b7280);
        max-width: 28rem;
        margin-bottom: 1.5rem;
        line-height: 1.5;
      }

      .empty-state-actions {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: center;

        @media (min-width: 640px) {
          flex-direction: row;
        }
      }

      /* Size: sm */
      .empty-state--sm {
        padding: 1.5rem 1rem;
      }

      .empty-state--sm .empty-state-icon {
        width: 3.5rem;
        height: 3.5rem;
        margin-bottom: 0.75rem;
      }

      .empty-state--sm .empty-state-title {
        font-size: 0.875rem;
        margin-bottom: 0.25rem;
      }

      .empty-state--sm .empty-state-description {
        font-size: 0.75rem;
        margin-bottom: 1rem;
      }

      /* Size: xsm */
      .empty-state--xsm {
        padding: 1rem 0.75rem;
      }

      .empty-state--xsm .empty-state-icon {
        width: 2.5rem;
        height: 2.5rem;
        margin-bottom: 0.5rem;
      }

      .empty-state--xsm .empty-state-title {
        font-size: 0.75rem;
        margin-bottom: 0.125rem;
      }

      .empty-state--xsm .empty-state-description {
        font-size: 0.625rem;
        margin-bottom: 0.75rem;
      }
    `,
  ],
})
export class EmptyStateComponent {
  readonly size = input<'default' | 'sm' | 'xsm'>('default');
  readonly icon = input('inbox');
  readonly iconColor = input<
    'default' | 'success' | 'warning' | 'error' | 'primary'
  >('default');
  readonly title = input('No hay datos');
  readonly description = input('No se encontraron registros.');
  readonly actionButtonText = input('Crear Nuevo');
  readonly actionButtonIcon = input<string>('');
  readonly showActionButton = input(true);
  readonly showRefreshButton = input(false);
  readonly showClearFilters = input(false);

  readonly actionClick = output<void>();
  readonly refreshClick = output<void>();
  readonly clearFiltersClick = output<void>();

  private colorMap: Record<string, { bg: string; fg: string }> = {
    default: {
      bg: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
      fg: '#9ca3af',
    },
    success: {
      bg: 'var(--color-success-light, rgba(34, 197, 94, 0.1))',
      fg: 'var(--color-success, #22c55e)',
    },
    warning: {
      bg: 'var(--color-warning-light, rgba(234, 179, 8, 0.1))',
      fg: 'var(--color-warning, #eab308)',
    },
    error: {
      bg: 'var(--color-error-light, rgba(239, 68, 68, 0.1))',
      fg: 'var(--color-error, #ef4444)',
    },
    primary: {
      bg: 'var(--color-primary-light, rgba(99, 102, 241, 0.1))',
      fg: 'var(--color-primary, #6366f1)',
    },
  };

  get iconBgStyle(): Record<string, string> {
    const iconColor = this.iconColor();
    if (iconColor === 'default') return {};
    return { background: this.colorMap[iconColor].bg };
  }

  get iconColorStyle(): Record<string, string> {
    const iconColor = this.iconColor();
    if (iconColor === 'default') return {};
    return { color: this.colorMap[iconColor].fg };
  }
}
