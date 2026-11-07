import { Component, computed, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent, SelectorComponent } from '../../../../../../shared/components/index';

interface VariableGroup {
  title: string;
  items: Array<{ path: string; label: string }>;
}

const GROUPS: VariableGroup[] = [
  {
    title: 'Solicitud',
    items: [
      { path: 'instance.reference', label: 'Referencia' },
      { path: 'instance.title', label: 'Título' },
      { path: 'instance.created_at', label: 'Fecha de creación' },
      { path: 'instance.current_stage', label: 'Etapa actual' },
    ],
  },
  {
    title: 'Tienda',
    items: [
      { path: 'store.name', label: 'Nombre' },
      { path: 'store.nit', label: 'NIT' },
      { path: 'store.address', label: 'Dirección' },
      { path: 'store.phone', label: 'Teléfono' },
    ],
  },
  {
    title: 'Quien emite',
    items: [
      { path: 'user.name', label: 'Nombre' },
      { path: 'user.email', label: 'Correo' },
    ],
  },
  { title: 'Fecha de emisión', items: [{ path: 'now', label: 'Hoy' }] },
  {
    title: 'Sujeto de la solicitud',
    items: [
      { path: 'subject.type', label: 'Tipo' },
      { path: 'subject.id', label: 'Identificador' },
    ],
  },
];

/** Filter applied to the next variable inserted (`{{ ruta | filtro }}`). */
const FILTERS = [
  { value: '', label: 'Sin formato' },
  { value: 'money', label: 'Dinero ($2.500.000)' },
  { value: 'words', label: 'Número en letras' },
  { value: 'number', label: 'Número (2.500.000)' },
  { value: 'date', label: 'Fecha corta (07/11/2026)' },
  { value: "date:'largo'", label: 'Fecha larga (7 de noviembre de 2026)' },
  { value: 'upper', label: 'MAYÚSCULAS' },
  { value: 'lower', label: 'minúsculas' },
  { value: "default:'—'", label: 'Con «—» si falta' },
];

/** Side panel of the editors: click a variable to insert it where the cursor is. */
@Component({
  selector: 'app-template-variables-panel',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="variables-panel">
      <p class="text-xs text-text-secondary">
        Haz clic en el texto donde la quieres y luego en la variable. Se reemplaza por el dato real al emitir.
      </p>
      <app-selector
        label="Formato"
        [options]="filters"
        [value]="filter()"
        (valueChange)="onFilter($event)"
      />
      <div class="flex flex-col gap-1">
        <app-input
          label="Dato del formulario del flujo"
          placeholder="salario"
          helperText="La clave del campo en el flujo"
          [ngModel]="fieldKey()"
          (ngModelChange)="fieldKey.set($event ?? '')"
        />
        <button
          type="button"
          class="self-start rounded-lg border border-border px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
          [disabled]="!validFieldKey()"
          (mousedown)="$event.preventDefault()"
          (click)="insertField()"
        >
          {{ insertLabel() }}
        </button>
      </div>
      @for (group of groups; track group.title) {
        <div>
          <h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">{{ group.title }}</h4>
          <div class="flex flex-wrap gap-1">
            @for (item of group.items; track item.path) {
              <button
                type="button"
                class="rounded-full border border-border px-2 py-1 text-xs text-text-primary hover:border-primary hover:text-primary"
                [title]="item.path"
                (mousedown)="$event.preventDefault()"
                (click)="insert.emit(token(item.path))"
              >
                {{ item.label }}
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class TemplateVariablesPanelComponent {
  /** Text to insert at the cursor, e.g. `{{ fields.salario | money }}`. */
  readonly insert = output<string>();

  readonly groups = GROUPS;
  readonly filters = FILTERS;
  readonly filter = signal('');
  readonly fieldKey = signal('');
  readonly validFieldKey = computed(() => /^[a-z][a-z0-9_]{0,63}$/.test(this.fieldKey().trim()));

  readonly insertLabel = computed(() =>
    this.validFieldKey() ? 'Insertar {{ fields.' + this.fieldKey().trim() + ' }}' : 'Insertar dato del formulario',
  );

  onFilter(value: string | number | null): void {
    this.filter.set(value === null ? '' : String(value));
  }

  token(path: string): string {
    const filter = this.filter();
    return `{{ ${path}${filter ? ` | ${filter}` : ''} }}`;
  }

  insertField(): void {
    if (this.validFieldKey()) this.insert.emit(this.token(`fields.${this.fieldKey().trim()}`));
  }
}
