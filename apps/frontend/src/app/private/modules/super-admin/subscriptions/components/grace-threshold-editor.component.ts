import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-grace-threshold-editor',
  standalone: true,
  imports: [FormsModule, InputComponent],
  template: `
    <div class="space-y-4">
      <div class="rounded-lg border border-border bg-background p-3 space-y-1">
        <p class="text-sm font-medium text-text-primary">Gracia suave</p>
        <p class="text-sm text-text-secondary">
          Durante estos dias despues del vencimiento, la tienda puede seguir operando con avisos
          de pago. Al terminar, las reglas de gracia dura y suspension toman control.
        </p>
      </div>

      <div class="flex items-center gap-4">
        <app-input
          type="number"
          label="Dias de gracia suave"
          [(ngModel)]="days"
          (ngModelChange)="emitChange()"
          [min]="0"
          [max]="90"
        ></app-input>
      </div>

      <div class="flex flex-wrap gap-2">
        @for (preset of presets; track preset) {
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-lg border border-border bg-surface hover:bg-gray-50 transition-colors"
            [class.bg-primary\/10]="days() === preset"
            [class.border-primary]="days() === preset"
            [class.text-primary]="days() === preset"
            (click)="setDays(preset)"
          >
            {{ preset }} dias
          </button>
        }
      </div>

      <p class="text-sm text-text-secondary">
        Las suscripciones entran en gracia suave por <strong>{{ days() }}</strong> dias despues
        de terminar el ciclo de cobro. Usa cero si el plan debe pasar directo a la siguiente etapa.
      </p>
    </div>
  `,
})
export class GraceThresholdEditorComponent {
  readonly days = signal(7);
  readonly valueChange = output<number>();

  readonly initialValue = input<number | undefined>(undefined);
  readonly presets = [3, 7, 14, 30];
  private readonly userTouched = signal(false);

  constructor() {
    effect(() => {
      const initial = this.initialValue();
      const touched = untracked(() => this.userTouched());
      if (initial !== undefined && !touched) {
        this.days.set(initial);
      }
    });
  }

  setDays(value: number): void {
    this.userTouched.set(true);
    this.days.set(value);
    this.emitChange();
  }

  emitChange(): void {
    this.userTouched.set(true);
    this.valueChange.emit(this.days());
  }
}
