import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  ToastService,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import {
  TrackingLinkRow,
  TrackingLinkState,
  WorkflowLinksApiService,
} from '../services/workflow-links-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';

const STATE_LABEL: Record<TrackingLinkState, string> = {
  active: 'Activo',
  revoked: 'Revocado',
  expired: 'Vencido',
};

/**
 * "Enlaces de seguimiento": the magic links the external requester received
 * (one per submission). The token is never shown; an admin can revoke it.
 * Hidden when there are none or the user cannot manage the request (403).
 */
@Component({
  selector: 'app-tracking-links-card',
  standalone: true,
  imports: [CardComponent, BadgeComponent, ButtonComponent],
  template: `
    @if (visible()) {
      <app-card title="Enlaces de seguimiento" [responsivePadding]="true">
        <ul class="flex flex-col gap-2" data-testid="tracking-links">
          @for (link of links(); track link.id) {
            <li class="flex flex-col gap-1 rounded-xl border border-border p-2">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-sm font-medium text-text-primary">
                  {{ link.contact_name || 'Sin nombre' }}
                  @if (link.contact_email) {
                    <span class="text-xs font-normal text-text-secondary"> · {{ link.contact_email }}</span>
                  }
                </span>
                <app-badge [variant]="tone(link.state)" size="xs">{{ stateLabel(link.state) }}</app-badge>
              </div>
              <p class="text-xs text-text-secondary">
                Vence: {{ dateText(link.expires_at) }}
                · Último uso: {{ link.last_used_at ? dateText(link.last_used_at) : 'sin uso' }}
              </p>
              @if (link.state === 'active') {
                <div class="flex justify-end">
                  <app-button variant="outline-danger" size="xsm" [loading]="busyId() === link.id"
                    (clicked)="revoke(link)">
                    Revocar
                  </app-button>
                </div>
              }
            </li>
          }
        </ul>
      </app-card>
    }
  `,
})
export class TrackingLinksCardComponent {
  private readonly api = inject(WorkflowLinksApiService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly instanceId = input.required<number>();

  readonly links = signal<TrackingLinkRow[]>([]);
  readonly visible = signal(false);
  readonly busyId = signal<number | null>(null);

  constructor() {
    effect(() => {
      const id = this.instanceId();
      untracked(() => this.load(id));
    });
  }

  stateLabel(state: TrackingLinkState): string {
    return STATE_LABEL[state];
  }

  tone(state: TrackingLinkState): 'success' | 'neutral' | 'warning' {
    return state === 'active' ? 'success' : state === 'expired' ? 'warning' : 'neutral';
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  async revoke(link: TrackingLinkRow): Promise<void> {
    if (this.busyId() !== null) return;
    const confirmed = await this.dialog.confirm({
      title: 'Revocar enlace de seguimiento',
      message: 'La persona ya no podrá ver su solicitud ni enviar documentos con este enlace. ¿Revocarlo?',
      confirmText: 'Revocar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.busyId.set(link.id);
    this.api
      .revokeTrackingLink(this.instanceId(), link.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.links.update((rows) =>
            rows.map((r) =>
              r.id === link.id ? { ...r, state: 'revoked', revoked_at: new Date().toISOString() } : r,
            ),
          );
          this.toast.success('Enlace revocado');
        },
        error: (error: unknown) => {
          this.busyId.set(null);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  private load(id: number): void {
    this.api
      .listTrackingLinks(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.links.set(rows);
          this.visible.set(rows.length > 0);
        },
        error: (error: unknown) => {
          // 403: the user may see the request but not manage it; nothing to show.
          this.visible.set(false);
          if (!(error instanceof HttpErrorResponse && error.status === 403)) {
            this.toast.error(toWorkflowError(error).message);
          }
        },
      });
  }
}
