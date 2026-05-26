import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AIEngineConfig,
  AIConfigQueryDto,
  AIEngineStats,
  AIEngineApp,
  AIAppQueryDto,
  AIAppStats,
  AIModelType,
  MODEL_TYPES,
  MODEL_TYPE_LABELS,
} from './interfaces';
import { AIEngineService } from './services/ai-engine.service';
import {
  AIEngineConfigModalComponent,
  AIEngineAppModalComponent,
} from './components/index';

import {
  TableColumn,
  TableAction,
  InputsearchComponent,
  StatsComponent,
  SelectorOption,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

type ActiveTab = 'configs' | 'apps';

@Component({
  selector: 'app-ai-engine',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    AIEngineConfigModalComponent,
    AIEngineAppModalComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    StatsComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    CardComponent,
  ],
  templateUrl: './ai-engine.component.html',
  styleUrls: ['./ai-engine.component.css'],
})
export class AIEngineComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private aiEngineService = inject(AIEngineService);
  private fb = inject(FormBuilder);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  // Tab state
  activeTab = signal<ActiveTab>('configs');

  // --- Config State ---
  configs = signal<AIEngineConfig[]>([]);
  stats = signal<AIEngineStats | null>(null);
  isLoading = signal<boolean>(false);
  selectedConfig = signal<AIEngineConfig | null>(null);
  duplicateSeed = signal<AIEngineConfig | null>(null);
  isTesting = signal<number | null>(null);
  showConfigModal = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);
  configPagination = { page: 1, limit: 10, total: 0, totalPages: 0 };

  // --- App State ---
  apps = signal<AIEngineApp[]>([]);
  appStats = signal<AIAppStats | null>(null);
  isLoadingApps = signal<boolean>(false);
  selectedApp = signal<AIEngineApp | null>(null);
  isTestingApp = signal<number | null>(null);
  showAppModal = signal<boolean>(false);
  isSubmittingApp = signal<boolean>(false);
  appPagination = { page: 1, limit: 10, total: 0, totalPages: 0 };
  // Config filters
  filterForm: FormGroup = this.fb.group({
    search: [''],
    sdk_type: [''],
    model_type: [''],
  });

  // App filters
  appFilterForm: FormGroup = this.fb.group({
    search: [''],
    output_format: [''],
    model_type: [''],
  });

  // --- Config Table ---
  tableColumns: TableColumn[] = [
    { key: 'label', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'provider',
      label: 'Proveedor',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
    },
    {
      key: 'sdk_type',
      label: 'SDK',
      sortable: true,
      priority: 3,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: string) => this.formatSdkType(value),
    },
    {
      key: 'model_type',
      label: 'Tipo',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (_value: unknown, item?: AIEngineConfig) =>
        this.formatModelType(item ? this.resolveConfigModelType(item) : 'text'),
    },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    },
    {
      key: 'is_default',
      label: 'Default',
      priority: 3,
      transform: (value: boolean) => (value ? 'Si' : 'No'),
    },
    {
      key: 'last_test_ok',
      label: 'Test',
      priority: 3,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: boolean | null) =>
        value === null ? 'Sin test' : value ? 'OK' : 'Fallo',
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'label',
    subtitleKey: 'provider',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'model_type',
        label: 'Tipo',
        transform: (_value: unknown, item?: AIEngineConfig) =>
          this.formatModelType(item ? this.resolveConfigModelType(item) : 'text'),
      },
      { key: 'sdk_type', label: 'SDK' },
    ],
  };

  tableActions: TableAction[] = [
    {
      label: 'Probar',
      icon: 'zap',
      action: (config: AIEngineConfig) => this.testConnection(config),
      variant: 'primary',
    },
    {
      label: 'Editar',
      icon: 'edit',
      action: (config: AIEngineConfig) => this.editConfig(config),
      variant: 'info',
    },
    {
      label: 'Duplicar',
      icon: 'copy',
      action: (config: AIEngineConfig) => this.duplicateConfig(config),
      variant: 'secondary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (config: AIEngineConfig) => this.confirmDelete(config),
      variant: 'danger',
    },
  ];

  sdkTypeOptions: SelectorOption[] = [
    { value: '', label: 'Todos los SDK' },
    { value: 'openai_compatible', label: 'OpenAI Compatible' },
    { value: 'anthropic_compatible', label: 'Anthropic Compatible' },
  ];

  modelTypeFilterOptions: SelectorOption[] = [
    { value: '', label: 'Todos los tipos' },
    ...MODEL_TYPES.map((value) => ({
      value,
      label: MODEL_TYPE_LABELS[value],
    })),
  ];

  configFilterConfigs: FilterConfig[] = [
    {
      key: 'sdk_type',
      label: 'SDK',
      type: 'select',
      options: this.sdkTypeOptions,
    },
    {
      key: 'model_type',
      label: 'Tipo de modelo',
      type: 'select',
      options: this.modelTypeFilterOptions,
    },
  ];

  configFilterValues: FilterValues = {};

  configDropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Configuración',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // --- App Table ---
  appTableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'key',
      label: 'Key',
      sortable: true,
      priority: 2,
      transform: (value: string) => value,
    },
    {
      key: 'config',
      label: 'Configuracion',
      priority: 2,
      transform: (value: any) => (value ? `${value.label}` : 'Default'),
    },
    {
      key: 'model_type',
      label: 'Tipo',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: AIModelType | undefined) =>
        this.formatModelType(value || 'text'),
    },
    {
      key: 'output_format',
      label: 'Formato',
      priority: 3,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: string) => this.formatOutputFormat(value),
    },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    },
  ];

  appCardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'key',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'model_type',
        label: 'Tipo',
        transform: (value: AIModelType | undefined) =>
          this.formatModelType(value || 'text'),
      },
      {
        key: 'output_format',
        label: 'Formato',
        transform: (value: string) => this.formatOutputFormat(value),
      },
      { key: 'description', label: 'Descripcion' },
    ],
  };

  appTableActions: TableAction[] = [
    {
      label: 'Probar',
      icon: 'zap',
      action: (app: AIEngineApp) => this.testAppExecution(app),
      variant: 'primary',
    },
    {
      label: 'Editar',
      icon: 'edit',
      action: (app: AIEngineApp) => this.editApp(app),
      variant: 'info',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (app: AIEngineApp) => this.confirmDeleteApp(app),
      variant: 'danger',
    },
  ];

  outputFormatOptions: SelectorOption[] = [
    { value: '', label: 'Todos los formatos' },
    { value: 'text', label: 'Texto' },
    { value: 'json', label: 'JSON' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'html', label: 'HTML' },
    { value: 'image', label: 'Imagen' },
    { value: 'embedding', label: 'Embeddings' },
    { value: 'audio', label: 'Audio' },
    { value: 'video', label: 'Video' },
    { value: 'rerank', label: 'Rerank' },
    { value: 'speech', label: 'Speech' },
    { value: 'transcription', label: 'Transcripcion' },
  ];

  appFilterConfigs: FilterConfig[] = [
    {
      key: 'output_format',
      label: 'Formato',
      type: 'select',
      options: this.outputFormatOptions,
    },
    {
      key: 'model_type',
      label: 'Tipo de modelo',
      type: 'select',
      options: this.modelTypeFilterOptions,
    },
  ];

  appFilterValues: FilterValues = {};

  appDropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Aplicación',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  ngOnInit(): void {
    this.refreshData();

    this.filterForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.configPagination.page = 1;
        this.loadConfigs();
      });

    this.appFilterForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.appPagination.page = 1;
        this.loadApps();
      });
  }
  switchTab(tab: ActiveTab): void {
    this.activeTab.set(tab);
    if (tab === 'apps' && this.apps().length === 0) {
      this.loadApps();
      this.loadAppStats();
    }
  }

  // ═══════════════════════════════════════
  // CONFIG Methods
  // ═══════════════════════════════════════

  loadConfigs(): void {
    this.isLoading.set(true);
    const filters = this.filterForm.value;
    const query: AIConfigQueryDto = {
      page: this.configPagination.page,
      limit: this.configPagination.limit,
      search: filters.search || undefined,
      sdk_type: filters.sdk_type || undefined,
      model_type: filters.model_type || undefined,
    };

    this.aiEngineService
      .getConfigs(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const data = response.data || [];
          this.configs.set(data);
          if (response.meta) {
            this.configPagination.total = response.meta.total || 0;
            this.configPagination.totalPages =
              response.meta.totalPages ||
              Math.ceil(
                this.configPagination.total / this.configPagination.limit,
              );
          }
        },
        error: (error) => {
          console.error('Error loading AI configs:', error);
          this.configs.set([]);
          this.toastService.error('Error al cargar configuraciones de IA');
        },
      })
      .add(() => {
        this.isLoading.set(false);
      });
  }

  loadStats(): void {
    this.aiEngineService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          if (response.success && response.data) {
            this.stats.set(response.data);
          }
        },
        error: (error) => {
          console.error('Error loading AI stats:', error);
        },
      });
  }

  refreshData(): void {
    this.aiEngineService.invalidateCache();
    this.loadConfigs();
    this.loadStats();
    if (this.activeTab() === 'apps') {
      this.loadApps();
      this.loadAppStats();
    }
  }

  onSearchChange(searchTerm: string): void {
    this.filterForm.patchValue({ search: searchTerm });
  }

  onConfigFilterChange(values: FilterValues): void {
    this.configFilterValues = { ...values };
    this.filterForm.patchValue({
      sdk_type: (values['sdk_type'] as string) || '',
      model_type: (values['model_type'] as string) || '',
    });
  }

  clearConfigFilters(): void {
    this.configFilterValues = {};
    this.filterForm.patchValue({ sdk_type: '', model_type: '' });
  }

  onConfigActionClick(action: string): void {
    if (action === 'create') {
      this.openCreateModal();
    }
  }

  onConfigPageChange(page: number): void {
    this.configPagination.page = page;
    this.loadConfigs();
  }

  openCreateModal(): void {
    this.selectedConfig.set(null);
    this.duplicateSeed.set(null);
    this.showConfigModal.set(true);
  }

  editConfig(config: AIEngineConfig): void {
    this.duplicateSeed.set(null);
    this.selectedConfig.set(config);
    this.showConfigModal.set(true);
  }

  duplicateConfig(config: AIEngineConfig): void {
    this.selectedConfig.set(null);
    this.duplicateSeed.set({
      ...config,
      label: `${config.label} (copia)`,
      is_default: false,
    });
    this.showConfigModal.set(true);
  }

  saveConfig(data: any): void {
    this.isSubmitting.set(true);
    const current = this.selectedConfig();

    const operation = current
      ? this.aiEngineService.updateConfig(current.id, data)
      : this.aiEngineService.createConfig(data);

    operation
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showConfigModal.set(false);
          this.selectedConfig.set(null);
          this.duplicateSeed.set(null);
          this.refreshData();
          this.toastService.success(
            current
              ? 'Configuracion actualizada exitosamente'
              : 'Configuracion creada exitosamente',
          );
        },
        error: (error) => {
          console.error('Error saving AI config:', error);
          this.toastService.error(extractApiErrorMessage(error));
        },
      })
      .add(() => {
        this.isSubmitting.set(false);
      });
  }

  testConnection(config: AIEngineConfig): void {
    this.isTesting.set(config.id);
    this.aiEngineService
      .testConnection(config.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const result = response.data || response;
          if (result.success) {
            this.toastService.success(`Conexion exitosa: ${result.message}`);
          } else {
            this.toastService.error(`Fallo la conexion: ${result.message}`);
          }
          this.refreshData();
        },
        error: (error) => {
          console.error('Error testing connection:', error);
          this.toastService.error(extractApiErrorMessage(error));
        },
      })
      .add(() => {
        this.isTesting.set(null);
      });
  }

  confirmDelete(config: AIEngineConfig): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Configuracion',
        message: `Estas seguro de que deseas eliminar "${config.label}"? Esta accion no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteConfig(config.id);
        }
      });
  }

  deleteConfig(id: number): void {
    this.aiEngineService
      .deleteConfig(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.refreshData();
          this.toastService.success('Configuracion eliminada exitosamente');
        },
        error: (error) => {
          console.error('Error deleting AI config:', error);
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }

  // ═══════════════════════════════════════
  // APP Methods
  // ═══════════════════════════════════════

  loadApps(): void {
    this.isLoadingApps.set(true);
    const filters = this.appFilterForm.value;
    const query: AIAppQueryDto = {
      page: this.appPagination.page,
      limit: this.appPagination.limit,
      search: filters.search || undefined,
      output_format: filters.output_format || undefined,
      model_type: filters.model_type || undefined,
    };

    this.aiEngineService
      .getApps(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const data = response.data || [];
          this.apps.set(data);
          if (response.meta) {
            this.appPagination.total = response.meta.total || 0;
            this.appPagination.totalPages =
              response.meta.totalPages ||
              Math.ceil(this.appPagination.total / this.appPagination.limit);
          }
        },
        error: (error) => {
          console.error('Error loading AI apps:', error);
          this.apps.set([]);
          this.toastService.error('Error al cargar aplicaciones de IA');
        },
      })
      .add(() => {
        this.isLoadingApps.set(false);
      });
  }

  loadAppStats(): void {
    this.aiEngineService
      .getAppStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          if (response.success && response.data) {
            this.appStats.set(response.data);
          }
        },
        error: (error) => {
          console.error('Error loading app stats:', error);
        },
      });
  }

  onAppSearchChange(searchTerm: string): void {
    this.appFilterForm.patchValue({ search: searchTerm });
  }

  onAppFilterChange(values: FilterValues): void {
    this.appFilterValues = { ...values };
    this.appFilterForm.patchValue({
      output_format: (values['output_format'] as string) || '',
      model_type: (values['model_type'] as string) || '',
    });
  }

  clearAppFilters(): void {
    this.appFilterValues = {};
    this.appFilterForm.patchValue({ output_format: '', model_type: '' });
  }

  onAppActionClick(action: string): void {
    if (action === 'create') {
      this.openCreateAppModal();
    }
  }

  onAppPageChange(page: number): void {
    this.appPagination.page = page;
    this.loadApps();
  }

  openCreateAppModal(): void {
    this.selectedApp.set(null);
    this.showAppModal.set(true);
  }

  editApp(app: AIEngineApp): void {
    this.selectedApp.set(app);
    this.showAppModal.set(true);
  }

  saveApp(data: any): void {
    this.isSubmittingApp.set(true);
    const current = this.selectedApp();

    const operation = current
      ? this.aiEngineService.updateApp(current.id, data)
      : this.aiEngineService.createApp(data);

    operation
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showAppModal.set(false);
          this.selectedApp.set(null);
          this.loadApps();
          this.loadAppStats();
          this.toastService.success(
            current
              ? 'Aplicacion actualizada exitosamente'
              : 'Aplicacion creada exitosamente',
          );
        },
        error: (error) => {
          console.error('Error saving AI app:', error);
          this.toastService.error(extractApiErrorMessage(error));
        },
      })
      .add(() => {
        this.isSubmittingApp.set(false);
      });
  }

  testAppExecution(app: AIEngineApp): void {
    this.isTestingApp.set(app.id);
    this.aiEngineService
      .testApp(app.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const result = response.data || response;
          if (result.success) {
            this.toastService.success('Test exitoso');
          } else {
            this.toastService.error(
              `Test fallo: ${result.error || 'Error desconocido'}`,
            );
          }
        },
        error: (error) => {
          console.error('Error testing app:', error);
          this.toastService.error(extractApiErrorMessage(error));
        },
      })
      .add(() => {
        this.isTestingApp.set(null);
      });
  }

  confirmDeleteApp(app: AIEngineApp): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Aplicacion',
        message: `Estas seguro de que deseas eliminar "${app.name}"? Esta accion no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteApp(app.id);
        }
      });
  }

  deleteApp(id: number): void {
    this.aiEngineService
      .deleteApp(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadApps();
          this.loadAppStats();
          this.toastService.success('Aplicacion eliminada exitosamente');
        },
        error: (error) => {
          console.error('Error deleting AI app:', error);
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }

  // ═══════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════

  formatSdkType(sdkType: string): string {
    const map: Record<string, string> = {
      openai_compatible: 'OpenAI',
      anthropic_compatible: 'Anthropic',
    };
    return map[sdkType] || sdkType;
  }

  formatModelType(modelType: AIModelType | string): string {
    if (this.isAIModelType(modelType)) {
      return MODEL_TYPE_LABELS[modelType];
    }
    return modelType;
  }

  /**
   * Resolves a config's model_type. Prefers the top-level field from
   * Phase A; falls back to legacy `settings.model_type` and finally to a
   * heuristic over model_id so the table still shows useful info if a
   * backend response predates Phase B1.
   */
  private resolveConfigModelType(config: AIEngineConfig): AIModelType {
    if (this.isAIModelType(config.model_type)) {
      return config.model_type;
    }

    const settings = config.settings || {};
    const explicitType = settings.model_type || settings['modelType'];
    if (this.isAIModelType(explicitType)) {
      return explicitType;
    }

    const modelId = config.model_id.toLowerCase();
    if (
      settings.image_generation_mode ||
      settings.image_endpoint ||
      settings.image_model ||
      settings.modalities?.includes?.('image') ||
      modelId.includes('image') ||
      modelId.includes('imagine') ||
      modelId.includes('seedream') ||
      modelId.includes('dall-e')
    ) {
      return 'image';
    }

    return 'text';
  }

  private isAIModelType(value: unknown): value is AIModelType {
    return (
      typeof value === 'string' &&
      (MODEL_TYPES as readonly string[]).includes(value)
    );
  }

  formatOutputFormat(format: string): string {
    const map: Record<string, string> = {
      text: 'Texto',
      json: 'JSON',
      markdown: 'Markdown',
      html: 'HTML',
      image: 'Imagen',
      embedding: 'Embeddings',
      audio: 'Audio',
      video: 'Video',
      rerank: 'Rerank',
      speech: 'Speech',
      transcription: 'Transcripcion',
    };
    return map[format] || format;
  }
}
