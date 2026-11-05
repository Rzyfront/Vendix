import { Component, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  MultiSelectorComponent,
} from '../../../../../../shared/components/index';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { WebhookRow, WebhookWithSecret } from '../interfaces/integrations.interfaces';
import { IntegrationsApiService } from '../services/integrations-api.service';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABEL } from '../utils/integrations-labels.util';

/** Create / edit modal of an outgoing webhook endpoint. */
@Component({
  selector: 'app-webhook-form-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent, MultiSelectorComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" [title]="webhook() ? 'Editar webhook' : 'Nuevo webhook'" size="md">
      <div class="flex flex-col gap-4">
        <app-input
          label="URL de destino"
          [required]="true"
          placeholder="https://tu-sistema.com/webhooks/vendix"
          helperText="Debe ser https y pública."
          [ngModel]="url()"
          (ngModelChange)="url.set($event)"
        />
        <app-multi-selector
          label="Eventos"
          [required]="true"
          placeholder="Elige los eventos"
          [options]="eventOptions"
          [ngModel]="events()"
          (ngModelChange)="onEvents($event)"
        />
        <app-input
          label="Descripción (opcional)"
          [ngModel]="description()"
          (ngModelChange)="description.set($event)"
        />
        @if (errorMessage()) {
          <p class="text-sm text-error" role="alert">{{ errorMessage() }}</p>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="busy()" [disabled]="!canSubmit()" (clicked)="submit()">
          {{ webhook() ? 'Guardar' : 'Crear webhook' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class WebhookFormModalComponent {
  private readonly api = inject(IntegrationsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly webhook = input<WebhookRow | null>(null);
  /** Emits the created endpoint (with its secret) or the updated one (no secret). */
  readonly created = output<WebhookWithSecret>();
  readonly updated = output<WebhookRow>();

  readonly eventOptions = WEBHOOK_EVENTS.map((e) => ({ value: e, label: WEBHOOK_EVENT_LABEL[e] }));
  readonly url = signal('');
  readonly events = signal<string[]>([]);
  readonly description = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const hook = this.webhook();
      if (!open) return;
      untracked(() => {
        this.url.set(hook?.url ?? '');
        this.events.set(hook?.event_types ?? []);
        this.description.set(hook?.description ?? '');
        this.errorMessage.set('');
      });
    });
  }

  onEvents(value: (string | number)[] | null): void {
    this.events.set((value ?? []).map(String));
  }

  canSubmit(): boolean {
    return this.url().trim().length > 0 && this.events().length > 0 && !this.busy();
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const current = this.webhook();
    const description = this.description().trim();
    this.busy.set(true);
    this.errorMessage.set('');
    const fail = (error: unknown) => {
      this.busy.set(false);
      this.errorMessage.set(toWorkflowError(error).message);
    };
    if (current) {
      this.api
        .updateWebhook(current.id, {
          url: this.url().trim(),
          event_types: this.events(),
          description,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (row) => {
            this.busy.set(false);
            this.isOpen.set(false);
            this.updated.emit(row);
          },
          error: fail,
        });
      return;
    }
    this.api
      .createWebhook({
        url: this.url().trim(),
        event_types: this.events(),
        ...(description ? { description } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (row) => {
          this.busy.set(false);
          this.isOpen.set(false);
          this.created.emit(row);
        },
        error: fail,
      });
  }
}
