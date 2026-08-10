import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import type { KdsSession, KdsStation } from '../../interfaces';

/**
 * Barra de estado del turno de KDS — QUI-651.
 *
 * Espejo de `pos-session-status-bar`, que es la referencia que el usuario pidió:
 * en el POS la caja te dice en qué caja estás y desde cuándo. En la cocina hacía
 * falta lo mismo — el cocinero abría turno y después no tenía forma de saber en qué
 * estación estaba, quién lo tenía abierto, ni de cerrarlo sin salir del tablero.
 *
 * Muestra la estación, el operador y la hora de apertura; ofrece cerrar y ver el
 * detalle del turno con su consumo.
 *
 * Cuando NO hay turno abierto lo dice explícitamente en vez de desaparecer: un
 * tablero sin barra deja al cocinero sin saber si el turno está abierto o si la
 * barra simplemente no cargó — exactamente la ambigüedad que hay que evitar.
 */
@Component({
  selector: 'app-kds-session-status-bar',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session(); as s) {
      <div class="kds-bar kds-bar--open">
        <span class="kds-bar__group">
          <app-icon name="chef-hat" [size]="14" />
          <strong>{{ s.kds?.name ?? station()?.name ?? 'Estación' }}</strong>
        </span>

        <span class="kds-bar__sep">·</span>

        <!-- El operador es el punto de la sesión: es el responsable del consumo de
             insumos de esta estación, no un dato decorativo. -->
        <span class="kds-bar__group">
          <app-icon name="user" [size]="12" />
          {{ operatorName() }}
        </span>

        <span class="kds-bar__sep">·</span>

        <span class="kds-bar__muted">
          desde {{ s.opened_at | date: 'shortTime' }}
        </span>

        <span class="kds-bar__spacer"></span>

        <button type="button" class="kds-bar__btn" (click)="detailClicked.emit()">
          <app-icon name="receipt" [size]="12" />
          Ver turno
        </button>
        <button
          type="button"
          class="kds-bar__btn kds-bar__btn--danger"
          (click)="closeClicked.emit()"
        >
          <app-icon name="lock" [size]="12" />
          Cerrar turno
        </button>
      </div>
    } @else {
      <div class="kds-bar kds-bar--closed">
        <app-icon name="lock" [size]="14" />
        <span>
          Sin turno abierto
          @if (station(); as st) {
            en <strong>{{ st.name }}</strong>
          }
          — se pedirá al gestionar el primer ticket
        </span>
      </div>
    }
  `,
  styles: [
    `
      .kds-bar {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
        padding: 0.4rem 0.7rem;
        margin: 0 0 0.6rem;
        border-radius: var(--radius-md, 8px);
        font-size: 0.8rem;
        border: 1px solid transparent;
      }

      /* Verde = turno abierto, igual que la caja en el POS: el operador ya conoce
         ese código de color y no hay que enseñarle otro. */
      .kds-bar--open {
        background-color: var(--color-success-100, #dcfce7);
        border-color: var(--color-success, #22c55e);
        color: var(--color-success-700, #15803d);
      }

      .kds-bar--closed {
        background-color: var(--color-surface-alt, #f9fafb);
        border-color: var(--color-border, #e5e7eb);
        color: var(--color-text-secondary);
      }

      .kds-bar__group {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
      }

      .kds-bar__sep {
        opacity: 0.5;
      }

      .kds-bar__muted {
        opacity: 0.85;
      }

      .kds-bar__spacer {
        flex: 1 1 auto;
      }

      .kds-bar__btn {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.15rem 0.5rem;
        border: 1px solid currentColor;
        border-radius: 0.35rem;
        background: transparent;
        color: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
      }

      .kds-bar__btn--danger {
        color: var(--color-error, #ef4444);
      }
    `,
  ],
})
export class KdsSessionStatusBarComponent {
  readonly session = input<KdsSession | null>(null);
  /** Estación seleccionada, para nombrarla incluso sin turno abierto. */
  readonly station = input<KdsStation | null>(null);

  readonly closeClicked = output<void>();
  readonly detailClicked = output<void>();

  operatorName(): string {
    const u = this.session()?.opened_by_user;
    if (!u) return 'operador';
    return `${u.first_name} ${u.last_name}`.trim() || 'operador';
  }
}
