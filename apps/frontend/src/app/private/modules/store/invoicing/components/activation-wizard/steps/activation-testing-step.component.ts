import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import type { DianTechnicalResponseData } from '../../../../../../../shared/components/dian-technical-response/dian-technical-response.component';
import { DianTestSetPanelComponent } from '../../../../../../../shared/components/dian';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import {
  DIAN_HABILITATION_PREFIX,
  DIAN_HABILITATION_RANGE_FROM,
  DIAN_HABILITATION_RANGE_TO,
  DIAN_HABILITATION_RESOLUTION_NUMBER,
  DIAN_HABILITATION_TECHNICAL_KEY,
  DIAN_HABILITATION_VALID_FROM,
  DIAN_HABILITATION_VALID_TO,
  isHabilitationNumbering,
} from '../../../../../../../shared/utils/habilitation-numbering.util';
import type { ActivationContext } from '../activation-wizard.model';

/**
 * Paso 4 del asistente: entorno de pruebas (resolución SETP, conexión y set de
 * pruebas). El estado se deriva de `context()`; al persistir algo emite
 * `changed` y el shell recarga y re-deriva.
 */
@Component({
  selector: 'vendix-activation-testing-step',
  standalone: true,
  imports: [ButtonComponent, CardComponent, IconComponent, DianTestSetPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      @if (context().readOnly) {
        <div
          class="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
          role="status"
        >
          <app-icon name="lock" [size]="14" class="mr-1 inline-block"></app-icon>
          {{ context().readOnlyReason ?? 'Este paso es de solo lectura.' }}
        </div>
      }

      <!-- 1. Resolución de pruebas -->
      <app-card [responsive]="true">
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-text-primary">
            1. Resolución de pruebas (SETP)
          </h3>
          @if (hasTestResolution()) {
            <p class="flex items-center gap-1.5 text-sm text-text-primary">
              <app-icon name="check-circle" [size]="16" class="text-success"></app-icon>
              Resolución de pruebas lista
            </p>
            <p class="text-xs text-text-secondary">
              Prefijo {{ testResolutionSummary().prefix }} · rango
              {{ testResolutionSummary().range }}
            </p>
          } @else {
            <p class="text-xs text-text-secondary">
              La DIAN entrega la misma numeración de pruebas a todos los
              contribuyentes. Se crea con estos valores fijos y solo sirve para
              el set de pruebas: no se usa para facturar de verdad.
            </p>
            <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <div><dt class="text-text-secondary">Prefijo</dt><dd class="font-medium text-text-primary">{{ habilitation.prefix }}</dd></div>
              <div><dt class="text-text-secondary">Resolución</dt><dd class="font-medium text-text-primary">{{ habilitation.resolutionNumber }}</dd></div>
              <div><dt class="text-text-secondary">Rango</dt><dd class="font-medium tabular-nums text-text-primary">{{ habilitation.rangeFrom }} - {{ habilitation.rangeTo }}</dd></div>
              <div><dt class="text-text-secondary">Vigencia</dt><dd class="font-medium text-text-primary">{{ habilitation.validFrom }} a {{ habilitation.validTo }}</dd></div>
            </dl>
            @if (createError()) {
              <p class="text-xs text-error" role="alert">{{ createError() }}</p>
            }
            <div>
              <app-button
                size="sm"
                variant="primary"
                [disabled]="context().readOnly || creating()"
                [loading]="creating()"
                (clicked)="createTestResolution()"
              >
                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                Crear resolución de pruebas
              </app-button>
            </div>
          }
        </div>
      </app-card>

      <!-- 2. Probar conexión -->
      <app-card [responsive]="true">
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-text-primary">2. Probar conexión</h3>
          <p class="text-xs text-text-secondary">
            Diagnóstico opcional, recomendado antes de enviar el set: confirma
            que el software y el certificado responden ante la DIAN.
          </p>
          <div>
            <app-button
              size="sm"
              variant="outline"
              [disabled]="context().readOnly || configId() === null || testingConnection()"
              [loading]="testingConnection()"
              (clicked)="testConnection()"
            >
              <app-icon slot="icon" name="activity" [size]="14"></app-icon>
              Probar conexión
            </app-button>
          </div>
          @if (connectionResult(); as result) {
            <p
              class="text-xs"
              [class.text-success]="result.ok"
              [class.text-error]="!result.ok"
              role="status"
            >
              {{ result.message }}
            </p>
          }
        </div>
      </app-card>

      <!-- 3. Set de pruebas -->
      <app-card [responsive]="true">
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-text-primary">3. Set de pruebas</h3>
          @if (waitingOnDian()) {
            <div
              class="rounded-lg border border-border bg-background px-3 py-2 text-xs text-text-secondary"
              role="status"
            >
              <p class="flex items-center gap-1.5 font-semibold text-text-primary">
                <app-icon name="clock" [size]="14"></app-icon>
                Esperando a la DIAN
              </p>
              <p class="mt-1">
                Ya enviamos el set de pruebas y la DIAN todavía lo está
                revisando. No hace falta reenviarlo: puede cerrar esta pantalla
                y volver más tarde, el asistente retoma solo.
              </p>
            </div>
          }
          @if (!hasTestResolution()) {
            <p class="text-xs text-text-secondary">
              Cree primero la resolución de pruebas para poder enviar el set.
            </p>
          }
          <app-dian-test-set-panel
            [configId]="configId()"
            [enablementStatus]="context().axis?.enablement_status ?? null"
            [resolutions]="context().axis?.resolutions ?? []"
            [lastResult]="lastResult()"
            (changed)="onTestSetChanged()"
          ></app-dian-test-set-panel>
        </div>
      </app-card>
    </div>
  `,
})
export class ActivationTestingStepComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly context = input.required<ActivationContext>();
  readonly changed = output<void>();

  readonly habilitation = {
    prefix: DIAN_HABILITATION_PREFIX,
    resolutionNumber: DIAN_HABILITATION_RESOLUTION_NUMBER,
    rangeFrom: DIAN_HABILITATION_RANGE_FROM,
    rangeTo: DIAN_HABILITATION_RANGE_TO,
    validFrom: formatDateOnlyUTC(DIAN_HABILITATION_VALID_FROM),
    validTo: formatDateOnlyUTC(DIAN_HABILITATION_VALID_TO),
  };

  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly testingConnection = signal(false);
  readonly connectionResult = signal<{ ok: boolean; message: string } | null>(null);
  readonly lastResult = signal<DianTechnicalResponseData | null>(null);

  readonly configId = computed<number | null>(
    () => this.context().axis?.config_id ?? this.context().config?.id ?? null,
  );

  private readonly testResolution = computed(() =>
    (this.context().axis?.resolutions ?? []).find(
      (r) =>
        r.document_type === 'sales_invoice' &&
        r.is_active &&
        isHabilitationNumbering({
          resolution_number: r.resolution_number,
          range_from: r.range_from,
          range_to: r.range_to,
        }),
    ) ?? null,
  );

  readonly hasTestResolution = computed(() => this.testResolution() !== null);

  readonly testResolutionSummary = computed(() => {
    const r = this.testResolution();
    return {
      prefix: r?.prefix ?? '',
      range: r ? `${r.range_from} - ${r.range_to}` : '',
    };
  });

  readonly waitingOnDian = computed(() => {
    const axis = this.context().axis;
    if (!axis) return false;
    if ((axis.readiness?.waiting_on_dian?.length ?? 0) > 0) return true;
    const result = this.lastResult();
    return (
      axis.enablement_status === 'testing' &&
      !!result?.zip_key &&
      !(result.error_messages?.length ?? 0)
    );
  });

  constructor() {
    // Recarga el último veredicto al montar y cuando cambia la configuración.
    effect(() => {
      const id = this.configId();
      untracked(() => this.loadTestResults(id));
    });
  }

  createTestResolution(): void {
    if (this.context().readOnly || this.creating()) return;
    this.creating.set(true);
    this.createError.set(null);
    this.api
      .createResolution({
        document_type: 'sales_invoice',
        resolution_number: DIAN_HABILITATION_RESOLUTION_NUMBER,
        resolution_date: DIAN_HABILITATION_VALID_FROM,
        prefix: DIAN_HABILITATION_PREFIX,
        range_from: DIAN_HABILITATION_RANGE_FROM,
        range_to: DIAN_HABILITATION_RANGE_TO,
        valid_from: DIAN_HABILITATION_VALID_FROM,
        valid_to: DIAN_HABILITATION_VALID_TO,
        technical_key: DIAN_HABILITATION_TECHNICAL_KEY,
        is_active: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.toast.success('Resolución de pruebas creada.');
          this.changed.emit();
        },
        error: (err: unknown) => {
          this.creating.set(false);
          this.createError.set(parseApiError(err).userMessage);
        },
      });
  }

  testConnection(): void {
    const id = this.configId();
    if (id === null || this.testingConnection()) return;
    this.testingConnection.set(true);
    this.connectionResult.set(null);
    this.api
      .testDianConnection(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.testingConnection.set(false);
          const data = res?.data ?? res;
          const ok = res?.success !== false && data?.success !== false;
          this.connectionResult.set({
            ok,
            message: ok
              ? 'Conexión con la DIAN correcta.'
              : (data?.message ?? res?.message ?? 'La DIAN no respondió como se esperaba.'),
          });
        },
        error: (err: unknown) => {
          this.testingConnection.set(false);
          this.connectionResult.set({ ok: false, message: parseApiError(err).userMessage });
        },
      });
  }

  onTestSetChanged(): void {
    this.loadTestResults(this.configId());
    this.changed.emit();
  }

  private loadTestResults(configId: number | null): void {
    if (configId === null) {
      this.lastResult.set(null);
      return;
    }
    this.api
      .getDianTestResults(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => this.lastResult.set(response?.data ?? null),
        error: () => this.lastResult.set(null),
      });
  }
}
