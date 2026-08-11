import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import {
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  IconComponent,
  ModalComponent,
  ResponsiveDataViewComponent,
  ToastService,
  type ItemListCardConfig,
  type TableAction,
  type TableColumn,
} from '../../../../../../../shared/components';
import {
  DianResolutionFormComponent,
  requirementsFor,
  type DianResolutionFormValue,
  type FiscalReadinessResolution,
} from '../../../../../../../shared/components/dian';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import { TENANT_CAPABILITY } from '../../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../../state/tenant-context.store';
import { TenantDianAxisPickerComponent } from './tenant-dian-axis-picker.component';
import { TenantDianConsoleStore } from './tenant-dian-console.store';

/** Fila de la tabla: la resolución más lo que hace falta para pintarla. */
interface NumberingRow extends FiscalReadinessResolution {
  readonly document_label: string;
  readonly identity: string;
  readonly range_label: string;
  readonly validity_label: string;
  readonly consumed_label: string;
  readonly state_label: string;
  readonly key_label: string;
}

/**
 * Numeración del tenant: crear, EDITAR y activar/desactivar sus resoluciones.
 *
 * ## Por qué esta vista existe
 *
 * La consola de soporte listaba las resoluciones del tenant y no dejaba tocarlas.
 * Un rango mal tecleado, una vigencia vencida o una clave técnica que la DIAN
 * reexpidió obligaban a pedirle al comerciante que entrara a su propio panel —
 * teniendo el backend el CRUD completo desde el primer día
 * (`TenantResolutionsController`). Esta pantalla lo pone a la vista.
 *
 * ## El formulario es el COMPARTIDO, y no persiste
 *
 * `app-dian-resolution-form` emite `save`; quien decide POST o PATCH es este
 * host. Es deliberado: crear y editar cuelgan de flujos distintos en cada
 * consola, y meterlos dentro del componente lo ataría a uno de los dos. La regla
 * de qué campo aplica a qué documento vive UNA sola vez, en el contrato
 * espejado.
 *
 * ## El escáner IA se apaga aquí
 *
 * `ResolutionScannerService` sólo sabe de dos raíles —la tienda del usuario
 * autenticado y las resoluciones fiscales de la plataforma— y ninguno es el del
 * tenant abierto. Dejarlo encendido subiría el PDF del contribuyente a un
 * namespace ajeno y consumiría cuota de IA con atribución falsa. El backend toma
 * la misma decisión: `POST resolutions/scan` se deja fuera del rail de tenants.
 *
 * ## Borrar no se ofrece; desactivar sí
 *
 * Una resolución que ya consumió numeración ante la DIAN no se puede borrar —el
 * backend responde `INVOICING_RESOLUTION_003`— porque sus consecutivos están en
 * documentos ya reportados. Desactivarla es la operación correcta y siempre
 * funciona, incluso sobre filas que incumplen el contrato actual.
 */
@Component({
  selector: 'app-tenant-dian-numbering',
  standalone: true,
  imports: [
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    IconComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    DianResolutionFormComponent,
    TenantDianAxisPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <app-card [responsive]="true">
        <app-tenant-dian-axis-picker></app-tenant-dian-axis-picker>
      </app-card>

      <app-card [responsive]="true" [padding]="false">
        <div
          class="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-text-primary md:text-lg">
              Resoluciones de {{ axisLabel() }} ({{ rows().length }})
            </h2>
            <p class="mt-0.5 text-[11px] text-text-secondary">
              El consecutivo que ya vio la DIAN no se puede re-etiquetar: sobre
              una resolución consumida el backend rechaza cambiar prefijo, rango
              inicial, tipo de documento y número de resolución.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <app-button
              variant="ghost"
              size="sm"
              [loading]="store.loading()"
              (clicked)="store.reload()"
            >
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Actualizar
            </app-button>
            @if (canWrite()) {
              <app-button
                variant="primary"
                size="sm"
                [disabled]="!hasConfiguredAxis()"
                (clicked)="openCreate()"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                Nueva resolución
              </app-button>
            }
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="rows()"
            [columns]="columns"
            [actions]="actions"
            [cardConfig]="cardConfig"
            [loading]="store.loading()"
            emptyIcon="file-text"
            emptyTitle="Sin resoluciones en esta habilitación"
            [emptyDescription]="emptyDescription()"
          ></app-responsive-data-view>
        </div>
      </app-card>

      @if (!canWrite()) {
        <p class="text-[11px] text-text-secondary">
          Crear y editar numeración requiere la capacidad
          <code>{{ capability.resolutionsWrite }}</code
          >. La tabla se muestra igual: para atender al comerciante hay que poder
          leer con qué numeración está facturando, aunque no se pueda cambiar.
        </p>
      }
    </div>

    <!-- Alta / edición ------------------------------------------------------ -->
    <app-modal
      [(isOpen)]="formOpen"
      [title]="formTitle()"
      [subtitle]="formSubtitle()"
      size="xl-mid"
      [closeOnBackdrop]="false"
      (cancel)="onFormClosed()"
    >
      @if (formOpen()) {
        <app-dian-resolution-form
          [configurationType]="store.selectedAxisType()"
          [resolution]="editing()"
          [saving]="saving()"
          [errorText]="formError()"
          [showScanner]="false"
          (save)="onSave($event)"
          (cancel)="closeForm()"
        ></app-dian-resolution-form>
      }
    </app-modal>

    <!-- Desactivación ------------------------------------------------------- -->
    @if (pendingDeactivation(); as row) {
      <app-confirmation-modal
        [isOpen]="true"
        title="Desactivar la resolución"
        [message]="deactivationMessage(row)"
        confirmText="Desactivar"
        cancelText="Cancelar"
        confirmVariant="danger"
        size="md"
        (confirm)="toggleActive(row)"
        (cancel)="pendingDeactivation.set(null)"
      ></app-confirmation-modal>
    }
  `,
})
export class TenantDianNumberingComponent {
  protected readonly store = inject(TenantDianConsoleStore);
  protected readonly tenant = inject(TenantContextStore);
  private readonly api = inject(DianConfigApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly capability = TENANT_CAPABILITY;

  protected readonly canWrite = computed(() =>
    this.tenant.can(TENANT_CAPABILITY.resolutionsWrite),
  );

  protected readonly axisLabel = computed(
    () => this.store.selectedAxis()?.label ?? '—',
  );

  protected readonly hasConfiguredAxis = computed(
    () => this.store.selectedAxis()?.config_id !== null,
  );

  protected readonly emptyDescription = computed(() =>
    this.hasConfiguredAxis()
      ? 'Registra la Autorización de Numeración que la DIAN emitió para este eje: sin ella el generador de consecutivos no tiene de dónde sacar el número.'
      : 'Esta habilitación todavía no tiene configuración DIAN. Créala desde «Habilitaciones» antes de registrar numeración.',
  );

  // Array MUTABLE a propósito: `app-responsive-data-view` declara `data` como
  // `any[]`, y un `readonly T[]` no es asignable a él.
  protected readonly rows = computed<NumberingRow[]>(() =>
    (this.store.selectedAxis()?.resolutions ?? []).map((row) =>
      this.toRow(row),
    ),
  );

  // ── Formulario ──────────────────────────────────────────────────────
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<FiscalReadinessResolution | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly pendingDeactivation = signal<NumberingRow | null>(null);

  protected readonly formTitle = computed(() =>
    this.editing() ? 'Editar resolución' : 'Nueva resolución',
  );

  protected readonly formSubtitle = computed(
    () => `${this.axisLabel()} · ${this.tenant.tenantName()}`,
  );

  // ── Tabla ───────────────────────────────────────────────────────────
  protected readonly columns: TableColumn[] = [
    { key: 'document_label', label: 'Documento', priority: 0 },
    { key: 'identity', label: 'Prefijo / resolución', priority: 0 },
    { key: 'range_label', label: 'Rango', priority: 1 },
    { key: 'consumed_label', label: 'Consumo', priority: 1 },
    { key: 'validity_label', label: 'Vigencia', priority: 2 },
    {
      key: 'key_label',
      label: 'Clave técnica',
      priority: 3,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          Guardada: '#16a34a',
          Pendiente: '#d97706',
          'No aplica': '#64748b',
        },
      },
    },
    {
      key: 'state_label',
      label: 'Estado',
      priority: 0,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { Activa: '#16a34a', Inactiva: '#64748b' },
      },
    },
  ];

  protected readonly cardConfig: ItemListCardConfig = {
    titleKey: 'identity',
    subtitleKey: 'document_label',
    badgeKey: 'state_label',
    badgeConfig: {
      type: 'custom',
      colorMap: { Activa: '#16a34a', Inactiva: '#64748b' },
    },
    detailKeys: [
      { key: 'range_label', label: 'Rango' },
      { key: 'consumed_label', label: 'Consumo' },
      { key: 'validity_label', label: 'Vigencia' },
      { key: 'key_label', label: 'Clave técnica' },
    ],
  };

  protected readonly actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'secondary',
      show: () => this.canWrite(),
      action: (row: NumberingRow) => this.openEdit(row),
    },
    {
      label: (row: NumberingRow) => (row.is_active ? 'Desactivar' : 'Activar'),
      icon: (row: NumberingRow) =>
        row.is_active ? 'toggle-right' : 'toggle-left',
      variant: (row: NumberingRow) => (row.is_active ? 'warning' : 'success'),
      show: () => this.canWrite(),
      disabled: () => this.saving(),
      action: (row: NumberingRow) => this.askToggle(row),
    },
  ];

  // ── Acciones ────────────────────────────────────────────────────────
  protected openCreate(): void {
    this.editing.set(null);
    this.formError.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(row: NumberingRow): void {
    // Se pasa la resolución CRUDA, no la fila decorada: el formulario siembra
    // sus controles desde el contrato compartido y las etiquetas de la tabla no
    // son valores editables.
    this.editing.set(this.rawOf(row));
    this.formError.set(null);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.onFormClosed();
  }

  protected onFormClosed(): void {
    this.editing.set(null);
    this.formError.set(null);
    this.saving.set(false);
  }

  protected onSave(value: DianResolutionFormValue): void {
    if (!this.canWrite() || this.saving()) return;

    const existing = this.editing();
    this.saving.set(true);
    this.formError.set(null);

    const request$ = existing
      ? this.api.updateResolution(
          existing.id,
          value as unknown as Record<string, unknown>,
        )
      : this.api.createResolution(value as unknown as Record<string, unknown>);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.editing.set(null);
        this.toast.success(
          existing ? 'Resolución actualizada' : 'Resolución creada',
        );
        this.store.reload();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        // El backend ya redacta en español los casos que importan —prefijo
        // duplicado (`INVOICING_RESOLUTION_007`), campos inmutables sobre una
        // resolución consumida (`INVOICING_RESOLUTION_005`)— y distingue cuál de
        // los dos es. Reescribirlos aquí perdería esa distinción.
        this.formError.set(
          extractApiErrorMessage(err) || 'No se pudo guardar la resolución.',
        );
      },
    });
  }

  protected askToggle(row: NumberingRow): void {
    // Activar no destraba nada que estuviera funcionando; desactivar sí retira
    // la fuente de consecutivos con la que el comerciante está numerando.
    if (!row.is_active) {
      this.toggleActive(row);
      return;
    }
    this.pendingDeactivation.set(row);
  }

  protected deactivationMessage(row: NumberingRow): string {
    return (
      `Se desactivará ${row.identity} (${row.document_label}) de ` +
      `${this.tenant.tenantName()}. Mientras esté inactiva, el generador de ` +
      'consecutivos deja de tomar números de este rango: si es la única vigente ' +
      'para ese documento, el tenant no podrá emitirlo. Los consecutivos ya ' +
      'consumidos no se devuelven al desactivarla.'
    );
  }

  protected toggleActive(row: NumberingRow): void {
    this.pendingDeactivation.set(null);
    if (!this.canWrite() || this.saving()) return;

    this.saving.set(true);
    // Sólo viaja `is_active`. El backend re-juzga los requisitos por tipo SOLO
    // si el PATCH toca `document_type`, `resolution_number` o `technical_key`,
    // así que alternar el estado funciona incluso sobre una fila anterior al
    // contrato — que es justo la que hay que poder retirar.
    this.api
      .updateResolution(row.id, { is_active: !row.is_active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(
            row.is_active ? 'Resolución desactivada' : 'Resolución activada',
          );
          this.store.reload();
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo cambiar el estado de la resolución.',
          );
        },
      });
  }

  // ── Derivación de filas ─────────────────────────────────────────────
  private rawOf(row: NumberingRow): FiscalReadinessResolution {
    return {
      id: row.id,
      document_type: row.document_type,
      prefix: row.prefix,
      range_from: row.range_from,
      range_to: row.range_to,
      current_number: row.current_number,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      is_active: row.is_active,
      technical_key_set: row.technical_key_set,
      resolution_number: row.resolution_number ?? null,
      resolution_date: row.resolution_date ?? null,
    };
  }

  private toRow(row: FiscalReadinessResolution): NumberingRow {
    const requirements = requirementsFor(row.document_type);
    const total = Math.max(0, row.range_to - row.range_from + 1);
    const used = Math.max(0, row.current_number - row.range_from + 1);
    const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

    return {
      ...row,
      document_label: requirements.label,
      identity: `${row.prefix || 'sin prefijo'} · ${row.resolution_number || 'sin número'}`,
      range_label: `${row.range_from} – ${row.range_to}`,
      consumed_label: `Va en ${row.current_number} (${percent}%)`,
      validity_label: `${this.day(row.valid_from)} → ${this.day(row.valid_to)}`,
      state_label: row.is_active ? 'Activa' : 'Inactiva',
      key_label: !requirements.accepts_technical_key
        ? 'No aplica'
        : row.technical_key_set
          ? 'Guardada'
          : 'Pendiente',
    };
  }

  /**
   * Fecha de calendario vía la utilidad del proyecto: `toLocaleDateString`
   * directo corre el día un puesto en husos negativos, que es el defecto
   * conocido de esta base de código.
   */
  private day(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return formatDateOnlyUTC(date);
  }
}
