import {
  Component,
  input,
  output,
  signal,
  HostListener,
} from '@angular/core';
import { NgClass, DatePipe } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CashRegisterSession } from '../services/pos-cash-register.service';
import { PosCustomer } from '../models/customer.model';

@Component({
  selector: 'app-pos-header-dropdown',
  standalone: true,
  imports: [NgClass, DatePipe, IconComponent],
  template: `
    <div class="relative" #dropdownContainer>
      <!-- Compact pill trigger -->
      <button
        type="button"
        (click)="toggleDropdown()"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface border border-border hover:bg-surface/80 active:scale-95 transition-all min-h-[36px] cursor-pointer"
      >
        <!-- Customer avatar -->
        @if (customer()) {
          <div
            class="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary flex-shrink-0"
          >
            <app-icon name="user" [size]="12"></app-icon>
          </div>
        }

        <!-- Schedule dot -->
        @if (scheduleEnabled()) {
          <span
            class="h-2 w-2 rounded-full flex-shrink-0"
            [ngClass]="isWithinHours() ? 'bg-green-500' : 'bg-red-500'"
          ></span>
        }

        <!-- Cash register dot -->
        @if (cashSession()) {
          <span class="relative flex h-2 w-2 flex-shrink-0">
            <span
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
            ></span>
            <span
              class="relative inline-flex rounded-full h-2 w-2 bg-green-500"
            ></span>
          </span>
        } @else if (showCashOpenButton()) {
          <span class="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0"></span>
        }

        <!-- Chevron -->
        <app-icon
          name="chevron-down"
          [size]="14"
          class="text-text-secondary transition-transform duration-200"
          [ngClass]="{ 'rotate-180': isOpen() }"
        ></app-icon>
      </button>

      <!-- Dropdown panel -->
      @if (isOpen()) {
        <div
          class="absolute right-0 top-full mt-2 w-72 bg-surface rounded-xl border border-border shadow-lg z-50 overflow-hidden"
          (click)="$event.stopPropagation()"
        >
          <!-- Customer section -->
          @if (customer()) {
            <div
              class="flex items-center gap-2.5 p-3 bg-gradient-to-r from-primary-light/50 to-primary-light/30 border-b border-border cursor-pointer hover:from-primary-light/70 hover:to-primary-light/50 transition-all"
              (click)="customerClicked.emit()"
            >
              <div
                class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary flex-shrink-0"
              >
                <app-icon name="user" [size]="16"></app-icon>
              </div>
              <div class="flex flex-col min-w-0 flex-1">
                <span
                  class="font-semibold text-text-primary text-sm leading-tight truncate"
                  >{{ customer()!.name }}</span
                >
                <span
                  class="text-xs text-text-secondary leading-tight truncate"
                  >{{ customer()!.email }}</span
                >
              </div>
              <div
                class="w-6 h-6 rounded-full hover:bg-surface/60 flex items-center justify-center transition-colors flex-shrink-0"
                (click)="clearCustomer.emit()"
              >
                <app-icon
                  name="x"
                  [size]="14"
                  class="text-text-secondary hover:text-destructive transition-colors"
                ></app-icon>
              </div>
            </div>
          }

          <!-- Schedule section -->
          @if (scheduleEnabled()) {
            <div
              class="flex items-center gap-2 p-3 cursor-pointer hover:bg-surface/60 transition-all border-b border-border"
              (click)="scheduleClicked.emit()"
            >
              <span
                class="h-2.5 w-2.5 rounded-full flex-shrink-0"
                [ngClass]="isWithinHours() ? 'bg-green-500' : 'bg-red-500'"
              ></span>
              <div class="flex flex-col min-w-0 flex-1">
                <span
                  class="text-sm font-semibold"
                  [ngClass]="isWithinHours() ? 'text-green-700' : 'text-red-600'"
                >
                  {{
                    isWithinHours()
                      ? 'En servicio'
                      : isDayClosed()
                        ? 'Cerrado hoy'
                        : 'Fuera de servicio'
                  }}
                </span>
                @if (!isDayClosed() && todayHours()) {
                  <span
                    class="text-xs"
                    [ngClass]="
                      isWithinHours() ? 'text-green-600/70' : 'text-red-500/70'
                    "
                  >
                    {{ todayHours()!.open }} – {{ todayHours()!.close }}
                  </span>
                }
              </div>
              <app-icon
                name="clock"
                [size]="14"
                [ngClass]="isWithinHours() ? 'text-green-500' : 'text-red-400'"
              ></app-icon>
            </div>
          }

          <!-- Cash register section -->
          @if (cashSession()) {
            <div class="p-3 space-y-2">
              <div class="flex items-center gap-2">
                <span class="relative flex h-2.5 w-2.5 flex-shrink-0">
                  <span
                    class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
                  ></span>
                  <span
                    class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"
                  ></span>
                </span>
                <span class="font-semibold text-sm text-green-700">{{
                  cashSession()!.register?.name || 'Caja'
                }}</span>
                <span class="text-green-600/80 text-xs">{{
                  cashSession()!.opened_at | date: 'shortTime'
                }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  (click)="cashDetailClicked.emit()"
                  class="flex-1 flex items-center justify-center gap-1.5 min-h-[34px] rounded-lg bg-green-50 text-green-700 hover:bg-green-100 active:scale-95 transition-all text-xs font-medium"
                >
                  <app-icon name="receipt" [size]="14"></app-icon>
                  Detalle
                </button>
                <button
                  type="button"
                  (click)="cashMovementClicked.emit()"
                  class="flex-1 flex items-center justify-center gap-1.5 min-h-[34px] rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 active:scale-95 transition-all text-xs font-medium"
                >
                  <app-icon name="wallet" [size]="14"></app-icon>
                  +/−
                </button>
                <button
                  type="button"
                  (click)="cashCloseClicked.emit()"
                  class="flex-1 flex items-center justify-center gap-1.5 min-h-[34px] rounded-lg bg-red-50 text-red-500 hover:bg-red-100 active:scale-95 transition-all text-xs font-medium"
                >
                  <app-icon name="lock" [size]="14"></app-icon>
                  Cerrar
                </button>
              </div>
            </div>
          } @else if (showCashOpenButton()) {
            <div class="p-3">
              <button
                type="button"
                (click)="cashOpenClicked.emit()"
                class="flex items-center justify-center gap-2 w-full min-h-[34px] rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 active:scale-95 transition-all text-sm font-medium"
              >
                <app-icon name="lock" [size]="14"></app-icon>
                Abrir caja
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PosHeaderDropdownComponent {
  readonly customer = input<PosCustomer | null>(null);
  readonly scheduleEnabled = input<boolean>(false);
  readonly isWithinHours = input<boolean>(false);
  readonly isDayClosed = input<boolean>(false);
  readonly todayHours = input<{ open: string; close: string } | null>(null);
  readonly cashSession = input<CashRegisterSession | null>(null);
  readonly showCashOpenButton = input<boolean>(false);

  readonly customerClicked = output<void>();
  readonly clearCustomer = output<void>();
  readonly scheduleClicked = output<void>();
  readonly cashOpenClicked = output<void>();
  readonly cashCloseClicked = output<void>();
  readonly cashMovementClicked = output<void>();
  readonly cashDetailClicked = output<void>();

  isOpen = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const container = (this as any).dropdownContainer?.nativeElement;
    if (container && target && !container.contains(target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.isOpen.set(false);
  }

  toggleDropdown(): void {
    this.isOpen.update(v => !v);
  }
}
