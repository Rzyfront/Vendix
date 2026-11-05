import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import {
  ButtonComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { InstanceComment } from '../interfaces/workflow-ops.interfaces';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';

const MAX_LENGTH = 2000;

/** Comments of a request: chronological list plus "Agregar comentario". */
@Component({
  selector: 'app-workflow-instance-comments',
  standalone: true,
  imports: [FormsModule, ButtonComponent, TextareaComponent],
  template: `
    <ul class="mb-4 flex flex-col gap-3" data-testid="comments" aria-label="Comentarios">
      @for (item of items(); track item.id) {
        <li class="rounded-xl border border-border p-3">
          <p class="text-xs text-text-secondary">
            {{ item.author.name ?? 'Usuario' }} · {{ dateText(item.created_at) }}
          </p>
          <p class="mt-1 whitespace-pre-line break-words text-sm text-text-primary">{{ item.body }}</p>
        </li>
      } @empty {
        <li class="text-sm text-text-secondary">Aún no hay comentarios.</li>
      }
    </ul>
    <app-textarea
      label="Comentario"
      placeholder="Escribe un comentario para quienes siguen esta solicitud"
      [rows]="3"
      [error]="error() || undefined"
      [ngModel]="draft()"
      (ngModelChange)="onDraft($event)"
    />
    <div class="mt-2 flex justify-end">
      <app-button
        variant="outline"
        size="sm"
        [loading]="sending()"
        [disabled]="!draft().trim()"
        (clicked)="send()"
      >
        Agregar comentario
      </app-button>
    </div>
  `,
})
export class WorkflowInstanceCommentsComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly instanceId = input.required<number>();
  /** Comments from the detail (last 50, oldest first). */
  readonly comments = input<InstanceComment[]>([]);

  readonly items = signal<InstanceComment[]>([]);
  readonly draft = signal('');
  readonly error = signal('');
  readonly sending = signal(false);

  constructor() {
    effect(() => {
      const incoming = this.comments();
      untracked(() => this.items.set(incoming));
    });
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  onDraft(value: string | null): void {
    this.draft.set(value ?? '');
    this.error.set('');
  }

  send(): void {
    const body = this.draft().trim();
    if (!body || this.sending()) return;
    if (body.length > MAX_LENGTH) {
      this.error.set(`El comentario no puede superar ${MAX_LENGTH} caracteres.`);
      return;
    }
    this.sending.set(true);
    this.api
      .addComment(this.instanceId(), body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (comment) => {
          this.sending.set(false);
          this.items.update((list) => [...list, comment]);
          this.draft.set('');
          this.toast.success('Comentario agregado');
        },
        error: (error) => {
          this.sending.set(false);
          this.error.set(toWorkflowError(error).message);
        },
      });
  }
}
