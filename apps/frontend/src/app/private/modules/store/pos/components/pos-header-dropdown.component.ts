import {
  Component,
  input,
  output,
  signal,
  HostListener,
} from '@angular/core';
import { NgClass, DatePipe } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import type { BusinessHours } from '../../../../../core/models/store-settings.interface';
import { CashRegisterSession } from '../services/pos-cash-register.service';
import { PosCustomer } from '../models/customer.model';

@Component({
  selector: 'app-pos-header-dropdown',
  standalone: true,
  imports: [NgClass, DatePipe, IconComponent],
  template: `
    <!-- Stitch paso 11 — chrome desktop del POS: píldora de estado con
         trigger 44px, panel menu con filas-botón 44px, foco 3px primary,
         secundarios en neutral-600 (text-secondary falla AA) y ping con
         motion-reduce. Solo se verifica desktop. -->
    <div class="relative" #dropdownContainer>
      <!-- Status pill trigger -->
      <button
        type="button"
        (click)="toggleDropdown()"
        [attr.aria-expanded]="isOpen()"
        aria-haspopup="menu"
        aria-label="Opciones de venta: cliente, horario y caja"
        class="flex items-center gap-1.5 px-3 min-h-[32px] justify-center rounded-full bg-primary/10 hover:bg-primary/15 border border-primary/25 shadow-2xs active:scale-95 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <!-- Customer avatar -->
        @if (customer()) {
          <div
            aria-hidden="true"
            class="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-primary flex-shrink-0"
          >
            <app-icon name="user" [size]="11"></app-icon>
          </div>
        }

        <!-- Cash register status indicator -->
        @if (cashSession()?.status === 'open') {
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" aria-hidden="true"></span>
          <span class="text-[11px] font-semibold text-primary">Turno Activo</span>
        } @else if (showCashOpenButton()) {
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden="true"></span>
          <span class="text-[11px] font-semibold text-amber-700">Abrir Caja</span>
        } @else {
          <span class="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" aria-hidden="true"></span>
          <span class="text-[11px] font-semibold text-slate-600">Sin Turno</span>
        }

        <!-- Schedule dot -->
        @if (scheduleEnabled()) {
          <span
            aria-hidden="true"
            class="h-1.5 w-1.5 rounded-full flex-shrink-0"
            [ngClass]="isWithinHours() ? 'bg-green-500' : 'bg-red-500'"
          ></span>
        }

        <!-- Chevron -->
        <app-icon
          name="chevron-down"
          [size]="12"
          class="text-primary transition-transform duration-200"
          [ngClass]="{ 'rotate-180': isOpen() }"
        ></app-icon>
      </button>

      <!-- Dropdown panel -->
      @if (isOpen()) {
        <div
          role="menu"
          aria-label="Opciones de venta"
          class="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-surface rounded-[var(--radius-lg)] border border-border shadow-lg z-50 overflow-hidden"
          (click)="$event.stopPropagation()"
        >
          <!-- Customer section -->
          @if (customer()) {
            <div
              class="flex items-center gap-1 p-2 bg-[var(--color-primary-light)] border-b border-border"
            >
              <button
                type="button"
                role="menuitem"
                (click)="customerClicked.emit()"
                class="flex-1 flex items-center gap-2.5 min-h-[44px] p-2 rounded-[var(--radius-md)] text-left hover:bg-surface/70 active:scale-[0.99] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary"
              >
                <div
                  aria-hidden="true"
                  class="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0"
                >
                  <app-icon name="user" [size]="16"></app-icon>
                </div>
                <div class="flex flex-col min-w-0 flex-1">
                  <span
                    class="font-semibold text-text-primary text-sm leading-tight truncate"
                    >{{ customerDisplayName(customer()) }}</span
                  >
                  <span
                    class="text-xs text-neutral-600 leading-tight truncate"
                    >{{ customerContactSubtitle(customer()) }}</span
                  >
                </div>
              </button>
              <button
                type="button"
                (click)="clearCustomer.emit()"
                aria-label="Quitar cliente de la venta"
                title="Quitar cliente"
                class="min-w-[44px] min-h-[44px] rounded-[var(--radius-md)] flex items-center justify-center text-neutral-600 hover:text-red-600 hover:bg-surface/70 active:scale-95 transition-all cursor-pointer flex-shrink-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary"
              >
                <app-icon name="x" [size]="16"></app-icon>
              </button>
            </div>
          }

          <!-- Schedule section -->
          @if (scheduleEnabled()) {
            <button
              type="button"
              role="menuitem"
              (click)="scheduleClicked.emit()"
              class="w-full flex items-center gap-2.5 min-h-[44px] p-3 text-left cursor-pointer hover:bg-surface-secondary active:scale-[0.99] transition-all border-b border-border focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary focus-visible:ring-inset"
            >
              <span
                aria-hidden="true"
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
                  <span class="text-xs text-neutral-600">
                    {{ formatHoursText() }}
                  </span>
                }
              </div>
              <app-icon
                name="clock"
                [size]="16"
                [ngClass]="isWithinHours() ? 'text-green-600' : 'text-red-500'"
              ></app-icon>
            </button>
          }

          <!-- Cash register section -->
          @if (cashSession()?.status === 'open') {
            <div class="p-3 space-y-2.5">
              <div class="flex items-center gap-2">
                <span
                  class="relative flex h-2.5 w-2.5 flex-shrink-0"
                  aria-hidden="true"
                >
                  <span
                    class="motion-reduce:animate-none animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
                  ></span>
                  <span
                    class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"
                  ></span>
                </span>
                <span class="font-semibold text-sm text-green-700">{{
                  cashSession()!.register?.name || 'Caja'
                }}</span>
                <span class="text-neutral-600 text-xs">{{
                  cashSession()!.opened_at | date: 'shortTime'
                }}</span>
              </div>
              <div class="flex items-center gap-1.5" role="group" aria-label="Acciones de caja">
                <button
                  type="button"
                  role="menuitem"
                  (click)="cashDetailClicked.emit()"
                  class="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] px-2 rounded-[var(--radius-md)] bg-green-50 text-green-700 hover:bg-green-100 active:scale-95 transition-all text-[13px] font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary"
                >
                  <app-icon name="receipt" [size]="16"></app-icon>
                  Detalle
                </button>
                <button
                  type="button"
                  role="menuitem"
                  (click)="cashMovementClicked.emit()"
                  aria-label="Registrar movimiento de caja"
                  class="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] px-2 rounded-[var(--radius-md)] bg-blue-50 text-blue-600 hover:bg-blue-100 active:scale-95 transition-all text-[13px] font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary"
                >
                  <app-icon name="wallet" [size]="16"></app-icon>
                  +/−
                </button>
                <button
                  type="button"
                  role="menuitem"
                  (click)="cashCloseClicked.emit()"
                  class="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] px-2 rounded-[var(--radius-md)] bg-red-50 text-red-700 hover:bg-red-100 active:scale-95 transition-all text-[13px] font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary"
                >
                  <app-icon name="lock" [size]="16"></app-icon>
                  Cerrar
                </button>
              </div>
            </div>
          } @else if (showCashOpenButton()) {
            <div class="p-3">
              <button
                type="button"
                role="menuitem"
                (click)="cashOpenClicked.emit()"
                class="flex items-center justify-center gap-2 w-full min-h-[44px] rounded-[var(--radius-md)] bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 active:scale-95 transition-all text-sm font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary"
              >
                <app-icon name="lock" [size]="16"></app-icon>
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
  readonly todayHours = input<BusinessHours | null>(null);
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

  formatHoursText(): string {
    const hours = this.todayHours();
    if (!hours) return '';
    if (hours.blocks && hours.blocks.length > 0) {
      return hours.blocks
        .filter(b => b.open !== 'closed' && b.close !== 'closed')
        .map(b => `${b.open} – ${b.close}`)
        .join(', ');
    }
    return `${hours.open} – ${hours.close}`;
  }

  customerDisplayName(customer: PosCustomer | null | undefined): string {
    if (!customer) return '';
    const full = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
    return (
      customer.name?.trim() ||
      full ||
      (customer as any).legal_name?.trim() ||
      (customer as any).business_name?.trim() ||
      customer.email?.trim() ||
      'Cliente'
    );
  }

  customerContactSubtitle(customer: PosCustomer | null | undefined): string {
    if (!customer) return '';
    const doc = [customer.document_type, customer.document_number].filter(Boolean).join(' ');
    return customer.email || customer.phone || doc || 'Cliente registrado';
  }
}
