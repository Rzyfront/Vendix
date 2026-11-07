import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
} from '../../../../../../../shared/components/index';
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_LIMITS,
  WorkflowActionInputSpec,
  WorkflowActionMapValue,
  WorkflowFieldDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowSecretsApiService } from '../../../secrets/workflow-secrets-api.service';
import { actionTokenOptions } from '../../workflow-editor-triggers.utils';
import { HttpActionTestComponent } from './http-action-test.component';
import {
  HttpTextKey,
  OutputRow,
  appendToken,
  isValidOutputPath,
  outputFields,
  toOutputRecord,
  toOutputRows,
} from './http-action.utils';

const NONE = '__none__';

/** Editor of the `vendix.http.request` action: request, secrets, response mapping and test. */
@Component({
  selector: 'app-http-action-editor',
  standalone: true,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    HttpActionTestComponent,
  ],
  template: `
    <div class="flex flex-col gap-3" data-testid="http-action">
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
        <app-selector
          size="sm"
          label="Método *"
          [options]="methodOptions"
          [value]="method()"
          (valueChange)="setMethod($event)"
        />
        <app-input
          size="sm"
          label="URL *"
          placeholder="https://api.tu-crm.com/clientes"
          helperText="Pública (http o https). Las direcciones privadas se bloquean."
          [ngModel]="text('url')"
          (ngModelChange)="setText('url', $event)"
        />
      </div>
      <ng-container *ngTemplateOutlet="inserts; context: { key: 'url' }" />

      <app-textarea
        label="Encabezados"
        [rows]="3"
        placeholder="Authorization: Bearer {{ '{{secrets.CRM_TOKEN}}' }}"
        helperText="Uno por línea, con el formato Nombre: valor."
        [ngModel]="text('headers')"
        (ngModelChange)="setText('headers', $event)"
      />
      <ng-container *ngTemplateOutlet="inserts; context: { key: 'headers' }" />

      <app-textarea
        label="Cuerpo"
        [rows]="5"
        [readonly]="method() === 'GET'"
        [helperText]="method() === 'GET' ? 'Una llamada GET no lleva cuerpo.' : 'Texto o JSON. Si es JSON se envía como application/json.'"
        [ngModel]="text('body')"
        (ngModelChange)="setText('body', $event)"
      />
      @if (method() !== 'GET') {
        <ng-container *ngTemplateOutlet="inserts; context: { key: 'body' }" />
      }

      <app-input
        size="sm"
        type="number"
        label="Tiempo máximo (segundos)"
        min="1"
        [max]="maxTimeout"
        [helperText]="'De 1 a ' + maxTimeout + '. Si no pones nada, son 10 segundos.'"
        [ngModel]="timeout()"
        (ngModelChange)="setTimeoutSeconds($event)"
      />

      <div class="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="http-output">
        <div>
          <p class="text-xs font-semibold text-text-primary">Guardar la respuesta en campos</p>
          <p class="text-xs text-text-secondary">
            Rutas: <span class="font-mono">status</span>, <span class="font-mono">body</span>,
            <span class="font-mono">body.id</span>, <span class="font-mono">body.items.0.name</span>,
            <span class="font-mono">headers.x-request-id</span>.
          </p>
        </div>
        @for (row of rows(); track $index; let i = $index) {
          <div class="flex items-end gap-2" data-testid="http-output-row">
            <div class="min-w-0 flex-1">
              <app-selector
                size="sm"
                label="Campo"
                placeholder="Elige un campo"
                [options]="fieldOptions()"
                [value]="row.field === '' ? null : row.field"
                (valueChange)="setRowField(i, $event)"
              />
            </div>
            <div class="min-w-0 flex-1">
              <app-input
                size="sm"
                label="Ruta de la respuesta"
                placeholder="body.id"
                [error]="row.path !== '' && !validPath(row.path) ? 'Ruta no válida' : undefined"
                [ngModel]="row.path"
                (ngModelChange)="setRowPath(i, $event)"
              />
            </div>
            <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar salida" (clicked)="removeRow(i)">
              <app-icon name="trash-2" [size]="12" slot="icon" />
            </app-button>
          </div>
        }
        <div>
          <app-button variant="outline" size="xsm" [disabled]="rows().length >= maxOutputs || fieldOptions().length === 0" (clicked)="addRow()">
            <app-icon name="plus" [size]="12" slot="icon" />
            Agregar salida
          </app-button>
          @if (fieldOptions().length === 0) {
            <span class="ml-2 text-xs text-text-secondary">Primero crea los campos del flujo donde guardar la respuesta.</span>
          }
        </div>
      </div>

      <app-http-action-test [map]="map()" [output]="outputRecord()" [fields]="fields()" />
    </div>

    <ng-template #inserts let-key="key">
      <div class="flex flex-wrap items-center gap-1" [attr.data-testid]="'insert-' + key">
        <span class="text-xs text-text-secondary">Insertar:</span>
        @for (name of secretNames(); track name) {
          <app-button variant="outline" size="xsm" (clicked)="insertSecret(key, name)">
            <app-icon name="key-round" [size]="12" slot="icon" />
            {{ name }}
          </app-button>
        }
        @for (token of tokens(); track token.value) {
          <app-button variant="outline-secondary" size="xsm" (clicked)="insert(key, token.value)">{{ token.label }}</app-button>
        }
        @if (secretsError()) {
          <span class="text-xs text-text-secondary">No pudimos cargar tus secretos.</span>
        } @else if (secretNames().length === 0) {
          <span class="text-xs text-text-secondary">Aún no tienes secretos: créalos en Integraciones → Secretos.</span>
        }
      </div>
    </ng-template>
  `,
})
export class HttpActionEditorComponent implements OnInit {
  private readonly secretsApi = inject(WorkflowSecretsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly map = input<Record<string, WorkflowActionMapValue>>({});
  readonly outputMap = input<Record<string, string> | undefined>(undefined);
  readonly fields = input<WorkflowFieldDef[]>([]);
  readonly mapChange = output<Record<string, WorkflowActionMapValue>>();
  readonly outputMapChange = output<Record<string, string> | undefined>();

  readonly maxTimeout = WORKFLOW_LIMITS.maxHttpTimeoutSeconds;
  readonly maxOutputs = WORKFLOW_LIMITS.maxHttpOutputs;
  readonly methodOptions = [
    { value: NONE, label: 'Elige un método' },
    ...(
      (WORKFLOW_ACTION_CATALOG['vendix.http.request'].inputs as Record<string, WorkflowActionInputSpec>)['method']
        .values ?? []
    ).map((v) => ({ value: v, label: v })),
  ];

  readonly secretNames = signal<string[]>([]);
  readonly secretsError = signal(false);
  /** Includes rows the user has not finished; only complete ones reach the definition. */
  readonly rows = signal<OutputRow[]>([]);

  readonly tokens = computed(() => actionTokenOptions(this.fields()));
  readonly fieldOptions = computed(() => outputFields(this.fields()).map((f) => ({ value: f.key, label: f.label })));
  readonly outputRecord = computed(() => toOutputRecord(this.rows()));
  readonly method = computed(() => {
    const value = this.map()['method'];
    return typeof value === 'string' && value !== '' ? value : NONE;
  });
  readonly timeout = computed(() => {
    const value = this.map()['timeout_seconds'];
    return value === undefined ? '' : String(value);
  });

  constructor() {
    // The definition is the source of truth: unfinished rows survive only while it does not change.
    effect(() => {
      const incoming = this.outputMap();
      untracked(() => {
        if (JSON.stringify(incoming ?? {}) !== JSON.stringify(this.outputRecord())) {
          this.rows.set(toOutputRows(incoming));
        }
      });
    });
  }

  ngOnInit(): void {
    this.secretsApi
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (secrets) => this.secretNames.set(secrets.map((s) => s.name)),
        error: () => this.secretsError.set(true),
      });
  }

  text(key: HttpTextKey): string {
    const value = this.map()[key];
    return typeof value === 'string' ? value : '';
  }

  validPath(path: string): boolean {
    return isValidOutputPath(path);
  }

  private setKey(name: string, value: WorkflowActionMapValue | undefined): void {
    const { [name]: _old, ...rest } = this.map();
    this.mapChange.emit(value === undefined ? rest : { ...rest, [name]: value });
  }

  setMethod(value: string | number | null): void {
    const next = String(value ?? NONE);
    if (next === NONE) return this.setKey('method', undefined);
    if (next === 'GET') {
      const { method: _m, body: _b, ...rest } = this.map();
      this.mapChange.emit({ ...rest, method: next });
      return;
    }
    this.setKey('method', next);
  }

  setText(key: HttpTextKey, value: string): void {
    this.setKey(key, value === '' || value == null ? undefined : value);
  }

  insert(key: HttpTextKey, token: string): void {
    this.setText(key, appendToken(this.text(key), token, key));
  }

  insertSecret(key: HttpTextKey, name: string): void {
    this.insert(key, `{{secrets.${name}}}`);
  }

  setTimeoutSeconds(raw: unknown): void {
    const parsed = Number(raw);
    this.setKey('timeout_seconds', raw === '' || raw === null || !Number.isFinite(parsed) ? undefined : Math.trunc(parsed));
  }

  addRow(): void {
    this.rows.update((rows) => [...rows, { field: '', path: '' }]);
  }

  removeRow(index: number): void {
    this.update(this.rows().filter((_, i) => i !== index));
  }

  setRowField(index: number, value: string | number | null): void {
    this.update(this.rows().map((row, i) => (i === index ? { ...row, field: value === null ? '' : String(value) } : row)));
  }

  setRowPath(index: number, value: string): void {
    this.update(this.rows().map((row, i) => (i === index ? { ...row, path: value ?? '' } : row)));
  }

  private update(rows: OutputRow[]): void {
    this.rows.set(rows);
    const record = toOutputRecord(rows);
    this.outputMapChange.emit(Object.keys(record).length > 0 ? record : undefined);
  }
}
