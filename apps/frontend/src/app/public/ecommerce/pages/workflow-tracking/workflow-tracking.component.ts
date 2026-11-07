import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { uploadInChunks } from '../workflow-public-form/workflow-chunked-upload';
import {
  TrackingPendingItem,
  TrackingStatus,
  TrackingView,
  WorkflowTrackingService,
} from './workflow-tracking.service';

type PageState = 'loading' | 'ready' | 'not_found' | 'error';

interface UploadState {
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

export const TRACKING_STATUS_LABELS: Record<TrackingStatus, string> = {
  active: 'En proceso',
  completed: 'Completada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
  failed: 'En revisión',
};

export const TRACKING_MESSAGE_MAX = 2000;
const DEFAULT_MAX_FILE_MB = 10;

/**
 * Tracking portal of the external requester (`/flujos/seguimiento/:token`):
 * status, public timeline, "Falta: <documento>" with chunked upload and a reply
 * box. No login; mobile-first. A revoked, expired or unknown link says so.
 */
@Component({
  selector: 'app-workflow-tracking',
  standalone: true,
  imports: [DatePipe, FormsModule, TextareaComponent],
  template: `
    <main class="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
      @switch (state()) {
        @case ('loading') {
          <p class="py-10 text-center text-text-secondary" role="status">Cargando seguimiento...</p>
        }
        @case ('not_found') {
          <h1 class="text-xl font-semibold text-text-primary">Este enlace no está disponible</h1>
          <p class="mt-2 text-text-secondary">
            Puede haber vencido o haber sido desactivado. Pide a la tienda un enlace nuevo.
          </p>
        }
        @case ('error') {
          <h1 class="text-xl font-semibold text-text-primary">No pudimos cargar el seguimiento</h1>
          <p class="mt-2 text-text-secondary" role="alert">{{ errorMessage() }}</p>
        }
        @default {
          @if (view(); as v) {
            <p class="text-sm text-text-secondary">{{ v.store.name }}</p>
            <h1 class="mt-1 text-2xl font-semibold text-text-primary">{{ v.flow.name }}</h1>

            <section class="mt-5 rounded-2xl border border-border bg-surface p-4" aria-label="Estado">
              <p class="text-xs uppercase tracking-wide text-text-secondary">Referencia</p>
              <p class="break-all text-xl font-bold text-primary" data-testid="reference">{{ v.reference }}</p>
              <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-text-secondary">Estado</dt>
                  <dd class="font-semibold text-text-primary" data-testid="status">{{ statusLabel(v.status) }}</dd>
                </div>
                @if (v.current_stage) {
                  <div>
                    <dt class="text-text-secondary">Etapa actual</dt>
                    <dd class="font-semibold text-text-primary">{{ v.current_stage.name }}</dd>
                  </div>
                }
                <div>
                  <dt class="text-text-secondary">Recibida</dt>
                  <dd class="text-text-primary">{{ v.started_at | date: 'dd/MM/yyyy HH:mm' }}</dd>
                </div>
                @if (v.completed_at) {
                  <div>
                    <dt class="text-text-secondary">Cerrada</dt>
                    <dd class="text-text-primary">{{ v.completed_at | date: 'dd/MM/yyyy HH:mm' }}</dd>
                  </div>
                } @else {
                  <div>
                    <dt class="text-text-secondary">En esta etapa desde</dt>
                    <dd class="text-text-primary">{{ v.entered_at | date: 'dd/MM/yyyy HH:mm' }}</dd>
                  </div>
                }
              </dl>
            </section>

            @if (v.pending.length > 0) {
              <section class="mt-5 flex flex-col gap-3" aria-label="Lo que falta">
                @for (item of v.pending; track item.key) {
                  <div class="rounded-2xl border border-border bg-surface p-4" [attr.data-pending]="item.key">
                    <p class="font-semibold text-text-primary">Falta: {{ item.label }}</p>
                    @if (uploads()[item.key]; as up) {
                      <p class="mt-2 truncate text-sm text-text-primary">{{ up.name }}</p>
                      @if (up.status === 'uploading') {
                        <div class="mt-2 h-2 overflow-hidden rounded-full bg-background" role="progressbar"
                          aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="up.progress">
                          <div class="h-full bg-primary transition-all" [style.width.%]="up.progress"></div>
                        </div>
                        <p class="mt-1 text-xs text-text-secondary" role="status">Subiendo... {{ up.progress }}%</p>
                      } @else if (up.status === 'error') {
                        <p class="mt-1 text-xs text-error" role="alert">{{ up.error }}</p>
                      }
                    }
                    @if (uploads()[item.key]?.status !== 'uploading') {
                      <label class="mt-3 flex h-12 cursor-pointer items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-white">
                        {{ uploads()[item.key]?.status === 'error' ? 'Intentar de nuevo' : 'Subir documento' }}
                        <input type="file" class="sr-only" [attr.accept]="acceptOf(item)"
                          (change)="onFile(item, $event)" />
                      </label>
                    }
                  </div>
                }
              </section>
            }
            @if (notice()) {
              <p class="mt-4 rounded-xl bg-background p-3 text-sm text-[var(--color-success)]" role="status">{{ notice() }}</p>
            }

            <section class="mt-6" aria-label="Historial">
              <h2 class="text-lg font-semibold text-text-primary">Historial</h2>
              <ol class="mt-3 flex flex-col gap-3 border-l-2 border-border pl-4">
                @for (item of v.timeline; track $index) {
                  <li>
                    <p class="text-sm font-medium text-text-primary">{{ item.label }}</p>
                    @if (item.detail) {
                      <p class="whitespace-pre-line text-sm text-text-secondary">{{ item.detail }}</p>
                    }
                    <p class="text-xs text-text-secondary">{{ item.at | date: 'dd/MM/yyyy HH:mm' }}</p>
                  </li>
                }
              </ol>
            </section>

            @if (v.can_reply) {
              <section class="mt-6 flex flex-col gap-3" aria-label="Responder">
                <h2 class="text-lg font-semibold text-text-primary">Responder a la tienda</h2>
                <app-textarea label="Tu mensaje" [rows]="4" [error]="replyError()"
                  [ngModel]="message()" [ngModelOptions]="{standalone: true}"
                  (ngModelChange)="onMessage($event)" />
                <p class="text-right text-xs text-text-secondary">{{ message().length }}/{{ maxLength }}</p>
                <button
                  type="button"
                  class="h-12 w-full rounded-xl bg-primary px-4 text-base font-semibold text-white disabled:opacity-60"
                  [disabled]="sending()"
                  (click)="sendReply()"
                >
                  {{ sending() ? 'Enviando...' : 'Enviar respuesta' }}
                </button>
              </section>
            }
          }
        }
      }
    </main>
  `,
})
export class WorkflowTrackingComponent implements OnInit {
  private readonly api = inject(WorkflowTrackingService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private token = '';

  readonly state = signal<PageState>('loading');
  readonly view = signal<TrackingView | null>(null);
  readonly errorMessage = signal('');
  readonly uploads = signal<Record<string, UploadState>>({});
  readonly notice = signal('');
  readonly message = signal('');
  readonly replyError = signal('');
  readonly sending = signal(false);
  readonly maxLength = TRACKING_MESSAGE_MAX;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.load();
  }

  statusLabel(status: TrackingStatus): string {
    return TRACKING_STATUS_LABELS[status] ?? status;
  }

  acceptOf(item: TrackingPendingItem): string | null {
    return item.accept?.length ? item.accept.join(',') : null;
  }

  onMessage(value: string | null): void {
    this.message.set(value ?? '');
    this.replyError.set('');
  }

  onFile(item: TrackingPendingItem, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const key = item.key;
    const set = (state: UploadState) => this.uploads.update((c) => ({ ...c, [key]: state }));
    const fail = (error: string) => set({ name: file.name, progress: 0, status: 'error', error });
    this.notice.set('');
    if (!file.type) return fail('No reconocemos el tipo de este archivo.');
    const maxMb = item.max_size_mb ?? DEFAULT_MAX_FILE_MB;
    if (file.size > maxMb * 1024 * 1024) return fail(`El archivo supera el máximo de ${maxMb} MB.`);
    set({ name: file.name, progress: 0, status: 'uploading' });
    uploadInChunks(file, this.api.uploader(this.token, key), {
      onProgress: (progress) => set({ name: file.name, progress, status: 'uploading' }),
    })
      .then(() => {
        this.uploads.update((c) => {
          const next = { ...c };
          delete next[key];
          return next;
        });
        this.notice.set(`Recibimos "${item.label}". Gracias.`);
        this.load(false);
      })
      .catch((error: unknown) =>
        fail(error instanceof HttpErrorResponse ? this.messageOf(error) : 'No pudimos subir el archivo.'),
      );
  }

  sendReply(): void {
    if (this.sending()) return;
    const text = this.message().trim();
    if (!text) {
      this.replyError.set('Escribe tu mensaje.');
      return;
    }
    if (text.length > TRACKING_MESSAGE_MAX) {
      this.replyError.set(`El mensaje puede tener hasta ${TRACKING_MESSAGE_MAX} caracteres.`);
      return;
    }
    this.sending.set(true);
    this.api
      .reply(this.token, text)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.sending.set(false);
          this.message.set('');
          this.notice.set('Enviamos tu respuesta.');
          this.load(false);
        },
        error: (error: HttpErrorResponse) => {
          this.sending.set(false);
          if (error.status === 404) this.state.set('not_found');
          else this.replyError.set(this.messageOf(error));
        },
      });
  }

  private load(showSpinner = true): void {
    if (showSpinner) this.state.set('loading');
    this.api
      .get(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => {
          this.view.set(view);
          this.state.set('ready');
        },
        error: (error: HttpErrorResponse) => {
          if (error.status === 404) this.state.set('not_found');
          else {
            this.errorMessage.set(this.messageOf(error));
            this.state.set('error');
          }
        },
      });
  }

  private messageOf(error: HttpErrorResponse): string {
    if (error.status === 429) return 'Demasiados intentos; espera un minuto.';
    if (error.status === 0) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
    return parseApiError(error).userMessage;
  }
}
