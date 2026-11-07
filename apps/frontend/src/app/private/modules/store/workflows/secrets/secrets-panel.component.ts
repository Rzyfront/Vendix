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
} from '../../../../../shared/components/index';
import { toWorkflowError } from '../utils/workflow-errors.util';
import { SecretFormModalComponent } from './secret-form-modal.component';
import { WorkflowSecretsApiService } from './workflow-secrets-api.service';
import { WorkflowSecretRow, WorkflowSecretUse } from './workflow-secrets.interfaces';

interface SecretView extends WorkflowSecretRow {
  token: string;
  description_text: string;
  used_text: string;
}

const dateText = (iso: string | null): string => (iso ? iso.slice(0, 10) : 'Nunca');

/** "Secretos" tab: names for `{{secrets.NOMBRE}}` in the HTTP call. Values are write-only. */
@Component({
  selector: 'app-secrets-panel',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    SecretFormModalComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-text-secondary">
          Guarda tokens y claves de otros sistemas para la acción "Llamada HTTP". El valor se cifra y nunca se vuelve a mostrar.
        </p>
        <app-button variant="primary" size="sm" (clicked)="openForm(null)">
          <app-icon name="plus" [size]="14" slot="icon" />
          Nuevo secreto
        </app-button>
      </div>

      @if (errorMessage()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ errorMessage() }}</app-alert-banner>
      } @else if (loading()) {
        <p class="py-6 text-center text-sm text-text-secondary" role="status">Cargando...</p>
      } @else if (rows().length === 0) {
        <app-empty-state
          icon="key-round"
          title="Aún no tienes secretos"
          description="Crea uno, por ejemplo CRM_TOKEN, y úsalo en tus llamadas HTTP."
          actionButtonText="Nuevo secreto"
          (actionClick)="openForm(null)"
        />
      } @else {
        <app-responsive-data-view
          [data]="rows()"
          [columns]="columns"
          [actions]="actions"
          [cardConfig]="card"
          [sortable]="false"
          emptyMessage="Sin secretos"
          emptyIcon="key-round"
        />
      }
    </div>

    <app-secret-form-modal [(isOpen)]="formOpen" [secret]="editing()" (saved)="onSaved()" />
  `,
})
export class SecretsPanelComponent implements OnInit {
  private readonly api = inject(WorkflowSecretsApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly secrets = signal<WorkflowSecretRow[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly formOpen = signal(false);
  readonly editing = signal<WorkflowSecretRow | null>(null);

  readonly rows = computed<SecretView[]>(() =>
    this.secrets().map((row) => ({
      ...row,
      token: `{{secrets.${row.name}}}`,
      description_text: row.description ?? '',
      used_text: `Último uso: ${dateText(row.last_used_at)}`,
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', priority: 1 },
    { key: 'token', label: 'Se usa como', priority: 2 },
    { key: 'description_text', label: 'Descripción', priority: 3 },
    { key: 'used_text', label: 'Uso', priority: 3, width: '170px' },
  ];

  readonly card: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'token',
    avatarFallbackIcon: 'key-round',
    avatarShape: 'square',
    detailKeys: [
      { key: 'description_text', label: 'Descripción', icon: 'info' },
      { key: 'used_text', label: 'Uso', icon: 'clock' },
    ],
  };

  readonly actions: TableAction[] = [
    { label: 'Reemplazar valor', icon: 'refresh-cw', variant: 'info', action: (row: WorkflowSecretRow) => this.openForm(row) },
    { label: 'Eliminar', icon: 'trash-2', variant: 'danger', action: (row: WorkflowSecretRow) => this.remove(row) },
  ];

  ngOnInit(): void {
    this.load();
  }

  openForm(row: WorkflowSecretRow | null): void {
    this.editing.set(row);
    this.formOpen.set(true);
  }

  onSaved(): void {
    this.toast.success(this.editing() ? 'Secreto actualizado' : 'Secreto guardado');
    this.load();
  }

  async remove(row: WorkflowSecretRow): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Eliminar secreto',
      message: `Se borra ${row.name}. Si algún flujo publicado lo usa, no se podrá eliminar.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .remove(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Secreto eliminado');
          this.load();
        },
        error: (error) => {
          const failure = toWorkflowError(error);
          const flows = (failure.details as { flows?: WorkflowSecretUse[] } | null)?.flows ?? [];
          this.toast.error(
            flows.length > 0
              ? `${row.name} lo usan estos flujos publicados: ${flows.map((f) => f.name).join(', ')}.`
              : failure.message,
          );
        },
      });
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.secrets.set(rows);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}
