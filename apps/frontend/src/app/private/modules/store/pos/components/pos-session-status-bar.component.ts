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
    @if (session()) {
      <div class="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 bg-green-50 border border-green-200 rounded-xl text-green-700 min-h-[40px]">
        <!-- Pulsing alive indicator -->
        <span class="relative flex h-2.5 w-2.5 flex-shrink-0" aria-hidden="true">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
        </span>

        <!-- Register info -->
        <span class="font-semibold text-sm truncate max-w-[90px] sm:max-w-none">{{ session()!.register?.name || 'Caja' }}</span>
        <span class="text-green-300 hidden sm:inline" aria-hidden="true">&middot;</span>
        <span class="text-green-600/80 text-xs hidden sm:inline whitespace-nowrap">{{ session()!.opened_at | date:'shortTime' }}</span>

        <!-- Action buttons -->
        <div class="flex items-center gap-1 sm:gap-1.5 ml-auto flex-shrink-0">
          <button
            type="button"
            (click)="detailClicked.emit()"
            class="flex items-center justify-center min-w-[36px] min-h-[36px] rounded-lg bg-green-100/80 text-green-700 hover:bg-green-200 active:scale-95 transition-all"
            aria-label="Ver detalle de caja"
            title="Ver detalle"
          >
            <app-icon name="receipt" [size]="16"></app-icon>
          </button>
          <button
            type="button"
            (click)="movementClicked.emit()"
            class="flex items-center justify-center gap-1 min-w-[36px] min-h-[36px] px-2 rounded-lg bg-blue-50 border border-blue-200/60 text-blue-600 hover:bg-blue-100 active:scale-95 transition-all font-semibold text-xs"
            aria-label="Registrar movimiento de caja"
            title="Movimiento de caja"
          >
            <app-icon name="wallet" [size]="16"></app-icon>
            <span class="hidden sm:inline">+/&minus;</span>
          </button>
          <button
            type="button"
            (click)="closeClicked.emit()"
            class="flex items-center justify-center gap-1 min-w-[36px] min-h-[36px] px-2 rounded-lg bg-red-50 border border-red-200/60 text-red-500 hover:bg-red-100 active:scale-95 transition-all font-medium text-xs"
            aria-label="Cerrar caja"
            title="Cerrar caja"
          >
            <app-icon name="lock" [size]="16"></app-icon>
            <span class="hidden sm:inline">Cerrar</span>
          </button>
        </div>
      </div>
    } @else if (showOpenButton()) {
      <button
        type="button"
        (click)="openClicked.emit()"
        class="flex items-center gap-2 px-3 sm:px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm hover:bg-amber-100 active:scale-95 transition-all min-h-[40px]"
        aria-label="Abrir sesion de caja"
      >
        <app-icon name="lock" [size]="16"></app-icon>
        <span class="font-medium hidden sm:inline">Sin caja</span>
        <span class="font-semibold underline decoration-amber-400/60 underline-offset-2">Abrir</span>
      </button>
    }
  `,
})
export class PosSessionStatusBarComponent {
  readonly session = input<CashRegisterSession | null>(null);
  readonly showOpenButton = input<boolean>(true);
  readonly openClicked = output<void>();
  readonly closeClicked = output<void>();
  readonly movementClicked = output<void>();
  readonly detailClicked = output<void>();
}
