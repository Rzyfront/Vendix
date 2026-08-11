import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Subscription, startWith, switchMap, timer } from 'rxjs';

import { BadgeComponent, type BadgeVariant } from '../../badge/badge.component';
import { ButtonComponent } from '../../button/button.component';
import { CardComponent } from '../../card/card.component';
import { ConfirmationModalComponent } from '../../confirmation-modal/confirmation-modal.component';
import {
  DianTechnicalResponseComponent,
  type DianTechnicalResponseData,
} from '../../dian-technical-response/dian-technical-response.component';
import { IconComponent } from '../../icon/icon.component';
import {
  SelectorComponent,
  type SelectorOption,
} from '../../selector/selector.component';
import { DIAN_API_CONTEXT, DianConfigApiService } from '../../../services/dian';
import { formatDateOnlyUTC } from '../../../utils/date.util';
import { requirementsFor } from '../fiscal-document-requirements';
import {
  DIAN_ENABLEMENT_STATUS_LABELS,
  type FiscalReadinessResolution,
} from '../fiscal-readiness.interface';

/** Cada cuánto se pregunta por el job. El trabajo pesado ronda los 74 s. */
const POLL_INTERVAL_MS = 4000;
/** Tope de sondeos. A 4 s son ~6 minutos: más allá, el job no va a contestar. */
const MAX_POLL_ATTEMPTS = 90;

/** Estados de habilitación en los que la DIAN ya cerró el set. */
const TEST_SET_CLOSED_STATUSES = ['test_set_passed', 'enabled'];

/** Diagnóstico documento a documento devuelto por `test-set-documents`. */
interface TestSetDocumentRow {
  number?: string | number | null;
  file_name?: string | null;
  kind?: string | null;
  cufe?: string | null;
  status_code?: string | null;
  status_message?: string | null;
  found?: boolean | null;
}

/**
 * Set de pruebas de habilitación DIAN: lanzarlo, seguir su veredicto y
 * diagnosticarlo documento a documento.
 *
 * ## Por qué el envío está detrás de una confirmación explícita
 *
 * `SendTestSetAsync` consume consecutivos de un rango AUTORIZADO. Los números
 * gastados no se recuperan y la DIAN tarda minutos —a veces horas— en clasificar
 * el lote. Un botón directo convierte cualquier impaciencia en un segundo bloque
 * quemado, así que el envío pasa por una confirmación que dice exactamente eso.
 *
 * ## Las consultas NO reenvían
 *
 * «Consultar veredicto» y «Diagnóstico documento a documento» son lecturas: la
 * primera vuelve a preguntar por la ZipKey ya guardada, la segunda pregunta a la
 * DIAN si cada documento llegó a sus registros. Se ofrecen SIEMPRE que haya un
 * lote enviado y sin confirmación, porque son justo lo que hay que hacer en vez
 * de reenviar. Van visualmente separadas del envío para que nadie las confunda.
 *
 * ## Una sola implementación para las dos consolas
 *
 * Lo que cambia entre el panel del comerciante y la consola de superadmin es
 * quién puede lanzar, y eso sale de `DIAN_API_CONTEXT.capabilities().runTestSet`.
 * El rail HTTP lo resuelve el mismo token, así que este panel opera sobre el
 * tenant abierto sin saber en qué consola está montado.
 */
@Component({
  selector: 'app-dian-test-set-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ConfirmationModalComponent,
    DianTechnicalResponseComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card>
      <div class="flex flex-col gap-4">
        <!-- Cabecera -->
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon
              name="flask-conical"
              [size]="18"
              class="text-[var(--color-text-secondary)] shrink-0"
            ></app-icon>
            <h3
              class="text-sm font-semibold text-[var(--color-text-primary)] truncate"
            >
              Set de pruebas de habilitación
            </h3>
          </div>
          @if (statusLabel(); as label) {
            <app-badge [variant]="statusVariant()" size="xs">{{ label }}</app-badge>
          }
        </div>

        @if (!configId()) {
          <p class="text-xs text-[var(--color-text-secondary)]">
            Este eje todavía no tiene configuración DIAN. El set de pruebas se
            envía contra una configuración con certificado y resolución.
          </p>
        } @else {
          @if (closedByDian()) {
            <p
              class="text-xs text-[var(--color-success)] flex items-start gap-1.5"
            >
              <app-icon
                name="check-circle"
                [size]="14"
                class="shrink-0 mt-0.5"
              ></app-icon>
              <span>
                La DIAN ya cerró el set de pruebas de esta configuración. No hay
                que volver a enviarlo: hacerlo sólo gastaría consecutivos.
              </span>
            </p>
          }

          <!-- Envío -->
          @if (canRun() && !closedByDian()) {
            <div class="flex flex-col gap-3">
              <app-selector
                label="Resolución contra la que se numera el set"
                placeholder="Elige la resolución"
                helpText="Los consecutivos que consuma este envío salen de esta resolución y no se recuperan."
                [options]="resolutionOptions()"
                [formControl]="resolutionControl"
              ></app-selector>

              <div class="flex flex-wrap items-center gap-2">
                <app-button
                  size="sm"
                  variant="primary"
                  [disabled]="!canSubmitRun()"
                  [loading]="running()"
                  (clicked)="askRunConfirmation()"
                >
                  <app-icon slot="icon" name="play" [size]="14"></app-icon>
                  Enviar set de pruebas
                </app-button>
                @if (running()) {
                  <span class="text-[11px] text-[var(--color-text-secondary)]">
                    {{ progressText() }}
                  </span>
                }
              </div>
            </div>
          } @else if (!canRun()) {
            <p
              class="text-[11px] text-[var(--color-text-secondary)] flex items-start gap-1.5"
            >
              <app-icon name="lock" [size]="12" class="shrink-0 mt-0.5"></app-icon>
              <span>
                No tienes permiso para enviar el set de pruebas de esta
                configuración. Las consultas de abajo siguen disponibles.
              </span>
            </p>
          }

          <!-- Consultas: NO reenvían nada -->
          <div
            class="pt-3 border-t border-[var(--color-border)] flex flex-col gap-2"
          >
            <p
              class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
            >
              Consultar — no reenvía documentos
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <app-button
                size="sm"
                variant="outline"
                [disabled]="busy()"
                [loading]="checking()"
                (clicked)="checkVerdict()"
              >
                <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
                Consultar veredicto
              </app-button>
              <app-button
                size="sm"
                variant="ghost"
                [disabled]="busy()"
                [loading]="listingDocuments()"
                (clicked)="loadDocuments()"
              >
                <app-icon slot="icon" name="list-checks" [size]="14"></app-icon>
                Documento a documento
              </app-button>
              @if (canRun() && !closedByDian()) {
                <app-button
                  size="sm"
                  variant="outline-danger"
                  [disabled]="busy()"
                  [loading]="abandoning()"
                  (clicked)="askAbandonConfirmation()"
                >
                  <app-icon slot="icon" name="ban" [size]="14"></app-icon>
                  Descartar lote sin veredicto
                </app-button>
              }
            </div>
          </div>

          <!-- Mensajes -->
          @if (errorText(); as message) {
            <p class="text-xs text-[var(--color-error)]">{{ message }}</p>
          }
          @if (noticeText(); as message) {
            <p class="text-xs text-[var(--color-text-secondary)]">{{ message }}</p>
          }

          <!-- Diagnóstico documento a documento -->
          @if (documents(); as rows) {
            <div class="flex flex-col gap-1 pt-2 border-t border-[var(--color-border)]">
              <p class="text-[11px] font-medium text-[var(--color-text-secondary)]">
                Documentos del lote ({{ rows.length }})
              </p>
              @if (!rows.length) {
                <p class="text-[11px] text-[var(--color-text-secondary)]">
                  La DIAN no reporta ningún documento de este lote en sus
                  registros. Eso separa «encolado» de «nunca clasificado»: si el
                  lote no llegó, reenviar es lo correcto; si llegó, no.
                </p>
              }
              @for (row of rows; track $index) {
                <div class="flex items-start gap-2 text-[11px]">
                  <app-icon
                    [name]="row.found === false ? 'x-circle' : 'check-circle'"
                    [size]="12"
                    [class]="
                      row.found === false
                        ? 'text-[var(--color-error)] shrink-0 mt-0.5'
                        : 'text-[var(--color-success)] shrink-0 mt-0.5'
                    "
                  ></app-icon>
                  <span class="font-mono shrink-0">{{
                    row.number ?? row.file_name ?? '—'
                  }}</span>
                  @if (row.kind) {
                    <span class="text-[var(--color-text-secondary)] shrink-0">{{
                      row.kind
                    }}</span>
                  }
                  <span class="text-[var(--color-text-secondary)] break-words">
                    {{ row.status_message ?? row.status_code ?? '' }}
                  </span>
                </div>
              }
            </div>
          }

          <!-- Respuesta técnica cruda -->
          @if (technicalResult(); as result) {
            <app-dian-technical-response
              [result]="result"
            ></app-dian-technical-response>
          }
        }
      </div>
    </app-card>

    <!-- Confirmaciones. Se renderizan sólo cuando hacen falta, así que el modal
         nace abierto y no hace falta un canal de visibilidad duplicado. -->
    @if (runConfirmVisible()) {
      <app-confirmation-modal
        title="Enviar el set de pruebas"
        [message]="runConfirmationMessage()"
        confirmText="Sí, enviar"
        cancelText="No enviar"
        confirmVariant="danger"
        size="md"
        (confirm)="runTestSet()"
        (cancel)="runConfirmVisible.set(false)"
      ></app-confirmation-modal>
    }

    @if (abandonConfirmVisible()) {
      <app-confirmation-modal
        title="Descartar el lote enviado"
        message="Descartar el lote libera el seguro de reenvío para poder mandar uno nuevo. Los consecutivos que ya consumió el lote descartado NO se recuperan. Hazlo sólo si comprobaste, documento a documento, que la DIAN nunca lo recibió."
        confirmText="Sí, descartar"
        cancelText="Cancelar"
        confirmVariant="danger"
        size="md"
        (confirm)="abandon()"
        (cancel)="abandonConfirmVisible.set(false)"
      ></app-confirmation-modal>
    }
  `,
})
export class DianTestSetPanelComponent {
  /** Configuración sobre la que opera. `null` deshabilita todo el panel. */
  readonly configId = input.required<number | null>();

  /** Estado de habilitación del eje, para no ofrecer un envío que la DIAN ya cerró. */
  readonly enablementStatus = input<string | null>(null);

  /** Resoluciones del eje. El envío numera contra la que se elija. */
  readonly resolutions = input<FiscalReadinessResolution[]>([]);

  /**
   * Último resultado conocido, tal como lo trae el agregado del host. El panel
   * lo muestra hasta que una consulta propia lo reemplace: sin esto, abrir la
   * pantalla borraría de la vista el diagnóstico del envío anterior.
   */
  readonly lastResult = input<DianTechnicalResponseData | null>(null);

  /**
   * Algo cambió del lado del servidor (envío terminado, lote descartado). El
   * host recarga su agregado: el estado de habilitación lo decide el backend a
   * partir del veredicto de la DIAN, no este componente.
   */
  readonly changed = output<void>();

  private readonly api = inject(DianConfigApiService);
  private readonly dianContext = inject(DIAN_API_CONTEXT);
  private readonly destroyRef = inject(DestroyRef);

  readonly capabilities = computed(() => this.dianContext.capabilities());
  readonly canRun = computed(() => this.capabilities().runTestSet);

  /**
   * `string | number` porque el CVA del selector escribe de vuelta el `value` de
   * la opción tal cual, y `SelectorOption.value` admite los dos. Tiparlo sólo
   * como `number` obligaría a un cast que taparía el caso real: un id que llega
   * como cadena y que `Number('')` convertiría en 0 — la resolución equivocada.
   */
  readonly resolutionControl = new FormControl<string | number | null>(null);

  readonly running = signal(false);
  readonly checking = signal(false);
  readonly listingDocuments = signal(false);
  readonly abandoning = signal(false);
  readonly pollAttempts = signal(0);
  readonly errorText = signal<string | null>(null);
  readonly noticeText = signal<string | null>(null);
  readonly documents = signal<TestSetDocumentRow[] | null>(null);
  readonly runConfirmVisible = signal(false);
  readonly abandonConfirmVisible = signal(false);

  /** Resultado obtenido por este panel; pisa a `lastResult` cuando existe. */
  private readonly freshResult = signal<DianTechnicalResponseData | null>(null);

  private pollSubscription: Subscription | null = null;

  readonly busy = computed(
    () =>
      this.running() ||
      this.checking() ||
      this.listingDocuments() ||
      this.abandoning(),
  );

  readonly closedByDian = computed(() =>
    TEST_SET_CLOSED_STATUSES.includes(this.enablementStatus() ?? ''),
  );

  readonly statusLabel = computed(() => {
    const status = this.enablementStatus();
    if (!status) return null;
    return DIAN_ENABLEMENT_STATUS_LABELS[status] ?? status;
  });

  readonly statusVariant = computed<BadgeVariant>(() => {
    const status = this.enablementStatus();
    if (status === 'enabled' || status === 'test_set_passed') return 'success';
    if (status === 'testing') return 'warning';
    if (status === 'suspended' || status === 'expired') return 'error';
    return 'neutral';
  });

  readonly technicalResult = computed(
    () => this.freshResult() ?? this.lastResult(),
  );

  readonly resolutionOptions = computed<SelectorOption[]>(() =>
    this.resolutions().map((resolution) => ({
      value: resolution.id,
      label: `${resolution.prefix ?? ''}${resolution.range_from}–${resolution.range_to} · ${requirementsFor(resolution.document_type).label}`,
      description: `Va por ${resolution.current_number} · vigente hasta ${formatDateOnlyUTC(resolution.valid_to)}${resolution.is_active ? '' : ' · INACTIVA'}`,
      disabled: !resolution.is_active,
    })),
  );

  readonly canSubmitRun = computed(
    () =>
      this.canRun() &&
      !this.closedByDian() &&
      this.configId() !== null &&
      this.selectedResolutionId() !== null &&
      !this.busy(),
  );

  readonly progressText = computed(() => {
    const attempts = this.pollAttempts();
    if (!attempts) return 'Encolando el envío…';
    return `Construyendo, firmando y enviando los documentos… (consulta ${attempts})`;
  });

  readonly runConfirmationMessage = computed(() => {
    const resolution = this.resolutions().find(
      (candidate) => candidate.id === this.selectedResolutionId(),
    );
    const range = resolution
      ? ` a partir del ${resolution.current_number} de la resolución ${resolution.prefix ?? ''}${resolution.range_from}–${resolution.range_to}`
      : '';
    return (
      `El set de pruebas consume consecutivos de un rango AUTORIZADO por la DIAN${range}. ` +
      'Los números que gaste no se recuperan y la DIAN puede tardar minutos u horas en dar veredicto. ' +
      'Si ya enviaste uno y estás esperando respuesta, no envíes otro: usa «Consultar veredicto».'
    );
  });

  /**
   * Puente de la selección a señal.
   *
   * `resolutionControl.value` es una PROPIEDAD, no una señal: leerla dentro de
   * un `computed` lo evaluaría una sola vez con el valor inicial `null` y el
   * botón «Enviar set de pruebas» se quedaría deshabilitado para siempre por
   * mucho que el usuario eligiera resolución. Es el fallo silencioso que este
   * repo ya pagó una vez.
   */
  private readonly resolutionValue = toSignal(
    this.resolutionControl.valueChanges.pipe(
      startWith(this.resolutionControl.value),
    ),
    { initialValue: this.resolutionControl.value },
  );

  readonly selectedResolutionId = computed<number | null>(() => {
    const raw = this.resolutionValue();
    if (raw === null || raw === undefined || raw === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });

  askRunConfirmation(): void {
    if (!this.canSubmitRun()) return;
    this.errorText.set(null);
    this.noticeText.set(null);
    this.runConfirmVisible.set(true);
  }

  askAbandonConfirmation(): void {
    if (this.busy()) return;
    this.errorText.set(null);
    this.noticeText.set(null);
    this.abandonConfirmVisible.set(true);
  }

  runTestSet(): void {
    this.runConfirmVisible.set(false);
    const configId = this.configId();
    const resolutionId = this.selectedResolutionId();
    if (!configId || resolutionId === null) return;

    this.running.set(true);
    this.pollAttempts.set(0);
    this.errorText.set(null);
    this.noticeText.set(null);

    this.api
      .runDianTestSet(configId, resolutionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          const jobId = this.readJobId(response);
          if (!jobId) {
            // Sin job_id no hay a qué sondear, pero el envío PUEDE haber salido.
            // Se recarga en vez de declarar un fallo que quizá no ocurrió.
            this.running.set(false);
            this.noticeText.set(
              'El envío se aceptó pero no devolvió identificador de trabajo. Consulta el veredicto en unos minutos antes de volver a enviar.',
            );
            this.changed.emit();
            return;
          }
          this.startPolling(configId, jobId);
        },
        error: (error: unknown) => {
          this.running.set(false);
          this.errorText.set(this.messageOf(error));
        },
      });
  }

  /**
   * Sondea el job hasta que termina. Se detiene por tres vías —terminal, tope de
   * intentos y destrucción del componente— porque un `timer` sin freno seguiría
   * pegándole al backend con la pantalla ya cerrada.
   */
  private startPolling(configId: number, jobId: string): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = timer(POLL_INTERVAL_MS, POLL_INTERVAL_MS)
      .pipe(
        switchMap(() => this.api.getDianTestSetJob(configId, jobId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response: unknown) => {
          this.pollAttempts.update((value) => value + 1);
          const payload = this.unwrap(response) as {
            status?: string;
            result?: unknown;
            error?: string;
          } | null;
          const status = payload?.status ?? '';

          if (status === 'completed') {
            this.stopPolling();
            this.running.set(false);
            const result = payload?.result as DianTechnicalResponseData | null;
            if (result) this.freshResult.set(result);
            this.noticeText.set(
              'Envío terminado. La DIAN todavía puede tardar en clasificar el lote: el veredicto se consulta, no se reenvía.',
            );
            this.changed.emit();
            return;
          }

          if (status === 'failed') {
            this.stopPolling();
            this.running.set(false);
            this.errorText.set(
              payload?.error ??
                'El envío del set de pruebas falló. Revisa la respuesta técnica antes de reintentar: si los documentos llegaron a salir, los consecutivos ya se consumieron.',
            );
            this.changed.emit();
            return;
          }

          if (this.pollAttempts() >= MAX_POLL_ATTEMPTS) {
            this.stopPolling();
            this.running.set(false);
            this.noticeText.set(
              'El trabajo sigue en curso más de lo esperado. Sal de esta pantalla sin reenviar y consulta el veredicto más tarde.',
            );
            this.changed.emit();
          }
        },
        error: (error: unknown) => {
          this.stopPolling();
          this.running.set(false);
          this.errorText.set(this.messageOf(error));
        },
      });
  }

  private stopPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }

  checkVerdict(): void {
    const configId = this.configId();
    if (!configId || this.busy()) return;
    this.checking.set(true);
    this.errorText.set(null);
    this.noticeText.set(null);

    this.api
      .checkDianTestSetStatus(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          this.checking.set(false);
          const payload = this.unwrap(response) as DianTechnicalResponseData | null;
          if (payload) this.freshResult.set(payload);
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.checking.set(false);
          this.errorText.set(this.messageOf(error));
        },
      });
  }

  loadDocuments(): void {
    const configId = this.configId();
    if (!configId || this.busy()) return;
    this.listingDocuments.set(true);
    this.errorText.set(null);
    this.noticeText.set(null);

    this.api
      .getDianTestSetDocuments(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          this.listingDocuments.set(false);
          const payload = this.unwrap(response) as
            | TestSetDocumentRow[]
            | { documents?: TestSetDocumentRow[] }
            | null;
          if (Array.isArray(payload)) {
            this.documents.set(payload);
          } else {
            this.documents.set(payload?.documents ?? []);
          }
        },
        error: (error: unknown) => {
          this.listingDocuments.set(false);
          this.errorText.set(this.messageOf(error));
        },
      });
  }

  abandon(): void {
    this.abandonConfirmVisible.set(false);
    const configId = this.configId();
    if (!configId || this.busy()) return;
    this.abandoning.set(true);
    this.errorText.set(null);
    this.noticeText.set(null);

    this.api
      .abandonDianTestSet(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.abandoning.set(false);
          this.documents.set(null);
          this.noticeText.set(
            'Lote descartado. Ya se puede enviar uno nuevo; los consecutivos del descartado quedaron consumidos.',
          );
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.abandoning.set(false);
          this.errorText.set(this.messageOf(error));
        },
      });
  }

  /** Los controladores responden `{ success, data }`; algunos rails, el objeto pelado. */
  private unwrap(response: unknown): unknown {
    const envelope = response as { data?: unknown } | null;
    if (envelope && typeof envelope === 'object' && 'data' in envelope) {
      return envelope.data ?? null;
    }
    return response ?? null;
  }

  private readJobId(response: unknown): string | null {
    const payload = this.unwrap(response) as { job_id?: string } | null;
    return payload?.job_id ?? null;
  }

  private messageOf(error: unknown): string {
    const candidate = error as {
      error?: { message?: string; error?: { message?: string } };
      message?: string;
    };
    return (
      candidate?.error?.message ??
      candidate?.error?.error?.message ??
      candidate?.message ??
      'La operación no se pudo completar.'
    );
  }
}
