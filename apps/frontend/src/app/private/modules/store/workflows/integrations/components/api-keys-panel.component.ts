import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
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
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { ApiKeyCreated, ApiKeyRow } from '../interfaces/integrations.interfaces';
import { IntegrationsApiService } from '../services/integrations-api.service';
import { API_KEY_STATE_LABEL, apiKeyState, scopeLabel } from '../utils/integrations-labels.util';
import { ApiKeyCreateModalComponent } from './api-key-create-modal.component';
import { ApiUsageHelpComponent } from './api-usage-help.component';
import { SecretOnceModalComponent } from './secret-once-modal.component';

interface ApiKeyView extends ApiKeyRow {
  scopes_text: string;
  created_text: string;
  last_used_text: string;
  expires_text: string;
  state: string;
}

/** "API keys" tab: list, create (secret once), revoke and the usage guide. */
@Component({
  selector: 'app-api-keys-panel',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    ApiKeyCreateModalComponent,
    ApiUsageHelpComponent,
    SecretOnceModalComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-text-secondary">
          Permite que otros sistemas consulten e inicien flujos en tu tienda.
        </p>
        <app-button variant="primary" size="sm" (clicked)="createOpen.set(true)">
          <app-icon name="plus" [size]="14" slot="icon" />
          Nueva API key
        </app-button>
      </div>

      @if (errorMessage()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ errorMessage() }}</app-alert-banner>
      } @else if (loading()) {
        <p class="py-6 text-center text-sm text-text-secondary" role="status">Cargando...</p>
      } @else if (rows().length === 0) {
        <app-empty-state
          icon="key"
          title="Aún no tienes API keys"
          description="Crea una para conectar otro sistema con tus flujos."
          actionButtonText="Nueva API key"
          (actionClick)="createOpen.set(true)"
        />
      } @else {
        <app-responsive-data-view
          [data]="rows()"
          [columns]="columns"
          [actions]="actions"
          [cardConfig]="card"
          [sortable]="false"
          emptyMessage="Sin API keys"
          emptyIcon="key"
        />
      }

      <app-api-usage-help />
    </div>

    <app-api-key-create-modal [(isOpen)]="createOpen" (created)="onCreated($event)" />
    <app-secret-once-modal
      [(isOpen)]="secretOpen"
      title="Tu API key"
      [subtitle]="secretName()"
      label="API key"
      [secret]="secret()"
    />
  `,
})
export class ApiKeysPanelComponent implements OnInit {
  private readonly api = inject(IntegrationsApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly keys = signal<ApiKeyRow[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly createOpen = signal(false);
  readonly secretOpen = signal(false);
  readonly secret = signal('');
  readonly secretName = signal('');

  readonly rows = computed<ApiKeyView[]>(() =>
    this.keys().map((row) => ({
      ...row,
      scopes_text: row.scopes.map(scopeLabel).join(' · '),
      created_text: this.dateText(row.created_at),
      last_used_text: row.last_used_at ? this.dateText(row.last_used_at) : 'Nunca',
      expires_text: row.expires_at ? this.dateText(row.expires_at) : 'No expira',
      state: apiKeyState(row),
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', priority: 1 },
    { key: 'prefix', label: 'Prefijo', priority: 2, width: '150px' },
    { key: 'scopes_text', label: 'Permisos', priority: 2 },
    { key: 'created_text', label: 'Creada', priority: 3, width: '160px' },
    { key: 'last_used_text', label: 'Último uso', priority: 3, width: '160px' },
    { key: 'expires_text', label: 'Expira', priority: 3, width: '160px' },
    {
      key: 'state',
      label: 'Estado',
      priority: 1,
      width: '120px',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: string) => API_KEY_STATE_LABEL[value as keyof typeof API_KEY_STATE_LABEL] ?? value,
    },
  ];

  readonly card: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'prefix',
    avatarFallbackIcon: 'key',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: string) => API_KEY_STATE_LABEL[value as keyof typeof API_KEY_STATE_LABEL] ?? value,
    detailKeys: [
      { key: 'scopes_text', label: 'Permisos', icon: 'shield' },
      { key: 'last_used_text', label: 'Último uso', icon: 'clock' },
      { key: 'expires_text', label: 'Expira', icon: 'calendar' },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Revocar',
      icon: 'ban',
      variant: 'danger',
      show: (row: ApiKeyView) => row.state === 'active',
      action: (row: ApiKeyView) => this.revoke(row),
    },
  ];

  ngOnInit(): void {
    this.load();
  }

  onCreated(key: ApiKeyCreated): void {
    this.secret.set(key.secret);
    this.secretName.set(key.name);
    this.secretOpen.set(true);
    this.load();
  }

  async revoke(row: ApiKeyRow): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Revocar API key',
      message: `¿Revocar "${row.name}"? Los sistemas que la usen dejarán de funcionar de inmediato.`,
      confirmText: 'Revocar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .revokeApiKey(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('API key revocada');
          this.load();
        },
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  private dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.api
      .listApiKeys()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.keys.set(rows);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}
