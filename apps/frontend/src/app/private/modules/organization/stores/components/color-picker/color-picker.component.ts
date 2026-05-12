import { Component, input, model, signal, computed, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../shared/components/index';

const COLOR_PRESETS = [
  '#7ED7A5', '#2F6F4E', '#4A90A4', '#F5A623', '#D0021B',
  '#9013FE', '#50E3C2', '#4A90E2', '#F8E71C', '#BD10E0',
  '#417505', '#B8E986', '#9013FE', '#F5A623', '#FF6B6B',
  '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD',
];

@Component({
  selector: 'app-color-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">
      <!-- Presets -->
      <div class="flex flex-wrap gap-2">
        @for (preset of presets; track preset) {
          <button
            type="button"
            (click)="selectPreset(preset)"
            [style.background]="preset"
            [class.ring-2]="currentValue() === preset"
            [class.ring-offset-2]="currentValue() === preset"
            class="w-8 h-8 rounded-full border border-border/30 hover:scale-110 transition-transform cursor-pointer"
            [title]="preset"
          ></button>
        }
      </div>

      <!-- Custom Color Input -->
      <div class="flex items-center gap-3">
        <input
          type="color"
          [value]="currentValue()"
          (input)="onColorInput($event)"
          class="w-12 h-10 border border-border rounded cursor-pointer"
        />
        <div class="relative flex-1">
          <input
            type="text"
            [value]="currentValue()"
            (input)="onHexInput($event)"
            (blur)="validateHex()"
            [class.border-destructive]="!isValidHex()"
            placeholder="#RRGGBB"
            maxlength="7"
            class="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-surface focus:ring-1 focus:ring-primary focus:border-primary uppercase"
          />
          @if (!isValidHex()) {
            <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-destructive">
              Hex inválido
            </span>
          }
        </div>
        <!-- Live Preview Swatch -->
        <div
          class="w-10 h-10 rounded border border-border shrink-0"
          [style.background]="isValidHex() ? currentValue() : '#ccc'"
        ></div>
      </div>

      <!-- Recently Used (session) -->
      @if (recentColors().length > 0) {
        <div>
          <p class="text-xs text-text-secondary mb-1.5">Usados recientemente</p>
          <div class="flex gap-2">
            @for (color of recentColors(); track color) {
              <button
                type="button"
                (click)="selectPreset(color)"
                [style.background]="color"
                class="w-6 h-6 rounded-full border border-border/30 hover:scale-110 transition-transform cursor-pointer"
                [title]="color"
              ></button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    input[type="color"] {
      -webkit-appearance: none;
      border: none;
      background: transparent;
      padding: 0;
    }
    input[type="color"]::-webkit-color-swatch-wrapper {
      padding: 0;
    }
    input[type="color"]::-webkit-color-swatch {
      border: 1px solid var(--color-border);
      border-radius: 4px;
    }
  `],
})
export class ColorPickerComponent {
  readonly value = model<string>('#7ED7A5');
  readonly label = input<string>('');

  readonly presets = COLOR_PRESETS;
  readonly recentColors = signal<string[]>([]);

  private readonly MAX_RECENT = 5;

  currentValue = computed(() => {
    const v = this.value();
    return v && v.startsWith('#') ? v : '#7ED7A5';
  });

  isValidHex(): boolean {
    return /^#[0-9A-Fa-f]{6}$/.test(this.currentValue());
  }

  selectPreset(color: string): void {
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return;
    this.value.set(color.toUpperCase());
    this.addToRecent(color.toUpperCase());
  }

  onColorInput(event: Event): void {
    const color = (event.target as HTMLInputElement).value.toUpperCase();
    this.value.set(color);
    this.addToRecent(color);
  }

  onHexInput(event: Event): void {
    let val = (event.target as HTMLInputElement).value;
    if (!val.startsWith('#')) val = '#' + val;
    this.value.set(val.toUpperCase());
  }

  validateHex(): void {
    if (!this.isValidHex()) {
      // Reset to last valid value
      const valid = /^#[0-9A-Fa-f]{6}$/.test(this.currentValue());
      if (!valid) {
        // Keep the value but flag as invalid
      }
    } else {
      this.addToRecent(this.currentValue());
    }
  }

  private addToRecent(color: string): void {
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return;
    this.recentColors.update((recent) => {
      const filtered = recent.filter((c) => c !== color);
      return [color, ...filtered].slice(0, this.MAX_RECENT);
    });
  }
}
