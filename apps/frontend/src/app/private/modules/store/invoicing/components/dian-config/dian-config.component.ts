import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

import { InvoicingService } from '../../services/invoicing.service';
import { DianConfig, DianNitType } from '../../interfaces/invoice.interface';

import {
  CardComponent,
  StatsComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  InputsearchComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  DropdownAction,
} from '../../../../../../shared/components/index';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { DianConfigWizardComponent } from './dian-config-wizard.component';
import { DianSetupGuideComponent } from './dian-setup-guide.component';

interface DianStats {
  total: number;
  enabled: number;
  certValid: number;
  production: number;
}

type EnvironmentFilter = 'all' | 'test' | 'production';

/**
 * DIAN Configuration page — standard admin module layout.
 *
 * Sections:
 *  - 4 stats cards (total, enabled, cert valid, production).
 *  - Header with search + environment filter dropdown + "Nueva configuracion".
 *  - ResponsiveDataView listing configs.
 *  - Contextual setup guide (DianSetupGuideComponent) on the side.
 *  - Wizard modal (DianConfigWizardComponent) for create/edit/continue flows.
 */
@Component({
  selector: 'vendix-dian-config',
  standalone: true,
  imports: [
    NgClass,
    CardComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    InputsearchComponent,
    ModalComponent,
    DianConfigWizardComponent,
    DianSetupGuideComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        @if (stats(); as s) {
          <app-stats
            title="Configuraciones"
            [value]="s.total"
            smallText="Total registradas"
            iconName="shield"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>
          <app-stats
            title="Habilitadas"
            [value]="s.enabled"
            smallText="Listas para facturar"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
          <app-stats
            title="Certificado vigente"
            [value]="s.certValid"
            smallText="Sin vencer"
            iconName="key"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
          ></app-stats>
          <app-stats
            title="En produccion"
            [value]="s.production"
            smallText="Ambiente productivo"
            iconName="globe"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>
        }
      </div>

      <!-- Main grid: list + guide -->
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mt-4 md:mt-6">
        <!-- List Column -->
        <app-card [responsive]="true" [padding]="false">
          <!-- Header sticky -->
          <div
            class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                   md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
          >
            <div
              class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
            >
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide
                       md:text-lg md:font-semibold md:text-text-primary"
              >
                Configuraciones DIAN ({{ filteredConfigs().length }})
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  placeholder="Buscar por nombre o NIT..."
                  [debounceTime]="300"
                  (searchChange)="onSearch($event)"
                ></app-inputsearch>
                <app-options-dropdown
                  class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  [actions]="dropdownActions"
                  (actionClick)="onDropdownAction($event)"
                ></app-options-dropdown>
              </div>
            </div>
            <!-- Environment filter pills -->
            <div class="flex items-center gap-2 mt-2 md:mt-3 text-xs">
              <button
                type="button"
                class="px-2 py-0.5 rounded-full border"
                [ngClass]="envFilter() === 'all' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'"
                (click)="envFilter.set('all')"
              >
                Todos
              </button>
              <button
                type="button"
                class="px-2 py-0.5 rounded-full border"
                [ngClass]="envFilter() === 'test' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'"
                (click)="envFilter.set('test')"
              >
                Pruebas
              </button>
              <button
                type="button"
                class="px-2 py-0.5 rounded-full border"
                [ngClass]="envFilter() === 'production' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'"
                (click)="envFilter.set('production')"
              >
                Produccion
              </button>
            </div>
          </div>

          <!-- Data Content -->
          <div class="relative p-2 md:p-4">
            <app-responsive-data-view
              [data]="filteredConfigs()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="tableActions"
              [loading]="loading()"
              emptyMessage="No hay configuraciones DIAN"
              emptyIcon="shield"
            ></app-responsive-data-view>
          </div>
        </app-card>

        <!-- Setup Guide (right column on desktop) -->
        <div class="order-first lg:order-none">
          <vendix-dian-setup-guide
            [config]="guideConfig()"
          ></vendix-dian-setup-guide>
        </div>
      </div>

      <!-- Wizard Modal -->
      <app-modal
        [(isOpen)]="isWizardOpen"
        [title]="wizardTitle()"
        subtitle="Configuracion paso a paso"
        size="lg"
        [closeOnBackdrop]="false"
        (cancel)="onWizardCancelled()"
      >
        <vendix-dian-config-wizard
          [initialConfig]="selectedConfig()"
          [initialStep]="initialStep()"
          (saved)="onWizardSaved($event)"
          (cancelled)="onWizardCancelled()"
        ></vendix-dian-config-wizard>
      </app-modal>
    </div>
  `,
})
export class DianConfigComponent {
  private readonly invoicingService = inject(InvoicingService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // ── State ─────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly configs = signal<DianConfig[]>([]);
  readonly searchTerm = signal('');
  readonly envFilter = signal<EnvironmentFilter>('all');
  readonly deletingId = signal<number | null>(null);

  // Wizard
  readonly isWizardOpen = signal(false);
  readonly selectedConfig = signal<DianConfig | null>(null);
  readonly initialStep = signal(0);

  // Derived signal used by the setup guide: the currently selected config
  // when the wizard is open, or the default config in the list, or null.
  readonly guideConfig = computed<DianConfig | null>(() => {
    const selected = this.selectedConfig();
    if (selected) return selected;
    const list = this.configs();
    return list.find((c) => c.is_default) || list[0] || null;
  });

  readonly wizardTitle = computed(() =>
    this.selectedConfig() ? 'Editar configuracion DIAN' : 'Nueva configuracion DIAN',
  );

  // Derived lists & stats
  readonly filteredConfigs = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const env = this.envFilter();
    return this.configs().filter((c) => {
      if (env !== 'all' && c.environment !== env) return false;
      if (!term) return true;
      return (
        c.name.toLowerCase().includes(term) ||
        c.nit.toLowerCase().includes(term)
      );
    });
  });

  readonly stats = computed<DianStats>(() => {
    const list = this.configs();
    const now = Date.now();
    let enabled = 0;
    let certValid = 0;
    let production = 0;
    for (const c of list) {
      if (c.enablement_status === 'enabled') enabled++;
      if (c.environment === 'production') production++;
      if (c.certificate_s3_key) {
        const exp = c.certificate_expiry ? new Date(c.certificate_expiry).getTime() : NaN;
        if (!isNaN(exp) && exp > now) certValid++;
      }
    }
    return { total: list.length, enabled, certValid, production };
  });

  // ── Table config ──────────────────────────────────────────
  readonly dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva configuracion',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  readonly columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
      transform: (_val: any, item?: DianConfig) => {
        if (!item) return '';
        return item.is_default ? `${item.name} (Predeterminada)` : item.name;
      },
    },
    {
      key: 'nit',
      label: 'Documento',
      priority: 2,
      transform: (_val: any, item?: DianConfig) => {
        if (!item) return '';
        const dv = item.nit_dv ? `-${item.nit_dv}` : '';
        return `${this.nitTypeLabel(item.nit_type)}: ${item.nit}${dv}`;
      },
    },
    {
      key: 'environment',
      label: 'Ambiente',
      align: 'center',
      priority: 2,
      badgeConfig: {
        type: 'status',
        colorMap: {
          test: 'warn',
          production: 'success',
        },
      },
      transform: (_val: any, item?: DianConfig) =>
        item?.environment === 'production' ? 'Produccion' : 'Pruebas',
    },
    {
      key: 'enablement_status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          not_started: 'neutral',
          testing: 'warn',
          enabled: 'success',
          suspended: 'danger',
        },
      },
      transform: (_val: any, item?: DianConfig) =>
        this.enablementLabel(item?.enablement_status ?? 'not_started'),
    },
    {
      key: 'certificate_expiry',
      label: 'Certificado',
      priority: 2,
      transform: (_val: any, item?: DianConfig) => {
        if (!item?.certificate_s3_key) return 'Sin cargar';
        if (!item.certificate_expiry) return 'Cargado';
        const exp = new Date(item.certificate_expiry).getTime();
        if (isNaN(exp)) return 'Cargado';
        if (exp < Date.now()) return 'Vencido';
        return `Expira ${new Date(exp).toLocaleDateString('es-CO')}`;
      },
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Continuar',
      icon: 'arrow-right',
      variant: 'primary',
      action: (item: DianConfig) => this.continueConfig(item),
    },
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (item: DianConfig) => this.editConfig(item),
    },
    {
      label: 'Marcar predeterminada',
      icon: 'star',
      variant: 'primary',
      action: (item: DianConfig) => this.markAsDefault(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: DianConfig) => this.confirmDelete(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'nit',
    subtitleTransform: (item: DianConfig) => {
      const dv = item.nit_dv ? `-${item.nit_dv}` : '';
      return `${this.nitTypeLabel(item.nit_type)}: ${item.nit}${dv}`;
    },
    badgeKey: 'enablement_status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        not_started: 'neutral',
        testing: 'warn',
        enabled: 'success',
        suspended: 'danger',
      },
    },
    badgeTransform: (_val: any, item?: DianConfig) =>
      this.enablementLabel(item?.enablement_status ?? 'not_started'),
    detailKeys: [
      {
        key: 'environment',
        label: 'Ambiente',
        icon: 'globe',
        transform: (val: any) => (val === 'production' ? 'Produccion' : 'Pruebas'),
      },
      {
        key: 'certificate_expiry',
        label: 'Certificado',
        icon: 'key',
        transform: (_val: any, item?: DianConfig) => {
          if (!item?.certificate_s3_key) return 'Sin cargar';
          if (!item.certificate_expiry) return 'Cargado';
          const exp = new Date(item.certificate_expiry).getTime();
          if (isNaN(exp)) return 'Cargado';
          if (exp < Date.now()) return 'Vencido';
          return new Date(exp).toLocaleDateString('es-CO');
        },
      },
    ],
  };

  constructor() {
    this.loadConfigs();
  }

  // ── Data loading ──────────────────────────────────────────
  private loadConfigs(): void {
    this.loading.set(true);
    this.invoicingService
      .getDianConfigs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.configs.set(response?.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.configs.set([]);
          this.loading.set(false);
        },
      });
  }

  // ── Header actions ────────────────────────────────────────
  onSearch(term: string): void {
    this.searchTerm.set(term ?? '');
  }

  onDropdownAction(action: string): void {
    if (action === 'create') this.startNewConfig();
  }

  startNewConfig(): void {
    this.selectedConfig.set(null);
    this.initialStep.set(0);
    this.isWizardOpen.set(true);
  }

  // ── Row actions ───────────────────────────────────────────
  editConfig(cfg: DianConfig): void {
    this.selectedConfig.set(cfg);
    this.initialStep.set(0);
    this.isWizardOpen.set(true);
  }

  continueConfig(cfg: DianConfig): void {
    this.selectedConfig.set(cfg);
    this.initialStep.set(this.getNextStep(cfg));
    this.isWizardOpen.set(true);
  }

  markAsDefault(cfg: DianConfig): void {
    if (cfg.is_default) return;
    this.invoicingService
      .setDefaultDianConfig(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success(`"${cfg.name}" marcada como predeterminada`);
          this.loadConfigs();
        },
        error: (err: any) => {
          this.toast.error(extractApiErrorMessage(err) || 'Error al cambiar configuracion predeterminada');
        },
      });
  }

  confirmDelete(cfg: DianConfig): void {
    if (!confirm(`Eliminar la configuracion "${cfg.name}"? Esta accion no se puede deshacer.`)) return;

    this.deletingId.set(cfg.id);
    this.invoicingService
      .deleteDianConfig(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success(`Configuracion "${cfg.name}" eliminada`);
          this.deletingId.set(null);
          this.loadConfigs();
        },
        error: (err: any) => {
          this.deletingId.set(null);
          this.toast.error(extractApiErrorMessage(err) || 'Error al eliminar configuracion');
        },
      });
  }

  // ── Wizard handlers ───────────────────────────────────────
  onWizardSaved(cfg: DianConfig): void {
    // Keep wizard open so user can continue subsequent steps; just refresh
    // the list in the background and update selectedConfig so the guide
    // reflects progress in real time.
    this.selectedConfig.set(cfg);
    this.loadConfigs();
  }

  onWizardCancelled(): void {
    this.isWizardOpen.set(false);
    this.selectedConfig.set(null);
    this.initialStep.set(0);
    this.loadConfigs();
  }

  // ── Helpers ───────────────────────────────────────────────
  private getNextStep(cfg: DianConfig): number {
    if (!cfg.certificate_s3_key) return 1;
    if (cfg.enablement_status === 'not_started') return 2;
    if (cfg.enablement_status !== 'enabled') return 3;
    return 4;
  }

  private nitTypeLabel(type: DianNitType): string {
    const labels: Record<DianNitType, string> = {
      NIT: 'NIT',
      CC: 'CC',
      CE: 'CE',
      TI: 'TI',
      PP: 'PP',
      NIT_EXTRANJERIA: 'NIT Ext.',
    };
    return labels[type] || type;
  }

  private enablementLabel(status: string): string {
    const labels: Record<string, string> = {
      not_started: 'No iniciado',
      testing: 'En pruebas',
      enabled: 'Habilitado',
      suspended: 'Suspendido',
    };
    return labels[status] || status;
  }
}
