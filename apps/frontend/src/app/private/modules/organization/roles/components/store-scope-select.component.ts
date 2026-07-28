import { Component, input, model, output } from '@angular/core';

/** Mínimo que este selector necesita de una tienda de la organización. */
export interface StoreScopeOption {
  id: number;
  name: string;
}

/**
 * QUI-72 — selector de la TIENDA de un alcance.
 *
 * Se usa en tres sitios con la misma semántica: "sin tienda" NO es un valor
 * vacío accidental, significa alcance ORGANIZACIÓN (`store_id = NULL`). Por eso
 * la opción vacía lleva etiqueta explícita en vez de un placeholder.
 */
@Component({
  selector: 'app-store-scope-select',
  standalone: true,
  template: `
    @if (label()) {
      <label
        class="block text-sm font-medium text-[var(--color-text-primary)] mb-1"
        [attr.for]="selectId"
      >
        {{ label() }}
      </label>
    }

    <select
      [id]="selectId"
      class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md
             bg-[var(--color-surface)] text-[var(--color-text-primary)] text-sm
             focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]
             focus:border-[var(--color-primary)] disabled:opacity-60"
      [disabled]="disabled()"
      [value]="value() === null ? '' : String(value())"
      (change)="onSelect($event)"
    >
      <option value="">{{ emptyLabel() }}</option>
      @for (store of stores(); track store.id) {
        <option [value]="String(store.id)">{{ store.name }}</option>
      }
    </select>

    @if (helpText()) {
      <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
        {{ helpText() }}
      </p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StoreScopeSelectComponent {
  readonly stores = input<StoreScopeOption[]>([]);
  readonly label = input<string>('');
  readonly emptyLabel = input<string>('Toda la organización');
  readonly helpText = input<string>('');
  readonly disabled = input<boolean>(false);

  readonly value = model<number | null>(null);
  readonly storeSelected = output<number | null>();

  readonly selectId = `store-scope-select-${Math.random().toString(36).slice(2, 10)}`;

  readonly String = String;

  onSelect(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const next = raw === '' ? null : Number(raw);
    this.value.set(next);
    this.storeSelected.emit(next);
  }
}
