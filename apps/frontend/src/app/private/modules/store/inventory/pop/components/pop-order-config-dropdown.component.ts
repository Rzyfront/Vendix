import {
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/**
 * `pop-order-config-dropdown`
 *
 * Variante responsive (móvil/tablet < xl) del resumen de configuración de la
 * orden de compra. Sin configurar muestra un botón "Configurar compra"; una vez
 * configurada muestra una píldora que despliega el detalle (proveedor, bodega,
 * fechas, envío) con un botón editar. Réplica del patrón `pos-header-dropdown`,
 * pero con cierre por click-fuera robusto vía `ElementRef` (el POS lee un
 * `#ref` sin `@ViewChild`, por eso su cierre queda inerte).
 */
@Component({
  selector: 'app-pop-order-config-dropdown',
  standalone: true,
  imports: [NgClass, IconComponent],
  template: `
    @if (isConfigured()) {
      <div class="relative w-full">
        <!-- Pill trigger -->
        <button
          type="button"
          (click)="toggle()"
          class="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 active:scale-[0.99] transition-all min-h-[44px]"
        >
          <app-icon name="truck" [size]="15" class="text-primary flex-shrink-0"></app-icon>
          <span class="text-sm font-semibold text-text-primary truncate">
            {{ supplierName() || 'Proveedor' }}
          </span>
          <span class="text-border" aria-hidden="true">&middot;</span>
          <span class="text-xs font-medium text-text-secondary truncate">
            {{ locationName() || 'Bodega' }}
          </span>
          <app-icon
            name="chevron-down"
            [size]="16"
            class="text-text-secondary ml-auto flex-shrink-0 transition-transform duration-200"
            [ngClass]="{ 'rotate-180': isOpen() }"
          ></app-icon>
        </button>

        <!-- Detail panel -->
        @if (isOpen()) {
          <div
            class="absolute left-0 right-0 top-full mt-2 bg-surface rounded-xl border border-border shadow-lg z-50 overflow-hidden"
            (click)="$event.stopPropagation()"
          >
            <div class="p-3 space-y-2.5">
              <div class="flex items-center gap-2">
                <app-icon name="truck" [size]="15" class="text-primary flex-shrink-0"></app-icon>
                <span class="text-xs text-text-secondary">Proveedor:</span>
                <span class="text-sm font-medium text-text-primary truncate ml-auto">
                  {{ supplierName() || '—' }}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <app-icon name="warehouse" [size]="15" class="text-emerald-600 flex-shrink-0"></app-icon>
                <span class="text-xs text-text-secondary">Bodega:</span>
                <span class="text-sm font-medium text-text-primary truncate ml-auto">
                  {{ locationName() || '—' }}
                </span>
              </div>
              @if (orderDateLabel()) {
                <div class="flex items-center gap-2">
                  <app-icon name="calendar" [size]="15" class="text-text-secondary flex-shrink-0"></app-icon>
                  <span class="text-xs text-text-secondary">Fecha orden:</span>
                  <span class="text-sm font-medium text-text-primary ml-auto">
                    {{ orderDateLabel() }}
                  </span>
                </div>
              }
              @if (expectedDateLabel()) {
                <div class="flex items-center gap-2">
                  <app-icon name="calendar" [size]="15" class="text-amber-600 flex-shrink-0"></app-icon>
                  <span class="text-xs text-text-secondary">Fecha entrega:</span>
                  <span class="text-sm font-medium text-text-primary ml-auto">
                    {{ expectedDateLabel() }}
                  </span>
                </div>
              }
              @if (shippingLabel()) {
                <div class="flex items-center gap-2">
                  <app-icon name="package" [size]="15" class="text-text-secondary flex-shrink-0"></app-icon>
                  <span class="text-xs text-text-secondary">Envío:</span>
                  <span class="text-sm font-medium text-text-primary ml-auto">
                    {{ shippingLabel() }}
                  </span>
                </div>
              }
            </div>
            <div class="p-2 border-t border-border">
              <button
                type="button"
                (click)="onEdit()"
                class="flex items-center justify-center gap-1.5 w-full min-h-[38px] rounded-lg bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all text-sm font-semibold"
              >
                <app-icon name="pencil" [size]="15"></app-icon>
                Editar configuración
              </button>
            </div>
          </div>
        }
      </div>
    } @else {
      <button
        type="button"
        (click)="edit.emit()"
        class="flex items-center gap-2 w-full px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm hover:bg-amber-100 active:scale-95 transition-all min-h-[44px] justify-center"
        aria-label="Configurar orden de compra"
      >
        <app-icon name="settings" [size]="16"></app-icon>
        <span class="font-medium">Sin configurar</span>
        <span class="font-semibold underline decoration-amber-400/60 underline-offset-2">
          Configurar compra
        </span>
      </button>
    }
  `,
})
export class PopOrderConfigDropdownComponent {
  private elementRef = inject(ElementRef);

  readonly isConfigured = input<boolean>(false);
  readonly supplierName = input('');
  readonly locationName = input('');
  readonly orderDateLabel = input('');
  readonly expectedDateLabel = input('');
  readonly shippingLabel = input('');
  readonly edit = output<void>();

  readonly isOpen = signal(false);

  toggle(): void {
    this.isOpen.update((v) => !v);
  }

  onEdit(): void {
    this.isOpen.set(false);
    this.edit.emit();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.elementRef.nativeElement.contains(target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }
}
