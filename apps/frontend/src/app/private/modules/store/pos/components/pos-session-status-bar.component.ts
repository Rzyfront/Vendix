import {
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CashRegisterSession } from '../services/pos-cash-register.service';

@Component({
  selector: 'app-pos-session-status-bar',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (session) {
      <div class="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs">
        <app-icon name="unlock" [size]="14"></app-icon>
        <span class="font-medium hidden sm:inline">{{ session.register?.name || 'Caja' }}</span>
        <span class="text-green-500 hidden sm:inline">|</span>
        <span class="hidden sm:inline">{{ session.opened_at | date:'shortTime' }}</span>
        <button
          (click)="detailClicked.emit()"
          class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200 transition-colors"
          title="Ver movimientos"
        >
          <app-icon name="receipt" [size]="12"></app-icon>
        </button>
        <button
          (click)="movementClicked.emit()"
          class="px-2 py-0.5 bg-blue-100 text-blue-600 rounded text-xs hover:bg-blue-200 transition-colors"
          title="Registrar movimiento"
        >
          +/-
        </button>
        <button
          (click)="closeClicked.emit()"
          class="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs hover:bg-red-200 transition-colors"
          title="Cerrar caja"
        >
          Cerrar
        </button>
      </div>
    } @else if (showOpenButton) {
      <button
        (click)="openClicked.emit()"
        class="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs hover:bg-amber-100 transition-colors"
      >
        <app-icon name="lock" [size]="14"></app-icon>
        <span class="font-medium">Sin caja abierta</span>
        <span class="underline">Abrir</span>
      </button>
    }
  `,
})
export class PosSessionStatusBarComponent {
  @Input() session: CashRegisterSession | null = null;
  @Input() showOpenButton = true;
  @Output() openClicked = new EventEmitter<void>();
  @Output() closeClicked = new EventEmitter<void>();
  @Output() movementClicked = new EventEmitter<void>();
  @Output() detailClicked = new EventEmitter<void>();
}
