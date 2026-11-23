import { Component, input, output } from '@angular/core';

import { HistoryAgentFilter } from './agent-history.service';

/** Segmented agent filter shared by both history lists. */
@Component({
  selector: 'app-history-agent-filter',
  standalone: true,
  template: `
    <div
      class="inline-flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-1"
      role="group"
      [attr.aria-label]="label()"
    >
      @for (option of options; track option.value) {
        <button
          type="button"
          [attr.aria-pressed]="value() === option.value"
          (click)="changed.emit(option.value)"
          class="rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          [class.bg-surface]="value() === option.value"
          [class.shadow-sm]="value() === option.value"
          [class.text-[var(--color-text-primary)]]="value() === option.value"
          [class.text-[var(--color-text-secondary)]]="value() !== option.value"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class HistoryAgentFilterComponent {
  readonly value = input<HistoryAgentFilter>('all');
  readonly label = input('Filtrar por agente');
  readonly changed = output<HistoryAgentFilter>();

  readonly options: ReadonlyArray<{ value: HistoryAgentFilter; label: string }> =
    [
      { value: 'all', label: 'Todos' },
      { value: 'vex', label: 'Vex' },
      { value: 'vexi', label: 'Vexi' },
    ];
}
