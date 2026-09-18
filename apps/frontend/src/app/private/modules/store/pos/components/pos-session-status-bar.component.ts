import {
  Component,
  input,
  output,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CashRegisterSession } from '../services/pos-cash-register.service';

@Component({
  selector: 'app-pos-session-status-bar',
  standalone: true,
  imports: [DatePipe, IconComponent],
  template: `
    @if (variant() === 'compact') {
      @if (session()?.status === 'open') {
        <div class="sbc-strip">
          <div
            class="sbc-pill"
            [title]="(session()!.register?.name || 'Caja principal') + ' · ' + (session()!.opened_at | date:'shortTime')"
          >
            <span class="sbc-dot" aria-hidden="true"></span>
            <span class="sbc-name">{{ session()!.register?.name || 'Caja principal' }}</span>
            <span class="sbc-time">&middot; {{ session()!.opened_at | date:'shortTime' }}</span>
          </div>
          <div class="sbc-actions">
            <button
              type="button"
              (click)="detailClicked.emit()"
              class="sbc-btn sbc-btn-history"
              aria-label="Historial y arqueo de caja"
              title="Historial y arqueo de caja"
            >
              <app-icon name="receipt" [size]="16"></app-icon>
            </button>
            <button
              type="button"
              (click)="movementClicked.emit()"
              class="sbc-btn sbc-btn-move"
              aria-label="Movimiento de efectivo"
              title="Movimiento de efectivo"
            >
              <span class="sbc-move-prefix" aria-hidden="true">+/-</span>
              <span class="sbc-btn-label">Movimiento</span>
            </button>
            <button
              type="button"
              (click)="closeClicked.emit()"
              class="sbc-btn sbc-btn-close"
              aria-label="Cerrar turno de caja"
              title="Cerrar turno de caja"
            >
              <app-icon name="lock" [size]="14"></app-icon>
              <span>Cerrar</span>
            </button>
          </div>
        </div>
      } @else if (showOpenButton()) {
        <button
          type="button"
          (click)="openClicked.emit()"
          class="sbc-open-btn"
          aria-label="Abrir sesion de caja"
        >
          <app-icon name="lock" [size]="14"></app-icon>
          <span class="sbc-open-btn-idle">Sin caja</span>
          <span class="sbc-open-btn-cta">Abrir</span>
        </button>
      }
    } @else if (session()?.status === 'open') {
      <div class="sb-open">
        <!-- Pulsing alive indicator -->
        <span class="sb-dot" aria-hidden="true">
          <span class="sb-dot-ping"></span>
          <span class="sb-dot-core"></span>
        </span>

        <!-- Register info -->
        <span class="sb-name">{{ session()!.register?.name || 'Caja' }}</span>
        <span class="sb-sep" aria-hidden="true">&middot;</span>
        <span class="sb-time">{{ session()!.opened_at | date:'shortTime' }}</span>

        <!-- Action buttons -->
        <div class="sb-actions">
          <button
            type="button"
            (click)="detailClicked.emit()"
            class="sb-btn sb-btn-detail"
            aria-label="Ver detalle de caja"
            title="Ver detalle"
          >
            <app-icon name="receipt" [size]="16"></app-icon>
          </button>
          <button
            type="button"
            (click)="movementClicked.emit()"
            class="sb-btn sb-btn-move"
            aria-label="Registrar movimiento de caja"
            title="Movimiento de caja"
          >
            <app-icon name="wallet" [size]="16"></app-icon>
            <span class="sb-btn-text">+/&minus;</span>
          </button>
          <button
            type="button"
            (click)="closeClicked.emit()"
            class="sb-btn sb-btn-close"
            aria-label="Cerrar caja"
            title="Cerrar caja"
          >
            <app-icon name="lock" [size]="16"></app-icon>
            <span class="sb-btn-text">Cerrar</span>
          </button>
        </div>
      </div>
    } @else if (showOpenButton()) {
      <button
        type="button"
        (click)="openClicked.emit()"
        class="sb-open-btn"
        aria-label="Abrir sesion de caja"
      >
        <app-icon name="lock" [size]="16"></app-icon>
        <span class="sb-open-btn-idle">Sin caja</span>
        <span class="sb-open-btn-cta">Abrir</span>
      </button>
    }
  `,
  styles: [`
    /* Stitch paso 7 — barra de estado de caja: píldora success sólida con
       acciones de 44px, foco 3px primary y estado sin-caja en warning
       sólido. Solo se verifica desktop (lenguaje pasos 2-6). */
    .sb-open {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      min-height: 44px;
      background: var(--color-success-50);
      border: 1px solid var(--color-success-200);
      border-radius: 12px;
      color: var(--color-success-800);
    }

    .sb-dot {
      position: relative;
      display: flex;
      width: 10px;
      height: 10px;
      flex-shrink: 0;
    }

    .sb-dot-ping {
      position: absolute;
      display: inline-flex;
      width: 100%;
      height: 100%;
      border-radius: 999px;
      background: var(--color-success-500);
      opacity: 0.75;
      animation: sb-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
    }

    .sb-dot-core {
      position: relative;
      display: inline-flex;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--color-success-600);
    }

    @keyframes sb-ping {
      75%, 100% { transform: scale(2); opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .sb-dot-ping { animation: none; }
    }

    .sb-name {
      font-size: 14px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 639px) {
      .sb-name { max-width: 90px; }
    }

    .sb-sep {
      color: var(--color-success-600);
    }

    @media (max-width: 639px) {
      .sb-sep { display: none; }
    }

    .sb-time {
      font-size: 12px;
      font-weight: 500;
      color: var(--color-success-700);
      white-space: nowrap;
    }

    @media (max-width: 639px) {
      .sb-time { display: none; }
    }

    .sb-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      flex-shrink: 0;
    }

    .sb-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-width: 44px;
      min-height: 44px;
      padding: 0 8px;
      border-radius: 12px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.15s ease;
    }

    .sb-btn:active {
      transform: scale(0.95);
    }

    .sb-btn:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
    }

    .sb-btn-detail {
      background: var(--color-success-100);
      color: var(--color-success-800);
    }

    .sb-btn-detail:hover {
      background: var(--color-success-200);
    }

    .sb-btn-move {
      background: var(--color-info-50);
      border-color: var(--color-info-200);
      color: var(--color-info-700);
      font-size: 12px;
      font-weight: 600;
    }

    .sb-btn-move:hover {
      background: var(--color-info-100);
    }

    .sb-btn-close {
      background: var(--color-error-50);
      border-color: var(--color-error-200);
      color: var(--color-error-700);
      font-size: 12px;
      font-weight: 500;
    }

    .sb-btn-close:hover {
      background: var(--color-error-100);
    }

    .sb-btn-text {
      white-space: nowrap;
    }

    @media (max-width: 639px) {
      .sb-btn-text { display: none; }
    }

    .sb-open-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      min-height: 44px;
      background: var(--color-warning-50);
      border: 1px solid var(--color-warning-200);
      border-radius: 12px;
      color: var(--color-warning-800);
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.15s ease;
    }

    .sb-open-btn:hover {
      background: var(--color-warning-100);
    }

    .sb-open-btn:active {
      transform: scale(0.95);
    }

    .sb-open-btn:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
    }

    .sb-open-btn-idle {
      font-weight: 500;
    }

    @media (max-width: 639px) {
      .sb-open-btn-idle { display: none; }
    }

    .sb-open-btn-cta {
      font-weight: 600;
      text-decoration: underline;
      text-decoration-color: var(--color-warning-500);
      text-underline-offset: 2px;
    }

    /* PSVERSION0001 paso 4 — variante compacta: tira de caja Stitch sobre
       el ticket (d25526af: pildora blanca + dot verde, botones Historial,
       Movimiento +/-, Cerrar). Misma data, mismos outputs: sync cero. */
    .sbc-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      padding: 6px 8px;
      background: var(--color-muted, #f8fafc);
      border-bottom: 1px solid var(--color-border);
    }

    .sbc-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      min-height: 36px;
      min-width: 0;
      flex: 1 1 0%;
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      box-shadow: var(--shadow-2xs, 0 1px 2px rgb(0 0 0 / 0.05));
    }

    .sbc-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--color-success-500);
      box-shadow: 0 0 0 2px var(--color-success-100);
      flex-shrink: 0;
    }

    .sbc-name {
      font-size: 12px;
      font-weight: 700;
      color: var(--color-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1 1 auto;
      min-width: 0;
    }

    .sbc-time {
      font-size: 11px;
      font-weight: 500;
      color: var(--color-neutral-600, #5c6672);
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* PSVERSION0001 paso 7b F1 — la tira compacta (~323px) no da para
       nombre + hora + 3 botones con texto: el nombre colapsaba a ancho 0.
       La palabra "Movimiento" se colapsa visualmente (queda "+/-" +
       title/aria intactos); sigue en DOM/AT porque no es display:none. */
    .sbc-btn-label {
      max-width: 0;
      overflow: hidden;
      white-space: nowrap;
    }

    .sbc-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .sbc-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 32px;
      padding: 4px 6px;
      border-radius: 8px;
      border: 1px solid var(--color-border);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: var(--shadow-2xs, 0 1px 2px rgb(0 0 0 / 0.05));
      transition: background-color 0.2s ease, transform 0.15s ease;
    }

    .sbc-btn:active {
      transform: scale(0.95);
    }

    .sbc-btn:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
    }

    .sbc-btn-history {
      background: var(--color-surface, #ffffff);
      color: var(--color-success-700);
      border-color: var(--color-success-200);
    }

    .sbc-btn-history:hover {
      background: var(--color-success-50);
    }

    .sbc-btn-move {
      background: var(--color-surface, #ffffff);
      color: var(--color-text-primary);
    }

    .sbc-btn-move:hover {
      background: var(--color-muted, #f1f5f9);
    }

    .sbc-move-prefix {
      color: var(--color-success-600);
      font-weight: 700;
      line-height: 1;
    }

    .sbc-btn-close {
      background: var(--color-error-50);
      border-color: var(--color-error-200);
      color: var(--color-error-700);
    }

    .sbc-btn-close:hover {
      background: var(--color-error-100);
    }

    .sbc-open-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 12px;
      min-height: 44px;
      background: var(--color-warning-50);
      border-bottom: 1px solid var(--color-warning-200);
      color: var(--color-warning-800);
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }

    .sbc-open-btn:hover {
      background: var(--color-warning-100);
    }

    .sbc-open-btn:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: -3px;
    }

    .sbc-open-btn-idle {
      font-weight: 500;
    }

    .sbc-open-btn-cta {
      font-weight: 600;
      text-decoration: underline;
      text-decoration-color: var(--color-warning-500);
      text-underline-offset: 2px;
    }
  `],
})
export class PosSessionStatusBarComponent {
  readonly session = input<CashRegisterSession | null>(null);
  readonly showOpenButton = input<boolean>(true);
  readonly variant = input<'default' | 'compact'>('default');
  readonly openClicked = output<void>();
  readonly closeClicked = output<void>();
  readonly movementClicked = output<void>();
  readonly detailClicked = output<void>();
}
