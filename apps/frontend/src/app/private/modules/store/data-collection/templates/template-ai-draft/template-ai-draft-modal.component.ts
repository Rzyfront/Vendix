import { ChangeDetectionStrategy, Component, DestroyRef, inject, model, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, catchError, exhaustMap, map, of, timer } from 'rxjs';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { DataCollectionTemplatesService } from '../../services/data-collection-templates.service';
import { readImportServerError } from '../../utils/template-json-import.util';
import {
  AI_DRAFT_ACCEPT,
  AI_DRAFT_MAX_TRANSIENT_RETRIES,
  AI_DRAFT_POLL_INTERVAL_MS,
  AI_DRAFT_POLL_TIMEOUT_MS,
  AiDraftPathError,
  AiDraftStatusResponse,
  isTransientPollError,
  mapAiDraftStatus,
  validateAiDraftFile,
} from '../../utils/template-ai-draft.util';

type Phase = 'idle' | 'uploading' | 'reading' | 'failed';

/**
 * "Crear con IA (PDF/foto)": uploads one file, polls the AI draft job (bounded
 * and cancelable) and emits the JSON draft for the "Crear desde JSON" modal.
 */
@Component({
  selector: 'app-template-ai-draft-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalOpenChange($event)"
      title="Crear plantilla con IA"
      subtitle="Sube un PDF o una foto del formulario en papel. La IA propone un borrador que podrás revisar antes de importarlo."
      size="md"
    >
      <div class="space-y-4">
        @switch (phase()) {
          @case ('idle') {
            <p class="text-sm" style="color: var(--color-text-muted)">
              Formatos: PDF, JPG, PNG o WEBP. Máximo 10 MB.
            </p>
            <app-button variant="outline" (clicked)="fileInput.click()">
              <app-icon name="upload" [size]="16" slot="icon"></app-icon>
              Elegir archivo
            </app-button>
          }
          @case ('uploading') {
            <div class="flex items-center gap-3" role="status">
              <app-spinner size="sm" />
              <span class="text-sm" style="color: var(--color-text)">Subiendo el archivo…</span>
            </div>
          }
          @case ('reading') {
            <div class="flex items-center gap-3" role="status" aria-live="polite">
              <app-spinner size="sm" />
              <div>
                <p class="text-sm font-medium" style="color: var(--color-text)">Leyendo el formulario…</p>
                <p class="text-xs" style="color: var(--color-text-muted)">
                  Pueden pasar hasta un par de minutos · {{ elapsedSeconds() }} s
                </p>
              </div>
            </div>
          }
          @case ('failed') {
            <div class="rounded-xl p-3" role="alert" style="border: 1px solid var(--color-error)">
              <p class="text-sm" style="color: var(--color-error)">{{ errorMessage() }}</p>
            </div>
            <app-button variant="outline" (clicked)="reset()">Intentar con otro archivo</app-button>
          }
        }
        @if (phase() === 'idle' && errorMessage()) {
          <p class="text-sm" role="alert" style="color: var(--color-error)">{{ errorMessage() }}</p>
        }
        <input
          #fileInput
          type="file"
          class="hidden"
          [accept]="accept"
          (change)="onFileSelected($event)"
        />
      </div>

      <div slot="footer" class="flex flex-col-reverse sm:flex-row justify-end gap-2">
        <app-button variant="outline" (clicked)="cancel()">Cancelar</app-button>
      </div>
    </app-modal>
  `,
})
export class TemplateAiDraftModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(DataCollectionTemplatesService);

  readonly isOpen = model<boolean>(false);
  /** Emitted with the draft text and server-flagged errors when the job is done. */
  readonly draftReady = output<{ text: string; errors: AiDraftPathError[] }>();

  readonly accept = AI_DRAFT_ACCEPT;
  readonly phase = signal<Phase>('idle');
  readonly errorMessage = signal('');
  readonly elapsedSeconds = signal(0);

  private uploadSub?: Subscription;
  private pollSub?: Subscription;
  private tickSub?: Subscription;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopAll());
  }

  onModalOpenChange(open: boolean): void {
    if (!open) this.stopAll();
    this.isOpen.set(open);
  }

  cancel(): void {
    this.stopAll();
    this.isOpen.set(false);
  }

  reset(): void {
    this.stopAll();
    this.errorMessage.set('');
    this.phase.set('idle');
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const check = validateAiDraftFile(file);
    if (!check.ok) {
      this.errorMessage.set(check.message);
      return;
    }
    this.errorMessage.set('');
    this.phase.set('uploading');
    this.uploadSub = this.service.startAiDraft(file).subscribe({
      next: ({ job_id }) => this.startPolling(job_id),
      error: (err) => this.fail(readImportServerError(err).message),
    });
  }

  private startPolling(jobId: string): void {
    const startedAt = Date.now();
    let transientFailures = 0;
    this.elapsedSeconds.set(0);
    this.phase.set('reading');
    this.tickSub = timer(1000, 1000).subscribe(() =>
      this.elapsedSeconds.set(Math.floor((Date.now() - startedAt) / 1000)),
    );
    this.pollSub = timer(0, AI_DRAFT_POLL_INTERVAL_MS)
      .pipe(
        exhaustMap(() =>
          this.service.getAiDraftStatus(jobId).pipe(
            map((res) => ({ res }) as { res?: AiDraftStatusResponse; err?: unknown }),
            catchError((err: unknown) => of({ err } as { res?: AiDraftStatusResponse; err?: unknown })),
          ),
        ),
      )
      .subscribe(({ res, err }) => {
        if (err !== undefined) {
          const status = err instanceof HttpErrorResponse ? err.status : undefined;
          if (status === 404) return this.fail('El borrador ya no está disponible. Vuelve a intentarlo.');
          if (isTransientPollError(status) && ++transientFailures <= AI_DRAFT_MAX_TRANSIENT_RETRIES) return;
          return this.fail(readImportServerError(err).message);
        }
        transientFailures = 0;
        const state = mapAiDraftStatus(res as AiDraftStatusResponse);
        if (state.kind === 'done') {
          this.stopAll();
          this.draftReady.emit({ text: state.text, errors: state.errors });
          this.isOpen.set(false);
        } else if (state.kind === 'failed') {
          this.fail(state.message);
        } else if (Date.now() - startedAt >= AI_DRAFT_POLL_TIMEOUT_MS) {
          this.fail('La IA tardó demasiado en responder. Inténtalo de nuevo con un archivo más claro o más corto.');
        }
      });
  }

  private fail(message: string): void {
    this.stopAll();
    this.errorMessage.set(message);
    this.phase.set('failed');
  }

  private stopAll(): void {
    this.uploadSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.tickSub?.unsubscribe();
    this.uploadSub = this.pollSub = this.tickSub = undefined;
  }
}
