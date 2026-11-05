import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertBannerComponent,
  ButtonComponent,
  DialogService,
  EmptyStateComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { WebhookRow, WebhookWithSecret } from '../interfaces/integrations.interfaces';
import { IntegrationsApiService } from '../services/integrations-api.service';
import { truncate, webhookEventLabel } from '../utils/integrations-labels.util';
import { SecretOnceModalComponent } from './secret-once-modal.component';
import { WebhookDeliveriesModalComponent } from './webhook-deliveries-modal.component';
import { WebhookFormModalComponent } from './webhook-form-modal.component';
import { WebhookSignatureHelpComponent } from './webhook-signature-help.component';

interface WebhookView extends WebhookRow {
  events_text: string;
  state: string;
  url_text: string;
}

/** "Webhooks" tab: endpoints, test, rotate, deactivate and deliveries. */
@Component({
  selector: 'app-webhooks-panel',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    SecretOnceModalComponent,
    WebhookDeliveriesModalComponent,
    WebhookFormModalComponent,
    WebhookSignatureHelpComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-text-secondary">
          Avisamos a tu sistema, con firma y reintentos, cuando algo pasa en un flujo.
        </p>
        <app-button variant="primary" size="sm" (clicked)="openForm(null)">
          <app-icon name="plus" [size]="14" slot="icon" />
          Nuevo webhook
        </app-button>
      </div>

      @if (errorMessage()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ errorMessage() }}</app-alert-banner>
      } @else if (loading()) {
        <p class="py-6 text-center text-sm text-text-secondary" role="status">Cargando...</p>
      } @else if (rows().length === 0) {
        <app-empty-state
          icon="webhook"
          title="Aún no tienes webhooks"
          description="Crea uno para recibir los eventos de tus flujos en tu sistema."
          actionButtonText="Nuevo webhook"
          (actionClick)="openForm(null)"
        />
      } @else {
        <app-responsive-data-view
          [data]="rows()"
          [columns]="columns"
          [actions]="actions"
          [cardConfig]="card"
          [sortable]="false"
          emptyMessage="Sin webhooks"
          emptyIcon="webhook"
        />
      }

      <app-webhook-signature-help />
    </div>

    <app-webhook-form-modal
      [(isOpen)]="formOpen"
      [webhook]="editing()"
      (created)="onCreated($event)"
      (updated)="onUpdated()"
    />
    <app-secret-once-modal
      [(isOpen)]="secretOpen"
      title="Secreto de firma"
      [subtitle]="secretUrl()"
      label="Secreto de firma"
      [secret]="secret()"
    />
    <app-webhook-deliveries-modal [(isOpen)]="deliveriesOpen" [webhook]="deliveriesTarget()" />
  `,
})
export class WebhooksPanelComponent implements OnInit {
  private readonly api = inject(IntegrationsApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly hooks = signal<WebhookRow[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly formOpen = signal(false);
  readonly editing = signal<WebhookRow | null>(null);
  readonly secretOpen = signal(false);
  readonly secret = signal('');
  readonly secretUrl = signal('');
  readonly deliveriesOpen = signal(false);
  readonly deliveriesTarget = signal<WebhookRow | null>(null);

  readonly rows = computed<WebhookView[]>(() =>
    this.hooks().map((row) => ({
      ...row,
      url_text: truncate(row.url, 60),
      events_text: row.event_types.map(webhookEventLabel).join(', '),
      state: row.is_active ? 'active' : 'inactive',
    })),
  );

  private readonly stateText = (value: string) => (value === 'active' ? 'Activo' : 'Inactivo');

  readonly columns: TableColumn[] = [
    { key: 'url_text', label: 'URL', priority: 1 },
    { key: 'events_text', label: 'Eventos', priority: 2 },
    {
      key: 'state',
      label: 'Estado',
      priority: 1,
      width: '110px',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: this.stateText,
    },
  ];

  readonly card: ItemListCardConfig = {
    titleKey: 'url_text',
    subtitleKey: 'description',
    avatarFallbackIcon: 'webhook',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: this.stateText,
    detailKeys: [{ key: 'events_text', label: 'Eventos', icon: 'zap' }],
  };

  readonly actions: TableAction[] = [
    { label: 'Entregas', icon: 'send', variant: 'info', action: (row: WebhookRow) => this.openDeliveries(row) },
    { label: 'Probar', icon: 'play', variant: 'success', show: (row: WebhookRow) => row.is_active, action: (row: WebhookRow) => this.test(row) },
    { label: 'Editar', icon: 'pencil', variant: 'info', action: (row: WebhookRow) => this.openForm(row) },
    { label: 'Rotar secreto', icon: 'refresh-cw', variant: 'muted', action: (row: WebhookRow) => this.rotate(row) },
    { label: 'Desactivar', icon: 'ban', variant: 'danger', show: (row: WebhookRow) => row.is_active, action: (row: WebhookRow) => this.deactivate(row) },
    { label: 'Activar', icon: 'check', variant: 'success', show: (row: WebhookRow) => !row.is_active, action: (row: WebhookRow) => this.activate(row) },
  ];

  ngOnInit(): void {
    this.load();
  }

  openForm(row: WebhookRow | null): void {
    this.editing.set(row);
    this.formOpen.set(true);
  }

  openDeliveries(row: WebhookRow): void {
    this.deliveriesTarget.set(row);
    this.deliveriesOpen.set(true);
  }

  onCreated(hook: WebhookWithSecret): void {
    this.showSecret(hook);
    this.load();
  }

  onUpdated(): void {
    this.toast.success('Webhook actualizado');
    this.load();
  }

  test(row: WebhookRow): void {
    this.api
      .testWebhook(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toast.success('Evento de prueba encolado: revisa las entregas'),
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  async rotate(row: WebhookRow): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Rotar secreto',
      message: 'El secreto anterior dejará de funcionar. Actualiza tu sistema con el nuevo. ¿Rotarlo?',
      confirmText: 'Rotar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .rotateWebhookSecret(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (hook) => this.showSecret(hook),
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  async deactivate(row: WebhookRow): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Desactivar webhook',
      message: 'Dejaremos de enviar eventos a esta URL. Podrás activarlo de nuevo cuando quieras.',
      confirmText: 'Desactivar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .deactivateWebhook(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Webhook desactivado');
          this.load();
        },
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  activate(row: WebhookRow): void {
    this.api
      .updateWebhook(row.id, { is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Webhook activado');
          this.load();
        },
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  private showSecret(hook: WebhookWithSecret): void {
    this.secret.set(hook.secret);
    this.secretUrl.set(hook.url);
    this.secretOpen.set(true);
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.api
      .listWebhooks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.hooks.set(rows);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}
