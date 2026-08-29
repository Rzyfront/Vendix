import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintFormatDefinition,
  PrintLogoBlock,
} from '../../../../../../../core/models/print-formats.model';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P5.5] — Logo panel.
 *
 * Edits `definition.logo` — URL (S3 key), position, size in mm, opacity
 * in %. S3 upload is intentionally out of scope for this phase — the URL
 * is a text input that accepts an S3 key or any signed URL.
 */
@Component({
  selector: 'app-print-logo-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <section class="vendix-subpanel">
      <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
        Logo
      </h4>

      <div class="space-y-3">
        <!-- URL -->
        <div>
          <label class="block text-[11px] font-medium text-text-secondary mb-1">
            URL o S3 Key
          </label>
          <input
            type="text"
            [ngModel]="logo().url ?? ''"
            (ngModelChange)="updateUrl($event)"
            placeholder="logos/mi-tienda.png"
            class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs font-mono text-text-primary focus:border-primary-500 focus:outline-none"
          />
          <p class="text-[10px] text-text-tertiary mt-1">
            Sube el archivo desde Ajustes → Marca para obtener la key firmada.
          </p>
        </div>

        <!-- Position -->
        <div>
          <label class="block text-[11px] font-medium text-text-secondary mb-1">
            Posición
          </label>
          <div class="grid grid-cols-4 gap-1">
            @for (p of positions; track p) {
              <button
                type="button"
                (click)="updatePosition(p)"
                [class.bg-primary-600]="logo().position === p"
                [class.text-white]="logo().position === p"
                [class.text-text-secondary]="logo().position !== p"
                class="py-1.5 rounded text-xs transition"
              >
                {{ positionLabel(p) }}
              </button>
            }
          </div>
        </div>

        <!-- Size mm -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-[11px] font-medium text-text-secondary">
              Tamaño (mm)
            </label>
            <span class="text-[10px] font-mono text-text-tertiary">
              {{ logo().sizeMm ?? 20 }} mm
            </span>
          </div>
          <input
            type="range"
            min="5"
            max="100"
            step="1"
            [ngModel]="logo().sizeMm ?? 20"
            (ngModelChange)="updateSize($event)"
            class="w-full"
          />
        </div>

        <!-- Opacity -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-[11px] font-medium text-text-secondary">
              Opacidad (%)
            </label>
            <span class="text-[10px] font-mono text-text-tertiary">
              {{ logo().opacity ?? 100 }}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            [ngModel]="logo().opacity ?? 100"
            (ngModelChange)="updateOpacity($event)"
            class="w-full"
          />
        </div>

        <!-- Clear -->
        @if (logo().url) {
          <button
            type="button"
            (click)="clear()"
            class="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-xs text-red-500 bg-surface-secondary hover:bg-red-500/10 border border-border rounded transition"
          >
            <app-icon name="trash-2" [size]="12"></app-icon>
            Quitar logo
          </button>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vendix-subpanel {
        padding: 0.625rem;
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

  readonly positions = ['left', 'center', 'right', 'full'] as const;

  readonly logo = computed<PrintLogoBlock>(() => {
    return this.definition().logo ?? {};
  });

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  positionLabel(p: string): string {
    switch (p) {
      case 'left':
        return 'Izq';
      case 'center':
        return 'Centro';
      case 'right':
        return 'Der';
      case 'full':
        return 'Ancho';
      default:
        return p;
    }
  }

  withLogo(patch: Partial<PrintLogoBlock>): void {
    const next: PrintLogoBlock = { ...this.logo(), ...patch };
    this.emit({ ...this.definition(), logo: next });
  }

  updateUrl(url: string): void {
    this.withLogo({ url: url || undefined });
  }

  updatePosition(position: 'left' | 'center' | 'right' | 'full'): void {
    this.withLogo({ position });
  }

  updateSize(value: number): void {
    const sizeMm = Math.max(5, Math.min(100, Math.round(Number(value) || 20)));
    this.withLogo({ sizeMm });
  }

  updateOpacity(value: number): void {
    const opacity = Math.max(0, Math.min(100, Math.round(Number(value) || 100)));
    this.withLogo({ opacity });
  }

  clear(): void {
    const { logo: _drop, ...rest } = this.definition();
    void _drop;
    this.emit(rest as PrintFormatDefinition);
  }
}