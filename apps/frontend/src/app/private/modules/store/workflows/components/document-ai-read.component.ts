import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import { WorkflowFieldDef } from '../../../../../shared/workflows/contract/workflow-contract';
import {
  DocumentCheck,
  DocumentChecksApiService,
} from '../services/document-checks-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';
import {
  AiAppliedResult,
  applyCheck,
  conflictingKeys,
  docTypeLabel,
  isAiQuotaCode,
  legibilityLabel,
  readableFields,
} from './document-ai-read.util';

/**
 * "Leer con IA" next to a file of the dossier: reads it, fills the EMPTY form
 * fields (asks before replacing what the person already typed) and reports the
 * document type, legibility and whether it matches the request. The parent
 * form applies `applied` (values + confidence hints).
 */
@Component({
  selector: 'app-document-ai-read',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  template: `
    <div class="flex flex-col gap-2" data-testid="document-ai-read">
      <div class="flex flex-wrap items-center gap-2">
        <app-button
          variant="outline"
          size="sm"
          [loading]="reading()"
          [disabled]="!canRead()"
          (clicked)="read()"
        >
          <app-icon name="sparkles" [size]="14" slot="icon" />
          {{ reading() ? 'Leyendo documento…' : 'Leer con IA' }}
        </app-button>
        @if (reading()) {
          <span class="text-xs text-text-secondary" role="status"
            >Esto puede tardar unos segundos.</span
          >
        }
      </div>

      @if (quotaExhausted()) {
        <div
          class="flex items-start gap-2 rounded-lg bg-warning-light p-3 text-sm text-warning"
          role="alert"
          data-testid="ai-quota-notice"
        >
          <app-icon name="alert-triangle" [size]="16" />
          <span
            >Se agotó el cupo de IA de tu plan. Puedes escribir los datos a
            mano o ampliar el plan para seguir leyendo documentos.</span
          >
        </div>
      } @else if (error()) {
        <p class="text-sm text-error" role="alert">{{ error() }}</p>
      }

      @if (pending(); as p) {
        <div
          class="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
          role="alertdialog"
          data-testid="ai-overwrite-prompt"
        >
          <span class="text-text-primary"
            >Ya escribiste en {{ conflicts().length === 1 ? 'un campo' : conflicts().length + ' campos' }}
            ({{ conflictLabels() }}). ¿Quieres reemplazarlos con lo que leyó la IA?</span
          >
          <div class="flex flex-wrap gap-2">
            <app-button size="sm" variant="primary" (clicked)="resolve(true)"
              >Reemplazar</app-button
            >
            <app-button size="sm" variant="outline" (clicked)="resolve(false)"
              >Conservar lo escrito</app-button
            >
          </div>
        </div>
      }

      @if (check(); as c) {
        <div
          class="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm"
          data-testid="ai-read-summary"
        >
          <span class="text-text-primary">
            Documento detectado: <strong>{{ docType() }}</strong> · Legibilidad
            {{ legibility() }}
          </span>
          @if (c.result.matches_request === true) {
            <span class="flex items-center gap-1 text-text-secondary">
              <app-icon name="check-circle" [size]="14" /> Coincide con la
              solicitud.
            </span>
          } @else if (c.result.matches_request === false) {
            <span class="text-warning" role="alert">
              No coincide con la solicitud
              @if (c.result.mismatch_reasons.length) {
                : {{ c.result.mismatch_reasons.join('; ') }}
              }
            </span>
          } @else {
            <span class="text-text-secondary"
              >No se pudo comparar con la solicitud.</span
            >
          }
          @if (c.result.unread_keys.length) {
            <span class="text-text-secondary"
              >Sin valor legible: {{ unreadLabels() }}.</span
            >
          }
          @if (c.verdict === 'needs_review' || c.verdict === 'fail') {
            <span class="text-warning"
              >Revísalo antes de continuar: la IA nunca decide sola.</span
            >
          }
          @if (c.cached) {
            <span class="text-xs text-text-secondary"
              >Resultado guardado de una lectura anterior: no consumió cupo de
              IA.</span
            >
          }
          <div class="flex items-center gap-2">
            @if (c.reviewed_at) {
              <span class="text-xs text-text-secondary">Revisado</span>
            } @else {
              <app-button
                size="sm"
                variant="ghost"
                [loading]="reviewing()"
                (clicked)="markReviewed()"
                >Marcar como revisado</app-button
              >
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class DocumentAiReadComponent {
  private readonly api = inject(DocumentChecksApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Request that owns the file. */
  readonly instanceId = input.required<number>();
  /** Dossier file to read (null while nothing is uploaded). */
  readonly fileId = input<number | null>(null);
  /** Fields of the stage form; only the readable ones are requested. */
  readonly fields = input<WorkflowFieldDef[]>([]);
  /** What the form holds right now (never overwritten without asking). */
  readonly values = input<Record<string, unknown>>({});

  readonly applied = output<AiAppliedResult>();

  readonly reading = signal(false);
  readonly reviewing = signal(false);
  readonly check = signal<DocumentCheck | null>(null);
  readonly pending = signal<DocumentCheck | null>(null);
  readonly error = signal<string | null>(null);
  readonly quotaExhausted = signal(false);

  private readonly readable = computed(() => readableFields(this.fields()));
  readonly canRead = computed(
    () => this.fileId() !== null && this.readable().length > 0 && !this.reading(),
  );
  readonly conflicts = computed(() => {
    const p = this.pending();
    return p ? conflictingKeys(p, this.values()) : [];
  });
  readonly conflictLabels = computed(() => this.labelsOf(this.conflicts()));
  readonly unreadLabels = computed(() =>
    this.labelsOf(this.check()?.result.unread_keys ?? []),
  );
  readonly docType = computed(() => docTypeLabel(this.check()?.result.doc_type ?? null));
  readonly legibility = computed(() => {
    const l = this.check()?.result.legibility;
    return l ? legibilityLabel(l) : '';
  });

  read(): void {
    const fileId = this.fileId();
    if (fileId === null || !this.canRead()) return;
    this.reading.set(true);
    this.error.set(null);
    this.quotaExhausted.set(false);
    this.pending.set(null);
    this.api
      .read(fileId, {
        instance_id: this.instanceId(),
        field_keys: this.readable().map((f) => f.key),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (check) => {
          this.reading.set(false);
          this.check.set(check);
          if (conflictingKeys(check, this.values()).length > 0) {
            this.pending.set(check);
          } else {
            this.applied.emit(applyCheck(check, this.values(), false));
          }
        },
        error: (err) => {
          this.reading.set(false);
          const parsed = toWorkflowError(err);
          if (isAiQuotaCode(parsed.code)) this.quotaExhausted.set(true);
          else this.error.set(parsed.message);
        },
      });
  }

  /** Answer to "¿reemplazar lo escrito?": fills the empty ones either way. */
  resolve(replace: boolean): void {
    const check = this.pending();
    if (!check) return;
    this.pending.set(null);
    this.applied.emit(applyCheck(check, this.values(), replace));
  }

  markReviewed(): void {
    const check = this.check();
    if (!check) return;
    this.reviewing.set(true);
    this.api
      .review(check.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.reviewing.set(false);
          this.check.set({ ...check, reviewed_at: updated.reviewed_at });
        },
        error: (err) => {
          this.reviewing.set(false);
          this.error.set(toWorkflowError(err).message);
        },
      });
  }

  private labelsOf(keys: string[]): string {
    const all = this.fields();
    return keys.map((k) => all.find((f) => f.key === k)?.label ?? k).join(', ');
  }
}
