import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintFormatDefinition,
  PrintLogoBlock,
} from '../../../../../../../core/models/print-formats.model';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-print-logo-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <section class="vendix-subpanel space-y-3">
      <div class="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Logo del Documento
          </h4>
          <span class="text-[10px] text-text-tertiary">
            Personaliza el encabezado gráfico
          </span>
        </div>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-500 font-mono">
          Header
        </span>
      </div>

      <!-- Store Logo Detection Banner -->
      <div class="p-2.5 rounded-lg bg-surface-secondary border border-border flex items-start gap-2.5">
        <app-icon name="image" [size]="16" class="text-primary-500 shrink-0 mt-0.5"></app-icon>
        <div class="text-xs space-y-1">
          <span class="font-semibold text-text-primary block">Logo de la Tienda</span>
          <p class="text-[11px] text-text-secondary leading-relaxed">
            Por defecto, el documento imprime automáticamente el logo configurado en los ajustes de tu tienda. Puedes sobreescribirlo aquí con una URL específica si lo deseas.
          </p>
        </div>
      </div>

      <!-- Custom URL Override -->
      <div>
        <label class="block text-[11px] font-medium text-text-secondary mb-1">
          URL Personalizada (Opcional)
        </label>
        <input
          type="text"
          [ngModel]="logo().url ?? ''"
          (ngModelChange)="updateUrl($event)"
          placeholder="Dejar vacío para usar el logo de la tienda"
          class="w-full px-2.5 py-1.5 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none placeholder:text-text-tertiary"
        />
      </div>

      <!-- Position -->
      <div>
        <label class="block text-[11px] font-medium text-text-secondary mb-1">
          Alineación del Logo
        </label>
        <div class="grid grid-cols-4 gap-1">
          @for (p of positions; track p.value) {
            <button
              type="button"
              (click)="updatePosition(p.value)"
              [class.bg-primary-500]="(logo().position || 'left') === p.value"
              [class.text-white]="(logo().position || 'left') === p.value"
              [class.bg-surface-secondary]="(logo().position || 'left') !== p.value"
              [class.text-text-secondary]="(logo().position || 'left') !== p.value"
              class="py-1.5 text-xs font-medium rounded border border-border hover:bg-surface-hover transition flex items-center justify-center gap-1 cursor-pointer"
            >
              <app-icon [name]="p.icon" [size]="12"></app-icon>
              <span>{{ p.label }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Size mm -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-[11px] font-medium text-text-secondary">
            Tamaño Máximo (mm)
          </label>
          <span class="text-[10px] font-mono text-primary-500 font-bold">
            {{ logo().size_mm ?? 20 }} mm
          </span>
        </div>
        <input
          type="range"
          min="5"
          max="80"
          step="1"
          [ngModel]="logo().size_mm ?? 20"
          (ngModelChange)="updateSize($event)"
          class="w-full accent-primary-500 cursor-pointer"
        />
        <div class="flex justify-between text-[9px] text-text-tertiary font-mono">
          <span>5mm (Icono)</span>
          <span>20mm (Estándar)</span>
          <span>80mm (Banner)</span>
        </div>
      </div>

      <!-- Opacity -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-[11px] font-medium text-text-secondary">
            Opacidad de Impresión
          </label>
          <span class="text-[10px] font-mono text-text-tertiary">
            {{ logo().opacity ?? 100 }}%
          </span>
        </div>
        <input
          type="range"
          min="10"
          max="100"
          step="5"
          [ngModel]="logo().opacity ?? 100"
          (ngModelChange)="updateOpacity($event)"
          class="w-full accent-primary-500 cursor-pointer"
        />
      </div>

      <!-- Clear override -->
      @if (logo().url) {
        <button
          type="button"
          (click)="clearCustomUrl()"
          class="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-red-500 bg-surface-secondary hover:bg-red-500/10 border border-border rounded transition cursor-pointer"
        >
          <app-icon name="rotate-ccw" [size]="12"></app-icon>
          Restablecer al logo por defecto de la tienda
        </button>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vendix-subpanel {
        padding: 0.75rem;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--color-surface, #ffffff);
      }
    `,
  ],
})
export class PrintLogoPanelComponent {
  readonly definition = input.required<PrintFormatDefinition>();
  readonly definitionChanged = output<PrintFormatDefinition>();

  readonly positions: Array<{ value: 'left' | 'center' | 'right' | 'full'; label: string; icon: string }> = [
    { value: 'left', label: 'Izq', icon: 'align-left' },
    { value: 'center', label: 'Centro', icon: 'align-center' },
    { value: 'right', label: 'Der', icon: 'align-right' },
    { value: 'full', label: 'Ancho', icon: 'maximize' },
  ];

  readonly logo = computed<PrintLogoBlock>(() => {
    return this.definition().logo ?? {};
  });

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  withLogo(patch: Partial<PrintLogoBlock>): void {
    const next: PrintLogoBlock = { ...this.logo(), ...patch };
    this.emit({ ...this.definition(), logo: next });
  }

  updateUrl(url: string): void {
    this.withLogo({ url: url.trim() || undefined });
  }

  updatePosition(position: 'left' | 'center' | 'right' | 'full'): void {
    this.withLogo({ position });
  }

  updateSize(value: number): void {
    const size_mm = Math.max(5, Math.min(80, Math.round(Number(value) || 20)));
    this.withLogo({ size_mm });
  }

  updateOpacity(value: number): void {
    const opacity = Math.max(10, Math.min(100, Math.round(Number(value) || 100)));
    this.withLogo({ opacity });
  }

  clearCustomUrl(): void {
    this.withLogo({ url: undefined });
  }
}