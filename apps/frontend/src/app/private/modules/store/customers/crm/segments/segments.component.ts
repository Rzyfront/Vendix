import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  ScrollableTabsComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { ScrollableTab, StickyHeaderActionButton } from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmSegmentsService } from '../shared/crm-segments.service';
import { CrmCampaign, CrmSegment } from '../shared/crm-segments.interface';
import { formatDateTime } from '../shared/crm.utils';
import { CampaignDetailModalComponent } from './campaign-detail-modal.component';
import { CampaignWizardModalComponent } from './campaign-wizard-modal.component';
import { SegmentFormModalComponent } from './segment-form-modal.component';
import { CAMPAIGN_CHANNEL_ICONS, CAMPAIGN_CHANNEL_LABELS, CAMPAIGN_STATUS_META } from './segments.utils';

type SegmentsTab = 'segments' | 'campaigns';

const PAGE_SIZE = 25;

/**
 * Clientes → Segmentos: saved rule-based segments (with a live count) and the
 * marketing campaigns sent to them. Writing needs `store:crm_segments:manage`;
 * campaigns need `store:crm_campaigns:send` (the API enforces both).
 */
@Component({
  selector: 'app-crm-segments',
  standalone: true,
  imports: [
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    ScrollableTabsComponent,
    SpinnerComponent,
    StickyHeaderComponent,
    CampaignDetailModalComponent,
    CampaignWizardModalComponent,
    SegmentFormModalComponent,
  ],
  template: `
    <section class="w-full">
      <app-sticky-header
        title="Segmentos"
        subtitle="Agrupa clientes con reglas y envíales campañas por WhatsApp, SMS o correo."
        icon="users"
        [actions]="headerActions()"
        (actionClicked)="openNew()"
      ></app-sticky-header>

      <app-card>
        <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          @if (canSend()) {
            <app-scrollable-tabs
              [tabs]="tabs"
              [activeTab]="tab()"
              size="sm"
              ariaLabel="Segmentos o campañas"
              (tabChange)="tab.set($any($event))"
            ></app-scrollable-tabs>
          } @else {
            <span></span>
          }
          @if (tab() === 'segments') {
            <app-inputsearch
              placeholder="Buscar segmento..."
              [debounceTime]="250"
              (searchChange)="search.set($event)"
            ></app-inputsearch>
          }
        </div>

        @if (tab() === 'segments') {
          @if (segmentsError()) {
            <app-empty-state
              icon="alert-triangle"
              title="No pudimos cargar los segmentos"
              [description]="segmentsError()!"
              [showActionButton]="false"
              [showRefreshButton]="true"
              (refreshClick)="loadSegments()"
            ></app-empty-state>
          } @else if (segmentsLoading() && !segments().length) {
            <div class="flex justify-center py-10"><app-spinner></app-spinner></div>
          } @else if (!visibleSegments().length) {
            <app-empty-state
              icon="users"
              [title]="search() ? 'Sin resultados' : 'Aún no tienes segmentos'"
              [description]="
                search()
                  ? 'Ningún segmento coincide con la búsqueda.'
                  : 'Crea uno con reglas como etiqueta, gasto o última compra y envíale una campaña.'
              "
              actionButtonText="Nuevo segmento"
              [showActionButton]="canManage() && !search()"
              (actionClick)="openNew()"
            ></app-empty-state>
          } @else {
            <ul class="flex flex-col divide-y divide-[var(--color-border)]" role="list">
              @for (segment of visibleSegments(); track segment.id) {
                <li class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-[var(--color-text-primary)]">{{ segment.name }}</p>
                    @if (segment.description) {
                      <p class="text-xs text-[var(--color-text-secondary)]">{{ segment.description }}</p>
                    }
                    <p class="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-[var(--color-text-secondary)]">
                      <span class="inline-flex items-center gap-1">
                        <app-icon name="users" [size]="12"></app-icon>
                        {{ segment.last_count ?? 0 }} {{ segment.last_count === 1 ? 'cliente' : 'clientes' }}
                      </span>
                      @if (segment.last_counted_at) {
                        <span>Actualizado {{ dateTime(segment.last_counted_at) }}</span>
                      }
                    </p>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    @if (canSend()) {
                      <app-button variant="primary" size="sm" (clicked)="openCampaign(segment)">
                        <app-icon name="send" [size]="14" slot="icon"></app-icon>
                        Nueva campaña
                      </app-button>
                    }
                    @if (canManage()) {
                      <app-button variant="outline" size="sm" (clicked)="openEdit(segment, false)">
                        <app-icon name="pencil" [size]="14" slot="icon"></app-icon>
                        Editar
                      </app-button>
                      <app-button variant="outline" size="sm" (clicked)="openEdit(segment, true)">
                        <app-icon name="copy" [size]="14" slot="icon"></app-icon>
                        Duplicar
                      </app-button>
                      <app-button variant="ghost" size="sm" (clicked)="askDelete(segment)">
                        <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
                        Eliminar
                      </app-button>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        } @else {
          @if (campaignsError()) {
            <app-empty-state
              icon="alert-triangle"
              title="No pudimos cargar las campañas"
              [description]="campaignsError()!"
              [showActionButton]="false"
              [showRefreshButton]="true"
              (refreshClick)="loadCampaigns(true)"
            ></app-empty-state>
          } @else if (campaignsLoading() && !campaigns().length) {
            <div class="flex justify-center py-10"><app-spinner></app-spinner></div>
          } @else if (!campaigns().length) {
            <app-empty-state
              icon="send"
              title="Aún no hay campañas"
              description="Crea una desde un segmento: elige canal, contenido y confirma el costo."
              [showActionButton]="false"
            ></app-empty-state>
          } @else {
            <ul class="flex flex-col divide-y divide-[var(--color-border)]" role="list">
              @for (campaign of campaigns(); track campaign.id) {
                <li>
                  <button
                    type="button"
                    class="flex w-full flex-col gap-1 py-3 text-left md:flex-row md:items-center md:justify-between"
                    (click)="openDetail(campaign)"
                  >
                    <span class="min-w-0">
                      <span class="block text-sm font-semibold text-[var(--color-text-primary)]">{{ campaign.name }}</span>
                      <span class="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-[var(--color-text-secondary)]">
                        <span class="inline-flex items-center gap-1">
                          <app-icon [name]="channelIcons[campaign.channel]" [size]="12"></app-icon>
                          {{ channelLabels[campaign.channel] }}
                        </span>
                        @if (campaign.segment) {
                          <span>{{ campaign.segment.name }}</span>
                        }
                        <span>{{ dateTime(campaign.scheduled_at || campaign.created_at) }}</span>
                      </span>
                    </span>
                    <span class="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                      <span>{{ campaign.recipients_total }} destinatarios</span>
                      <span>{{ campaign.recipients_sent }} enviados</span>
                      @if (campaign.recipients_failed) {
                        <span class="text-[var(--color-error)]">{{ campaign.recipients_failed }} fallidos</span>
                      }
                      <app-badge [variant]="statusMeta[campaign.status].variant">{{ statusMeta[campaign.status].label }}</app-badge>
                    </span>
                  </button>
                </li>
              }
            </ul>
            @if (campaignsPage() < campaignsTotalPages()) {
              <div class="mt-4 flex justify-center">
                <app-button variant="outline" size="sm" [loading]="campaignsLoading()" (clicked)="loadCampaigns(false)">
                  Cargar más
                </app-button>
              </div>
            }
          }
        }
      </app-card>

      <app-crm-segment-form-modal
        [isOpen]="formOpen()"
        (isOpenChange)="formOpen.set($event)"
        [segment]="editing()"
        [duplicate]="duplicating()"
        (saved)="loadSegments()"
      ></app-crm-segment-form-modal>

      <app-crm-campaign-wizard-modal
        [isOpen]="wizardOpen()"
        (isOpenChange)="wizardOpen.set($event)"
        [segment]="campaignSegment()"
        (created)="onCampaignCreated()"
      ></app-crm-campaign-wizard-modal>

      <app-crm-campaign-detail-modal
        [isOpen]="detailOpen()"
        (isOpenChange)="detailOpen.set($event)"
        [campaignId]="detailId()"
        (changed)="loadCampaigns(true)"
      ></app-crm-campaign-detail-modal>

      <app-confirmation-modal
        [isOpen]="deleteOpen()"
        (isOpenChange)="deleteOpen.set($event)"
        title="Eliminar segmento"
        [message]="'Se eliminará «' + (deleting()?.name ?? '') + '». Las campañas ya enviadas conservan su historial.'"
        confirmText="Eliminar"
        confirmVariant="danger"
        (confirm)="confirmDelete()"
      ></app-confirmation-modal>
    </section>
  `,
})
export class SegmentsComponent {
  private readonly api = inject(CrmSegmentsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  protected readonly tabs: ScrollableTab[] = [
    { id: 'segments', label: 'Segmentos', icon: 'users' },
    { id: 'campaigns', label: 'Campañas', icon: 'send' },
  ];
  protected readonly channelIcons = CAMPAIGN_CHANNEL_ICONS;
  protected readonly channelLabels = CAMPAIGN_CHANNEL_LABELS;
  protected readonly statusMeta = CAMPAIGN_STATUS_META;
  protected readonly dateTime = formatDateTime;

  protected readonly canManage = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_segments:manage'),
  );
  protected readonly canSend = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_campaigns:send'),
  );
  protected readonly headerActions = computed<StickyHeaderActionButton[]>(() =>
    this.canManage() ? [{ id: 'new', label: 'Nuevo segmento', icon: 'plus', variant: 'primary' }] : [],
  );

  protected readonly tab = signal<SegmentsTab>('segments');
  protected readonly search = signal('');

  // Pagination exception: the segments API returns every saved segment of the store.
  protected readonly segments = signal<CrmSegment[]>([]);
  protected readonly segmentsLoading = signal(false);
  protected readonly segmentsError = signal<string | null>(null);
  protected readonly visibleSegments = computed(() => {
    const term = this.search().trim().toLowerCase();
    return term
      ? this.segments().filter((s) => s.name.toLowerCase().includes(term))
      : this.segments();
  });

  protected readonly campaigns = signal<CrmCampaign[]>([]);
  protected readonly campaignsLoading = signal(false);
  protected readonly campaignsError = signal<string | null>(null);
  protected readonly campaignsPage = signal(1);
  protected readonly campaignsTotalPages = signal(1);

  protected readonly formOpen = signal(false);
  protected readonly editing = signal<CrmSegment | null>(null);
  protected readonly duplicating = signal(false);
  protected readonly wizardOpen = signal(false);
  protected readonly campaignSegment = signal<CrmSegment | null>(null);
  protected readonly detailOpen = signal(false);
  protected readonly detailId = signal<number | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal<CrmSegment | null>(null);

  constructor() {
    void this.loadSegments();
    effect(() => {
      if (this.tab() === 'campaigns') untracked(() => void this.loadCampaigns(true));
    });
  }

  openNew(): void {
    this.editing.set(null);
    this.duplicating.set(false);
    this.formOpen.set(true);
  }

  openEdit(segment: CrmSegment, duplicate: boolean): void {
    this.editing.set(segment);
    this.duplicating.set(duplicate);
    this.formOpen.set(true);
  }

  openCampaign(segment: CrmSegment): void {
    this.campaignSegment.set(segment);
    this.wizardOpen.set(true);
  }

  openDetail(campaign: CrmCampaign): void {
    this.detailId.set(campaign.id);
    this.detailOpen.set(true);
  }

  askDelete(segment: CrmSegment): void {
    this.deleting.set(segment);
    this.deleteOpen.set(true);
  }

  onCampaignCreated(): void {
    this.tab.set('campaigns');
    void this.loadCampaigns(true);
  }

  async confirmDelete(): Promise<void> {
    const segment = this.deleting();
    if (!segment) return;
    try {
      await firstValueFrom(this.api.deleteSegment(segment.id));
      this.toast.success('Segmento eliminado');
      void this.loadSegments();
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    }
  }

  async loadSegments(): Promise<void> {
    this.segmentsLoading.set(true);
    this.segmentsError.set(null);
    try {
      this.segments.set(await firstValueFrom(this.api.segments()));
    } catch (error) {
      this.segmentsError.set(parseApiError(error).userMessage);
    } finally {
      this.segmentsLoading.set(false);
    }
  }

  async loadCampaigns(reset: boolean): Promise<void> {
    this.campaignsLoading.set(true);
    this.campaignsError.set(null);
    try {
      const page = reset ? 1 : this.campaignsPage() + 1;
      const result = await firstValueFrom(this.api.campaigns({ page, limit: PAGE_SIZE }));
      this.campaigns.update((rows) => (reset ? result.data : [...rows, ...result.data]));
      this.campaignsPage.set(result.page);
      this.campaignsTotalPages.set(result.totalPages);
    } catch (error) {
      this.campaignsError.set(parseApiError(error).userMessage);
    } finally {
      this.campaignsLoading.set(false);
    }
  }
}
