import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  ConfirmationModalComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmSegmentsService } from '../shared/crm-segments.service';
import {
  CampaignEstimate,
  CampaignRecipient,
  CampaignRecipientStatus,
  CrmCampaignDetail,
} from '../shared/crm-segments.interface';
import { formatDateTime } from '../shared/crm.utils';
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_STATUS_META,
  customerName,
  formatUsd,
} from './segments.utils';

const PAGE_SIZE = 25;

const RECIPIENT_STATUS: Record<CampaignRecipientStatus, { label: string; variant: 'neutral' | 'info' | 'success' | 'error' }> = {
  queued: { label: 'En cola', variant: 'neutral' },
  sent: { label: 'Enviado', variant: 'info' },
  delivered: { label: 'Entregado', variant: 'info' },
  read: { label: 'Leído', variant: 'success' },
  failed: { label: 'Fallido', variant: 'error' },
};

/**
 * Campaign detail: delivery funnel (sent, delivered, read, failed, opt-outs),
 * recipients, and the actions its status allows (confirm the cost and send a
 * draft; cancel a draft, scheduled or sending campaign).
 */
@Component({
  selector: 'app-crm-campaign-detail-modal',
  standalone: true,
  imports: [
    FormsModule,
    BadgeComponent,
    ButtonComponent,
    ConfirmationModalComponent,
    IconComponent,
    ModalComponent,
    SpinnerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      [title]="campaign()?.name ?? 'Campaña'"
      [subtitle]="subtitle()"
      size="lg"
      [fullScreenOnMobile]="true"
    >
      @if (loading() && !campaign()) {
        <div class="flex justify-center py-10"><app-spinner></app-spinner></div>
      } @else if (campaign(); as c) {
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-2">
            <app-badge [variant]="statusMeta(c.status).variant">{{ statusMeta(c.status).label }}</app-badge>
            @if (c.scheduled_at && c.status === 'scheduled') {
              <span class="text-xs text-[var(--color-text-secondary)]">Sale el {{ dateTime(c.scheduled_at) }}</span>
            }
            <app-button variant="ghost" size="sm" class="ml-auto" [loading]="loading()" (clicked)="reload()">
              <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
              Actualizar
            </app-button>
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            @for (metric of metrics(); track metric.label) {
              <div class="rounded-2xl border border-[var(--color-border)] p-3">
                <p class="text-xs text-[var(--color-text-secondary)]">{{ metric.label }}</p>
                <p class="text-xl font-semibold text-[var(--color-text-primary)]">{{ metric.value }}</p>
              </div>
            }
          </div>

          @if (failureReasons().length) {
            <div class="text-sm text-[var(--color-text-secondary)]">
              <p class="mb-1 font-medium text-[var(--color-text-primary)]">Motivos de fallo</p>
              <ul class="flex flex-col gap-0.5" role="list">
                @for (reason of failureReasons(); track reason[0]) {
                  <li>{{ reason[0] }}: <strong>{{ reason[1] }}</strong></li>
                }
              </ul>
            </div>
          }

          @if (c.status === 'draft') {
            <div class="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] p-3">
              @if (!estimate()) {
                <p class="text-sm text-[var(--color-text-secondary)]">
                  Esta campaña es un borrador. Revisa el costo para confirmarla.
                </p>
                <div>
                  <app-button variant="primary" size="sm" [loading]="busy()" (clicked)="loadEstimate()">
                    Revisar costo y enviar
                  </app-button>
                </div>
              } @else {
                @let est = estimate()!;
                <p class="text-sm text-[var(--color-text-primary)]">
                  <strong>{{ est.recipients }}</strong> destinatarios · costo estimado
                  <strong>{{ usd(est.estimated_cost) }}</strong>
                  @if (est.channel === 'sms' && est.spend_remaining !== null) {
                    · saldo del tope de SMS {{ usd(est.spend_remaining) }}
                  }
                </p>
                <p class="text-xs text-[var(--color-text-secondary)]">
                  Excluidos: {{ est.excluded_no_consent }} por consentimiento,
                  {{ est.excluded_no_address }} sin dirección, {{ est.excluded_duplicate }} duplicados.
                </p>
                @if (costChanged()) {
                  <p class="text-sm text-[var(--color-text-primary)]" role="alert">
                    El costo cambió. Revisa la nueva estimación y vuelve a confirmarla.
                  </p>
                }
                @if (est.recipients === 0 || est.exceeds_max_recipients || est.exceeds_spend_limit) {
                  <p class="text-sm text-[var(--color-error)]" role="alert">
                    @if (est.exceeds_spend_limit) {
                      El costo supera lo que queda del tope mensual de SMS.
                    } @else if (est.exceeds_max_recipients) {
                      La campaña supera el máximo de {{ est.max_recipients }} destinatarios.
                    } @else {
                      Ningún cliente puede recibir esta campaña.
                    }
                  </p>
                } @else {
                  <label class="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                    <input
                      type="checkbox"
                      class="mt-1 h-4 w-4 accent-[var(--color-primary)]"
                      [ngModel]="confirmed()"
                      (ngModelChange)="confirmed.set($event)"
                    />
                    <span>Confirmo el costo estimado de <strong>{{ usd(est.estimated_cost) }}</strong>.</span>
                  </label>
                  <div>
                    <app-button variant="primary" size="sm" [disabled]="!confirmed()" [loading]="busy()" (clicked)="send()">
                      {{ c.scheduled_at ? 'Programar envío' : 'Enviar ahora' }}
                    </app-button>
                  </div>
                }
              }
            </div>
          }

          @if (error()) {
            <p class="text-sm text-[var(--color-error)]" role="alert">{{ error() }}</p>
          }

          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium text-[var(--color-text-primary)]">Destinatarios</span>
              <select
                class="h-9 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm"
                aria-label="Filtrar por estado"
                [ngModel]="statusFilter()"
                (ngModelChange)="statusFilter.set($event)"
              >
                <option value="">Todos</option>
                <option value="queued">En cola</option>
                <option value="sent">Enviados</option>
                <option value="delivered">Entregados</option>
                <option value="read">Leídos</option>
                <option value="failed">Fallidos</option>
              </select>
            </div>
            @if (recipients().length) {
              <ul class="flex flex-col divide-y divide-[var(--color-border)]" role="list">
                @for (row of recipients(); track row.id) {
                  <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                    <span class="font-medium text-[var(--color-text-primary)]">
                      {{ row.customer ? name(row.customer) : 'Sin nombre' }}
                    </span>
                    <span class="text-xs text-[var(--color-text-secondary)]">{{ row.address }}</span>
                    <app-badge [variant]="recipientStatus(row.status).variant">{{ recipientStatus(row.status).label }}</app-badge>
                    @if (row.error_code) {
                      <span class="w-full text-xs text-[var(--color-error)]">{{ row.error_code }}</span>
                    }
                  </li>
                }
              </ul>
              @if (page() < totalPages()) {
                <div class="flex justify-center">
                  <app-button variant="outline" size="sm" [loading]="recipientsLoading()" (clicked)="loadMore()">Cargar más</app-button>
                </div>
              }
            } @else if (!recipientsLoading()) {
              <p class="text-sm text-[var(--color-text-secondary)]">
                {{ c.status === 'draft' ? 'Los destinatarios aparecen cuando se envía.' : 'Sin destinatarios con este filtro.' }}
              </p>
            }
          </div>
        </div>
      } @else if (error()) {
        <p class="text-sm text-[var(--color-error)]" role="alert">{{ error() }}</p>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        @if (campaign() && canCancel()) {
          <app-button variant="danger" size="md" [disabled]="busy()" (clicked)="confirmCancel.set(true)">
            Cancelar campaña
          </app-button>
        }
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cerrar</app-button>
      </div>
    </app-modal>

    <app-confirmation-modal
      [(isOpen)]="confirmCancel"
      title="Cancelar campaña"
      message="Los mensajes que sigan en cola no se enviarán. Los ya enviados no se pueden recuperar."
      confirmText="Cancelar campaña"
      cancelText="Volver"
      confirmVariant="danger"
      (confirm)="cancel()"
    ></app-confirmation-modal>
  `,
})
export class CampaignDetailModalComponent {
  private readonly api = inject(CrmSegmentsService);
  private readonly toast = inject(ToastService);

  readonly isOpen = model(false);
  readonly campaignId = input<number | null>(null);
  /** The campaign was sent, scheduled or cancelled from here. */
  readonly changed = output<void>();

  protected readonly campaign = signal<CrmCampaignDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly estimate = signal<CampaignEstimate | null>(null);
  protected readonly confirmed = signal(false);
  protected readonly costChanged = signal(false);
  protected readonly confirmCancel = signal(false);

  protected readonly recipients = signal<CampaignRecipient[]>([]);
  protected readonly recipientsLoading = signal(false);
  protected readonly page = signal(1);
  protected readonly totalPages = signal(1);
  protected readonly statusFilter = signal<'' | CampaignRecipientStatus>('');

  protected readonly usd = formatUsd;
  protected readonly dateTime = formatDateTime;
  protected readonly name = customerName;

  protected readonly subtitle = computed(() => {
    const c = this.campaign();
    if (!c) return '';
    const parts = [CAMPAIGN_CHANNEL_LABELS[c.channel]];
    if (c.segment) parts.push(`Segmento: ${c.segment.name}`);
    return parts.join(' · ');
  });

  protected readonly metrics = computed(() => {
    const c = this.campaign();
    if (!c) return [];
    const m = c.metrics;
    return [
      { label: 'Destinatarios', value: c.recipients_total },
      { label: 'Enviados', value: m.sent },
      { label: 'Entregados', value: m.delivered },
      { label: 'Leídos', value: m.read },
      { label: 'Fallidos', value: m.failed },
      { label: 'Bajas', value: m.opted_out },
    ];
  });

  protected readonly failureReasons = computed(() =>
    Object.entries(this.campaign()?.metrics.failed_by_reason ?? {}),
  );

  protected readonly canCancel = computed(() => {
    const status = this.campaign()?.status;
    return status === 'draft' || status === 'scheduled' || status === 'sending';
  });

  constructor() {
    effect(() => {
      const id = this.campaignId();
      if (!this.isOpen() || !id) return;
      untracked(() => {
        this.campaign.set(null);
        this.estimate.set(null);
        this.confirmed.set(false);
        this.costChanged.set(false);
        this.error.set(null);
        this.statusFilter.set('');
        void this.load(id);
      });
    });
    effect(() => {
      this.statusFilter();
      untracked(() => {
        if (this.isOpen() && this.campaignId()) void this.loadRecipients(true);
      });
    });
  }

  protected statusMeta(status: keyof typeof CAMPAIGN_STATUS_META) {
    return CAMPAIGN_STATUS_META[status];
  }

  protected recipientStatus(status: CampaignRecipientStatus) {
    return RECIPIENT_STATUS[status];
  }

  reload(): void {
    const id = this.campaignId();
    if (!id) return;
    void this.load(id);
    void this.loadRecipients(true);
  }

  loadMore(): void {
    void this.loadRecipients(false);
  }

  async loadEstimate(): Promise<void> {
    const id = this.campaignId();
    if (!id || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.estimate.set(await firstValueFrom(this.api.estimateSavedCampaign(id)));
      this.confirmed.set(false);
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
    } finally {
      this.busy.set(false);
    }
  }

  async send(): Promise<void> {
    const id = this.campaignId();
    const cost = this.estimate()?.estimated_cost;
    if (!id || cost === undefined || !this.confirmed() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const sent = await firstValueFrom(this.api.sendCampaign(id, cost));
      this.toast.success(sent.status === 'scheduled' ? 'Campaña programada' : 'Envío iniciado');
      this.campaign.set(sent);
      this.estimate.set(null);
      this.changed.emit();
      void this.loadRecipients(true);
    } catch (error) {
      const parsed = parseApiError(error);
      const fresh = (parsed.details as { estimated_cost?: unknown } | null)?.estimated_cost;
      if (parsed.errorCode === 'CRM_CAMPAIGN_003' && typeof fresh === 'number') {
        this.estimate.update((est) => (est ? { ...est, estimated_cost: fresh } : est));
        this.confirmed.set(false);
        this.costChanged.set(true);
      } else {
        this.error.set(parsed.userMessage);
      }
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(): Promise<void> {
    const id = this.campaignId();
    if (!id || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.campaign.set(await firstValueFrom(this.api.cancelCampaign(id)));
      this.estimate.set(null);
      this.toast.success('Campaña cancelada');
      this.changed.emit();
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: number): Promise<void> {
    this.loading.set(true);
    try {
      const detail = await firstValueFrom(this.api.campaign(id));
      if (this.campaignId() === id) this.campaign.set(detail);
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadRecipients(reset: boolean): Promise<void> {
    const id = this.campaignId();
    if (!id) return;
    this.recipientsLoading.set(true);
    try {
      const page = reset ? 1 : this.page() + 1;
      const status = this.statusFilter();
      const result = await firstValueFrom(
        this.api.campaignRecipients(id, { page, limit: PAGE_SIZE, ...(status ? { status } : {}) }),
      );
      this.recipients.update((rows) => (reset ? result.data : [...rows, ...result.data]));
      this.page.set(result.page);
      this.totalPages.set(result.totalPages);
    } catch {
      // The funnel above still shows the campaign; the list stays as it was.
    } finally {
      this.recipientsLoading.set(false);
    }
  }
}
