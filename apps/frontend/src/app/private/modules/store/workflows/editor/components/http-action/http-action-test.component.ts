import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
} from '../../../../../../../shared/components/index';
import {
  WorkflowActionMapValue,
  WorkflowFieldDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { toWorkflowError } from '../../../utils/workflow-errors.util';
import { HttpActionApiService, HttpTestErrorKind, HttpTestResult } from './http-action-api.service';
import { usedFieldKeys } from './http-action.utils';

const ERROR_TITLE: Record<HttpTestErrorKind, string> = {
  invalid: 'La llamada no es válida',
  secret: 'Falta un secreto',
  blocked: 'Destino bloqueado',
  timeout: 'El servicio no respondió a tiempo',
  network: 'No se pudo conectar',
};

/** "Probar esta acción": runs the real request with sample values and shows what came back. */
@Component({
  selector: 'app-http-action-test',
  standalone: true,
  imports: [FormsModule, AlertBannerComponent, BadgeComponent, ButtonComponent, IconComponent, InputComponent],
  template: `
    <div class="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="http-test">
      <div>
        <p class="text-xs font-semibold text-text-primary">Probar esta acción</p>
        <p class="text-xs text-text-secondary">
          Hace la llamada de verdad (con tus secretos) y muestra lo que respondió el servicio. No cambia ninguna solicitud.
        </p>
      </div>

      @if (sampleKeys().length > 0) {
        <div class="flex flex-col gap-2">
          <p class="text-xs text-text-secondary">Valores de muestra para las variables que usa la llamada:</p>
          @for (key of sampleKeys(); track key) {
            <app-input
              size="sm"
              [label]="labelOf(key)"
              [ngModel]="sample(key)"
              (ngModelChange)="setSample(key, $event)"
            />
          }
        </div>
      }

      <div>
        <app-button variant="outline" size="sm" [loading]="busy()" [disabled]="!canRun()" (clicked)="run()">
          <app-icon name="play" [size]="14" slot="icon" />
          Probar esta acción
        </app-button>
        @if (!canRun() && !busy()) {
          <span class="ml-2 text-xs text-text-secondary">Elige el método y escribe la URL para probar.</span>
        }
      </div>

      @if (failure(); as message) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ message }}</app-alert-banner>
      }

      @if (result(); as r) {
        @if (r.ok) {
          <div class="flex flex-col gap-3" data-testid="http-test-result">
            <div class="flex flex-wrap items-center gap-2">
              <app-badge [variant]="statusVariant(r.status)">Estado {{ r.status }}</app-badge>
              <span class="text-xs text-text-secondary">{{ r.duration_ms }} ms</span>
            </div>
            @if (r.status < 200 || r.status >= 300) {
              <app-alert-banner variant="warning" icon="alert-triangle">
                El servicio respondió {{ r.status }}: al ejecutarse en un flujo, esto cuenta como error de la acción.
              </app-alert-banner>
            }
            <div>
              <p class="text-xs font-semibold text-text-primary">Encabezados</p>
              <ul class="mt-1 max-h-32 overflow-auto rounded-lg bg-background p-2 font-mono text-xs text-text-primary">
                @for (header of headerList(); track header.name) {
                  <li class="break-all">{{ header.name }}: {{ header.value }}</li>
                } @empty {
                  <li>Sin encabezados</li>
                }
              </ul>
            </div>
            <div>
              <p class="text-xs font-semibold text-text-primary">Cuerpo</p>
              <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-2 font-mono text-xs text-text-primary">{{ r.body === '' ? '(vacío)' : r.body }}</pre>
              @if (r.body_truncated) {
                <p class="text-xs text-text-secondary">Se muestra solo el inicio de la respuesta.</p>
              }
            </div>
            @if (hasOutput()) {
              <div>
                <p class="text-xs font-semibold text-text-primary">Campos que se llenarían</p>
                <ul class="mt-1 flex flex-col gap-1 text-xs text-text-primary">
                  @for (entry of outputList(); track entry.field) {
                    <li>
                      <span class="font-semibold">{{ labelOf(entry.field) }}</span> ← {{ entry.value }}
                    </li>
                  } @empty {
                    <li class="text-text-secondary">Ninguna ruta de salida encontró un valor en esta respuesta.</li>
                  }
                </ul>
              </div>
            }
          </div>
        } @else {
          <app-alert-banner variant="danger" icon="alert-circle">
            <strong>{{ errorTitle(r.error.kind) }}.</strong> {{ r.error.message }}
          </app-alert-banner>
        }
      }
    </div>
  `,
})
export class HttpActionTestComponent {
  private readonly api = inject(HttpActionApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly map = input.required<Record<string, WorkflowActionMapValue>>();
  readonly output = input<Record<string, string>>({});
  readonly fields = input<WorkflowFieldDef[]>([]);

  readonly busy = signal(false);
  readonly result = signal<HttpTestResult | null>(null);
  readonly failure = signal('');
  private readonly samples = signal<Record<string, string>>({});

  readonly sampleKeys = computed(() => usedFieldKeys(this.map()));
  readonly hasOutput = computed(() => Object.keys(this.output()).length > 0);
  readonly canRun = computed(() => {
    const m = this.map();
    return typeof m['method'] === 'string' && m['method'] !== '' && typeof m['url'] === 'string' && m['url'].trim() !== '';
  });
  readonly headerList = computed(() => {
    const r = this.result();
    return r?.ok ? Object.entries(r.headers).map(([name, value]) => ({ name, value })) : [];
  });
  readonly outputList = computed(() => {
    const r = this.result();
    return r?.ok
      ? Object.entries(r.output).map(([field, value]) => ({
          field,
          value: typeof value === 'string' ? value : JSON.stringify(value),
        }))
      : [];
  });

  labelOf(key: string): string {
    return this.fields().find((f) => f.key === key)?.label ?? key;
  }

  sample(key: string): string {
    return this.samples()[key] ?? '';
  }

  setSample(key: string, value: string): void {
    this.samples.update((current) => ({ ...current, [key]: value ?? '' }));
  }

  errorTitle(kind: HttpTestErrorKind): string {
    return ERROR_TITLE[kind];
  }

  statusVariant(status: number): 'success' | 'warning' | 'error' {
    if (status >= 200 && status < 300) return 'success';
    return status >= 500 ? 'error' : 'warning';
  }

  run(): void {
    if (!this.canRun() || this.busy()) return;
    const map: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(this.map())) {
      if (typeof value === 'string' || typeof value === 'number') map[name] = value;
    }
    const sample_fields: Record<string, string> = {};
    for (const key of this.sampleKeys()) sample_fields[key] = this.sample(key);
    this.busy.set(true);
    this.failure.set('');
    this.result.set(null);
    this.api
      .test({ map, output: this.output(), sample_fields })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.result.set(res);
        },
        error: (error) => {
          this.busy.set(false);
          this.failure.set(toWorkflowError(error).message);
        },
      });
  }
}
