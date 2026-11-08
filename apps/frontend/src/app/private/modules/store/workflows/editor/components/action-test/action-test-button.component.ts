import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
} from '../../../../../../../shared/components/index';
import {
  WorkflowActionDef,
  WorkflowDefinitionV1,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { ActionTestResult } from '../../../interfaces/workflow-debug.interfaces';
import { WorkflowDebugApiService } from '../../../services/workflow-debug-api.service';
import { toWorkflowError } from '../../../utils/workflow-errors.util';
import { previewValue, referencedFieldKeys, runsForReal } from './action-test.utils';

/**
 * "Probar esta acción" for any action of a stage. HTTP and the connectors make
 * the real call; the rest only show a preview and say so ("no se ejecutó").
 */
@Component({
  selector: 'app-action-test-button',
  standalone: true,
  imports: [FormsModule, AlertBannerComponent, BadgeComponent, ButtonComponent, IconComponent, InputComponent, ModalComponent],
  template: `
    <app-button variant="outline" size="sm" (clicked)="open()">
      <app-icon name="play" [size]="14" slot="icon" />
      Probar esta acción
    </app-button>

    <app-modal [isOpen]="isOpen()" (isOpenChange)="isOpen.set($event)" title="Probar esta acción" size="md">
      <div class="flex flex-col gap-3" data-testid="action-test">
        <p class="text-xs text-text-secondary">
          @if (real()) {
            Esta acción hace la llamada de verdad con los datos de prueba.
          } @else {
            Esta acción crea o cambia registros: aquí solo ves una vista previa, no se ejecuta.
          }
        </p>

        @if (keys().length > 0) {
          <div class="flex flex-col gap-2">
            <p class="text-xs font-semibold text-text-primary">Datos de prueba</p>
            @for (key of keys(); track key) {
              <app-input size="sm" [label]="labelOf(key)" [ngModel]="sample(key)" (ngModelChange)="setSample(key, $event)" />
            }
          </div>
        } @else {
          <p class="text-xs text-text-secondary">Esta acción no usa campos del formulario.</p>
        }

        @if (failure(); as message) {
          <app-alert-banner variant="danger" icon="alert-circle">{{ message }}</app-alert-banner>
        }

        @if (result(); as r) {
          @switch (r.mode) {
            @case ('preview') {
              <div class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3" data-testid="action-test-preview">
                <app-badge variant="warning">Vista previa — no se ejecutó</app-badge>
                <p class="text-xs font-semibold text-text-primary">Entrada resuelta</p>
                <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  @for (row of previewRows(r.resolved_input); track row.key) {
                    <dt class="font-mono text-text-secondary">{{ row.key }}</dt>
                    <dd class="break-all text-text-primary">{{ row.value }}</dd>
                  } @empty {
                    <dt class="text-text-secondary">Sin datos</dt>
                  }
                </dl>
                @if (r.schema_errors.length > 0) {
                  <p class="text-xs font-semibold text-error">Errores de validación</p>
                  <ul class="list-disc pl-5 text-xs text-error" data-testid="action-test-errors">
                    @for (e of r.schema_errors; track e.key) { <li>{{ e.label }}: {{ e.message }}</li> }
                  </ul>
                } @else {
                  <p class="text-xs text-text-primary" data-testid="action-test-valid">La entrada cumple el esquema de la acción.</p>
                }
                @if (r.permission.required; as required) {
                  <p class="text-xs" [class.text-error]="!r.permission.granted" data-testid="action-test-permission">
                    @if (r.permission.granted) {
                      Tienes el permiso requerido ({{ required }}).
                    } @else {
                      No tienes el permiso requerido ({{ required }}): el flujo no podría ejecutar esta acción por ti.
                    }
                  </p>
                }
              </div>
            }
            @case ('http') {
              <div class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3" data-testid="action-test-http">
                <app-badge variant="success">Llamada real ejecutada</app-badge>
                @if (r.result.ok) {
                  <p class="text-xs text-text-primary">Estado {{ r.result.status }} · {{ r.result.duration_ms }} ms</p>
                  <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-2 font-mono text-xs text-text-primary">{{ r.result.body === '' ? '(vacío)' : r.result.body }}</pre>
                } @else {
                  <app-alert-banner variant="danger" icon="alert-circle">{{ r.result.error.message }}</app-alert-banner>
                }
              </div>
            }
            @case ('connector') {
              <div class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3" data-testid="action-test-connector">
                <app-badge [variant]="r.result.ok ? 'success' : 'error'">
                  {{ r.result.ok ? 'Prueba real ejecutada' : 'La prueba falló' }}
                </app-badge>
                <p class="text-xs text-text-primary">{{ r.result.message }}</p>
                @if (r.result.simulated) {
                  <p class="text-xs text-text-secondary">El servidor está en modo de pruebas: no salió nada realmente.</p>
                }
              </div>
            }
          }
        }
      </div>
      <div slot="footer" class="flex w-full justify-end gap-2">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cerrar</app-button>
        <app-button variant="primary" [loading]="busy()" (clicked)="run()">Probar</app-button>
      </div>
    </app-modal>
  `,
})
export class ActionTestButtonComponent {
  private readonly api = inject(WorkflowDebugApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly action = input.required<WorkflowActionDef>();
  readonly definition = input<WorkflowDefinitionV1 | null>(null);

  readonly isOpen = signal(false);
  readonly busy = signal(false);
  readonly result = signal<ActionTestResult | null>(null);
  readonly failure = signal('');
  private readonly samples = signal<Record<string, string>>({});

  readonly keys = computed(() => referencedFieldKeys(this.action()));
  readonly real = computed(() => runsForReal(this.action()));

  open(): void {
    this.result.set(null);
    this.failure.set('');
    this.isOpen.set(true);
  }

  labelOf(key: string): string {
    return this.definition()?.fields.find((f) => f.key === key)?.label ?? key;
  }

  sample(key: string): string {
    return this.samples()[key] ?? '';
  }

  setSample(key: string, value: string): void {
    this.samples.update((current) => ({ ...current, [key]: value ?? '' }));
  }

  previewRows(input: Record<string, unknown>): { key: string; value: string }[] {
    return Object.entries(input).map(([key, value]) => ({ key, value: previewValue(value) }));
  }

  run(): void {
    if (this.busy()) return;
    const data: Record<string, string> = {};
    for (const key of this.keys()) data[key] = this.sample(key);
    this.busy.set(true);
    this.failure.set('');
    this.result.set(null);
    this.api
      .testAction({ action: this.action() as unknown as Record<string, unknown>, data })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.result.set(res);
        },
        error: (e) => {
          this.busy.set(false);
          this.failure.set(toWorkflowError(e).message);
        },
      });
  }
}
