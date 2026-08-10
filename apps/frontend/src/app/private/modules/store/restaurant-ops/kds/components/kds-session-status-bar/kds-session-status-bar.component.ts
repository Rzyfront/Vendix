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

        <!--
          En pantalla completa el sticky header está oculto, y con él el botón por
          el que se entró. Sin esta salida el cocinero quedaría dependiendo del Esc
          del navegador, que no está escrito en ninguna parte de la pantalla.
        -->
        @if (canExitFullscreen()) {
          <button
            type="button"
            class="kds-bar__btn kds-bar__btn--icon"
            title="Salir de pantalla completa"
            aria-label="Salir de pantalla completa"
            (click)="exitFullscreenClicked.emit()"
          >
            <app-icon name="minimize" [size]="12" />
          </button>
        }
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

        <!--
          La salida va TAMBIÉN en esta rama: sin turno abierto y a pantalla completa
          no habría ningún control visible para volver, y eso es dejar al operador
          encerrado.
        -->
        @if (canExitFullscreen()) {
          <span class="kds-bar__spacer"></span>
          <button
            type="button"
            class="kds-bar__btn kds-bar__btn--icon"
            title="Salir de pantalla completa"
            aria-label="Salir de pantalla completa"
            (click)="exitFullscreenClicked.emit()"
          >
            <app-icon name="minimize" [size]="12" />
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      .kds-bar {
        /* Alto comun de los botones de la barra. Vive aqui, en el contenedor, para
           que los botones NO deriven su alto del contenido: uno con texto lo saca
           del line-height (19.2px) y uno de solo icono lo saca del icono (12px), y
           quedaban desalineados 7px en la misma fila. */
        --kds-bar-btn-h: 1.625rem;

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
        justify-content: center;
        gap: 0.25rem;
        /* Alto explicito y padding solo horizontal: asi el alto es el mismo lleve
           texto o no, y el padding vertical no puede volver a introducir la
           diferencia. */
        height: var(--kds-bar-btn-h);
        padding: 0 0.5rem;
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

      /* Solo icono: es un control de VISTA, no una acción del turno, y en una
         pantalla de cocina compite por el mismo espacio que los tickets. Cuadrado
         con el mismo lado que el alto de la fila, para que no quede ni mas bajo ni
         mas angosto de lo que su area de clic necesita. */
      .kds-bar__btn--icon {
        width: var(--kds-bar-btn-h);
        padding: 0;
      }
    `,
  ],
})
export class KdsSessionStatusBarComponent {
  readonly session = input<KdsSession | null>(null);
  /** Estación seleccionada, para nombrarla incluso sin turno abierto. */
  readonly station = input<KdsStation | null>(null);
  /**
   * ¿El tablero está a pantalla completa? En ese modo el sticky header no se
   * dibuja, así que esta barra pasa a ser el único sitio desde donde volver.
   */
  readonly canExitFullscreen = input(false);

  readonly closeClicked = output<void>();
  readonly detailClicked = output<void>();
  readonly exitFullscreenClicked = output<void>();

  operatorName(): string {
    const u = this.session()?.opened_by_user;
    if (!u) return 'operador';
    return `${u.first_name} ${u.last_name}`.trim() || 'operador';
  }
}
