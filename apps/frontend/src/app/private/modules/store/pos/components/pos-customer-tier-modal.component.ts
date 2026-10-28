import { Component, computed, effect, input, output, signal } from '@angular/core';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../shared/components';
import { CustomerTierPrompt } from '../utils/customer-tier-prompt.util';

/**
 * Pregunta si aplicar la tarifa preferencial del cliente (o restaurar el
 * precio regular al quitarlo) en todas las líneas ofrecidas o solo en las
 * elegidas. Cancelar no cambia nada. Spec: odd/tasks/price-tier-adjustments-customers.md S6.
 */
@Component({
  selector: 'app-pos-customer-tier-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="prompt() !== null"
      (isOpenChange)="!$event && dismissed.emit()"
      (cancel)="dismissed.emit()"
      [size]="'md'"
      [showCloseButton]="true"
      [title]="title()"
      [subtitle]="subtitle()"
      [dialog]="true"
    >
      <div
        slot="header"
        class="w-10 h-10 rounded-[var(--radius-lg)] bg-primary/10 flex items-center justify-center flex-shrink-0"
      >
        <app-icon name="tag" [size]="20" class="text-primary"></app-icon>
      </div>

      <ul class="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        @for (line of prompt()?.lines ?? []; track line.itemId) {
          <li>
            <label class="flex items-center gap-3 px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                class="h-4 w-4"
                [checked]="selected().has(line.itemId)"
                (change)="toggle(line.itemId)"
              />
              <span class="text-sm text-text-primary">{{ line.label }}</span>
            </label>
          </li>
        }
      </ul>

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        <app-button variant="secondary" size="md" (clicked)="dismissed.emit()">
          {{ isApply() ? 'No aplicar' : 'Mantener precios' }}
        </app-button>
        <app-button
          variant="outline"
          size="md"
          [disabled]="selected().size === 0"
          (clicked)="confirmed.emit(selectedIds())"
        >
          {{ isApply() ? 'Aplicar a seleccionadas' : 'Restaurar seleccionadas' }}
          ({{ selected().size }})
        </app-button>
        <app-button variant="primary" size="md" (clicked)="confirmed.emit(allIds())">
          {{ isApply() ? 'Aplicar a todas' : 'Restaurar todas' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PosCustomerTierModalComponent {
  readonly prompt = input<CustomerTierPrompt | null>(null);
  /** Ids de las líneas a las que se aplica (o restaura) la tarifa. */
  readonly confirmed = output<string[]>();
  readonly dismissed = output<void>();

  readonly selected = signal<ReadonlySet<string>>(new Set());

  readonly isApply = computed(() => this.prompt()?.mode !== 'restore');
  readonly allIds = computed(() =>
    (this.prompt()?.lines ?? []).map((line) => line.itemId),
  );
  readonly selectedIds = computed(() =>
    this.allIds().filter((id) => this.selected().has(id)),
  );
  readonly title = computed(() => {
    const name = this.prompt()?.tier.name ?? '';
    return this.isApply()
      ? `Este cliente tiene la tarifa ${name}`
      : `El cliente anterior tenía la tarifa ${name}`;
  });
  readonly subtitle = computed(() =>
    this.isApply()
      ? '¿A qué productos se la aplicas?'
      : '¿Restauras el precio regular de estos productos?',
  );

  constructor() {
    // Cada aviso nuevo arranca con todas las líneas marcadas.
    effect(() => this.selected.set(new Set(this.allIds())));
  }

  toggle(itemId: string): void {
    const next = new Set(this.selected());
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    this.selected.set(next);
  }
}
