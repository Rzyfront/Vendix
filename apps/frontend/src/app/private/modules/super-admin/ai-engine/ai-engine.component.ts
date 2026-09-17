import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
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
  AIToolCatalogEntry,
  AIToolCategory,
  AI_TOOL_CATEGORY_LABELS,
  AIQueueOverviewEntry,
  AIJobLookupResult,
  AI_ENGINE_QUEUE_NAMES,
  AI_QUEUE_DESCRIPTIONS,
  AIAgent,
  AIAgentQueryDto,
} from './interfaces';
import { AIEngineService } from './services/ai-engine.service';
import {
  AIEngineConfigModalComponent,
  AIEngineAppModalComponent,
  AIEngineAgentModalComponent,
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
  SelectorComponent,
  InputComponent,
  ButtonComponent,
} from '../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';

import { JsonPipe } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';

type ActiveTab = 'configs' | 'apps' | 'tools' | 'jobs' | 'agents';

@Component({
  selector: 'app-ai-engine',
  standalone: true,
  imports: [
    JsonPipe,
    FormsModule,
    ReactiveFormsModule,
    AIEngineConfigModalComponent,
    AIEngineAppModalComponent,
    AIEngineAgentModalComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    StatsComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    CardComponent,
    SelectorComponent,
    InputComponent,
    ButtonComponent,
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

  // --- Tools State (F5: catálogo vivo, filtrado en cliente) ---
  tools = signal<AIToolCatalogEntry[]>([]);
  isLoadingTools = signal<boolean>(false);
  toolSearch = signal<string>('');
  toolCategory = signal<'' | AIToolCategory>('');
  toolDomain = signal<string>('');
  filteredTools = computed<AIToolCatalogEntry[]>(() => {
    const search = this.toolSearch().trim().toLowerCase();
    const category = this.toolCategory();
    const domain = this.toolDomain();
    return this.tools().filter((tool) => {
      if (category && tool.category !== category) return false;
      if (domain && tool.domain !== domain) return false;
      if (!search) return true;
      return (
        tool.name.toLowerCase().includes(search) ||
        tool.domain.toLowerCase().includes(search) ||
        (tool.description || '').toLowerCase().includes(search)
      );
    });
  });
  toolCountByCategory = computed<Record<AIToolCategory, number>>(() => {
    const counts: Record<AIToolCategory, number> = {
      read: 0,
      write: 0,
      ui: 0,
    };
    for (const tool of this.tools()) {
      counts[tool.category] += 1;
    }
    return counts;
  });

  // --- Jobs State (F5: colas + búsqueda por id) ---
  queues = signal<AIQueueOverviewEntry[]>([]);
  queueDescription(name: string): string {
    return AI_QUEUE_DESCRIPTIONS[name] ?? '';
  }
  isLoadingQueues = signal<boolean>(false);
  jobLookupForm: FormGroup = this.fb.group({
    queue: ['ai-generation', [Validators.required]],
    job_id: ['', [Validators.required]],
  });
  jobResult = signal<AIJobLookupResult | null>(null);
  jobLookupError = signal<string | null>(null);
  isLookingUp = signal<boolean>(false);

  // --- Agents State (F5: CRUD del endpoint F4) ---
  agents = signal<AIAgent[]>([]);
  isLoadingAgents = signal<boolean>(false);
  selectedAgent = signal<AIAgent | null>(null);
  showAgentModal = signal<boolean>(false);
  isSubmittingAgent = signal<boolean>(false);
  agentPagination = { page: 1, limit: 10, total: 0, totalPages: 0 };

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

  // Agent filters
  agentFilterForm: FormGroup = this.fb.group({
    search: [''],
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
        item
          ? this.formatConfigTypesBadge(item)
          : this.formatModelType('text'),
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
          item
            ? this.formatConfigTypesDetail(item)
            : this.formatModelType('text'),
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

  // --- Tools Table (F5: nombre/dominio/categoría/permisos) ---
  toolTableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'domain',
      label: 'Dominio',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
    },
    {
      key: 'category',
      label: 'Categoría',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: AIToolCategory) => this.formatToolCategory(value),
    },
    {
      key: 'requiredPermissions',
      label: 'Permisos',
      priority: 3,
      transform: (value: string[]) =>
        value && value.length ? value.join(', ') : '—',
    },
  ];

  toolCardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'domain',
    badgeKey: 'category',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: AIToolCategory) => this.formatToolCategory(value),
    detailKeys: [
      { key: 'description', label: 'Descripción' },
      {
        key: 'requiredPermissions',
        label: 'Permisos',
        transform: (value: string[]) =>
          value && value.length ? value.join(', ') : '—',
      },
    ],
  };

  toolCategoryOptions: SelectorOption[] = [
    { value: '', label: 'Todas las categorías' },
    { value: 'read', label: AI_TOOL_CATEGORY_LABELS['read'] },
    { value: 'write', label: AI_TOOL_CATEGORY_LABELS['write'] },
    { value: 'ui', label: AI_TOOL_CATEGORY_LABELS['ui'] },
  ];

  toolFilterConfigs: FilterConfig[] = [
    {
      key: 'category',
      label: 'Categoría',
      type: 'select',
      options: this.toolCategoryOptions,
    },
  ];

  toolFilterValues: FilterValues = {};

  // --- Agents Table (F5: CRUD del endpoint F4) ---
  agentTableColumns: TableColumn[] = [
    { key: 'key', label: 'Key', sortable: true, priority: 1 },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'app_key',
      label: 'App',
      priority: 2,
      transform: (value: string | null) => value || '—',
    },
    {
      key: 'allowed_tools',
      label: 'Tools',
      priority: 3,
      transform: (value: string[]) =>
        value && value.length ? `${value.length} tools` : 'Sin filtro',
    },
    {
      key: 'max_iterations',
      label: 'Max iter.',
      priority: 3,
      transform: (value: number | null) =>
        value === null || value === undefined ? '—' : String(value),
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

  agentCardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'key',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'app_key',
        label: 'App',
        transform: (value: string | null) => value || '—',
      },
      { key: 'description', label: 'Descripcion' },
    ],
  };

  agentTableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (agent: AIAgent) => this.editAgent(agent),
      variant: 'info',
    },
    {
      label: 'Activar/Desactivar',
      icon: 'power',
      action: (agent: AIAgent) => this.toggleAgentActive(agent),
      variant: 'secondary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (agent: AIAgent) => this.confirmDeleteAgent(agent),
      variant: 'danger',
    },
  ];

  agentDropdownActions: DropdownAction[] = [
    {
      label: 'Nuevo Agente',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // --- Jobs lookup (typed getters, sin $any en código nuevo) ---
  queueOptions: SelectorOption[] = AI_ENGINE_QUEUE_NAMES.map((name) => ({
    value: name,
    label: name,
  }));

  get jobQueueControl(): FormControl<string> {
    return this.jobLookupForm.get('queue') as FormControl<string>;
  }

  get jobIdControl(): FormControl<string> {
    return this.jobLookupForm.get('job_id') as FormControl<string>;
  }

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

    this.agentFilterForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.agentPagination.page = 1;
        this.loadAgents();
      });
  }
  switchTab(tab: ActiveTab): void {
    this.activeTab.set(tab);
    if (tab === 'apps' && this.apps().length === 0) {
      this.loadApps();
      this.loadAppStats();
    }
    if (tab === 'tools' && this.tools().length === 0) {
      this.loadTools();
    }
    if (tab === 'jobs' && this.queues().length === 0) {
      this.loadQueues();
    }
    if (tab === 'agents') {
      if (this.agents().length === 0) {
        this.loadAgents();
      }
      if (this.apps().length === 0) {
        this.loadApps();
      }
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
    if (this.activeTab() === 'tools') {
      this.loadTools();
    }
    if (this.activeTab() === 'jobs') {
      this.loadQueues();
    }
    if (this.activeTab() === 'agents') {
      this.loadAgents();
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
  // TOOLS Methods (F5: catálogo vivo)
  // ═══════════════════════════════════════

  loadTools(): void {
    this.isLoadingTools.set(true);
    this.aiEngineService
      .getTools()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const data: AIToolCatalogEntry[] = response.data || response || [];
          this.tools.set(Array.isArray(data) ? data : []);
          this.buildToolDomainFilter(this.tools());
        },
        error: (error) => {
          console.error('Error loading AI tools:', error);
          this.tools.set([]);
          this.toastService.error('Error al cargar tools de IA');
        },
      })
      .add(() => {
        this.isLoadingTools.set(false);
      });
  }

  onToolSearchChange(searchTerm: string): void {
    this.toolSearch.set(searchTerm);
  }

  onToolFilterChange(values: FilterValues): void {
    this.toolFilterValues = { ...values };
    this.toolCategory.set((values['category'] as '' | AIToolCategory) || '');
    this.toolDomain.set((values['domain'] as string) || '');
  }

  clearToolFilters(): void {
    this.toolFilterValues = {};
    this.toolCategory.set('');
    this.toolDomain.set('');
  }

  private buildToolDomainFilter(tools: AIToolCatalogEntry[]): void {
    const domains = [...new Set(tools.map((t) => t.domain))].sort();
    this.toolFilterConfigs = [
      {
        key: 'category',
        label: 'Categoría',
        type: 'select',
        options: this.toolCategoryOptions,
      },
      {
        key: 'domain',
        label: 'Dominio',
        type: 'select',
        options: [
          { value: '', label: 'Todos los dominios' },
          ...domains.map((d) => ({ value: d, label: d })),
        ],
      },
    ];
  }

  // ═══════════════════════════════════════
  // JOBS Methods (F5: colas + lookup)
  // ═══════════════════════════════════════

  loadQueues(): void {
    this.isLoadingQueues.set(true);
    this.aiEngineService
      .getQueues()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const data = response.data || response;
          this.queues.set(data?.queues || []);
        },
        error: (error) => {
          console.error('Error loading AI queues:', error);
          this.queues.set([]);
          this.toastService.error('Error al cargar colas de IA');
        },
      })
      .add(() => {
        this.isLoadingQueues.set(false);
      });
  }

  lookupJob(): void {
    if (this.jobLookupForm.invalid) {
      return;
    }
    const queue = this.jobQueueControl.value;
    const jobId = (this.jobIdControl.value || '').trim();
    if (!queue || !jobId) {
      return;
    }
    this.isLookingUp.set(true);
    this.jobResult.set(null);
    this.jobLookupError.set(null);
    this.aiEngineService
      .getJob(queue, jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.jobResult.set(response.data || response);
        },
        error: (error) => {
          console.error('Error looking up AI job:', error);
          this.jobLookupError.set(extractApiErrorMessage(error));
        },
      })
      .add(() => {
        this.isLookingUp.set(false);
      });
  }

  // ═══════════════════════════════════════
  // AGENTS Methods (F5: CRUD del endpoint F4)
  // ═══════════════════════════════════════

  loadAgents(): void {
    this.isLoadingAgents.set(true);
    const filters = this.agentFilterForm.value;
    const query: AIAgentQueryDto = {
      page: this.agentPagination.page,
      limit: this.agentPagination.limit,
      search: filters.search || undefined,
    };

    this.aiEngineService
      .getAgents(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const data = response.data || [];
          this.agents.set(data);
          if (response.meta) {
            this.agentPagination.total = response.meta.total || 0;
            this.agentPagination.totalPages =
              response.meta.totalPages ||
              Math.ceil(this.agentPagination.total / this.agentPagination.limit);
          }
        },
        error: (error) => {
          console.error('Error loading AI agents:', error);
          this.agents.set([]);
          this.toastService.error('Error al cargar agentes de IA');
        },
      })
      .add(() => {
        this.isLoadingAgents.set(false);
      });
  }

  onAgentSearchChange(searchTerm: string): void {
    this.agentFilterForm.patchValue({ search: searchTerm });
  }

  onAgentActionClick(action: string): void {
    if (action === 'create') {
      this.openCreateAgentModal();
    }
  }

  onAgentPageChange(page: number): void {
    this.agentPagination.page = page;
    this.loadAgents();
  }

  openCreateAgentModal(): void {
    this.selectedAgent.set(null);
    this.showAgentModal.set(true);
  }

  editAgent(agent: AIAgent): void {
    this.selectedAgent.set(agent);
    this.showAgentModal.set(true);
  }

  saveAgent(data: any): void {
    this.isSubmittingAgent.set(true);
    const current = this.selectedAgent();

    const operation = current
      ? this.aiEngineService.updateAgent(current.id, data)
      : this.aiEngineService.createAgent(data);

    operation
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showAgentModal.set(false);
          this.selectedAgent.set(null);
          this.loadAgents();
          this.toastService.success(
            current
              ? 'Agente actualizado exitosamente'
              : 'Agente creado exitosamente',
          );
        },
        error: (error) => {
          console.error('Error saving AI agent:', error);
          this.toastService.error(extractApiErrorMessage(error));
        },
      })
      .add(() => {
        this.isSubmittingAgent.set(false);
      });
  }

  toggleAgentActive(agent: AIAgent): void {
    this.aiEngineService
      .updateAgent(agent.id, { is_active: !agent.is_active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadAgents();
          this.toastService.success(
            agent.is_active ? 'Agente desactivado' : 'Agente activado',
          );
        },
        error: (error) => {
          console.error('Error toggling AI agent:', error);
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }

  confirmDeleteAgent(agent: AIAgent): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Agente',
        message: `Estas seguro de que deseas eliminar "${agent.name}"? Esta accion no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteAgent(agent.id);
        }
      });
  }

  deleteAgent(id: number): void {
    this.aiEngineService
      .deleteAgent(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadAgents();
          this.toastService.success('Agente eliminado exitosamente');
        },
        error: (error) => {
          console.error('Error deleting AI agent:', error);
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
      modelId.includes('dall-e') ||
      modelId.includes('muse') ||
      modelId.includes('flux') ||
      modelId.includes('imagen') ||
      modelId.includes('diffusion') ||
      modelId.includes('recraft')
    ) {
      return 'image';
    }

    return 'text';
  }

  /**
   * Todos los tipos del modelo: primario + capacidades extra válidas. Más de
   * uno = multimodal (badge en tabla, desglose en detalle).
   */
  private resolveConfigCapabilities(config: AIEngineConfig): AIModelType[] {
    const primary = this.resolveConfigModelType(config);
    const caps = config.settings?.capabilities;
    if (!Array.isArray(caps)) return [primary];
    const extras = [
      ...new Set(
        caps.filter(
          (t): t is AIModelType =>
            this.isAIModelType(t) && t !== primary,
        ),
      ),
    ];
    return [primary, ...extras];
  }

  private formatConfigTypesBadge(config: AIEngineConfig): string {
    const types = this.resolveConfigCapabilities(config);
    if (types.length > 1) return 'Multimodal';
    return this.formatModelType(types[0]);
  }

  private formatConfigTypesDetail(config: AIEngineConfig): string {
    return this.resolveConfigCapabilities(config)
      .map((t) => this.formatModelType(t))
      .join(' + ');
  }

  private isAIModelType(value: unknown): value is AIModelType {
    return (
      typeof value === 'string' &&
      (MODEL_TYPES as readonly string[]).includes(value)
    );
  }

  formatToolCategory(category: AIToolCategory | string): string {
    if (
      category === 'read' ||
      category === 'write' ||
      category === 'ui'
    ) {
      return AI_TOOL_CATEGORY_LABELS[category];
    }
    return category;
  }

  formatJobStatus(status: string): string {
    const map: Record<string, string> = {
      waiting: 'En espera',
      active: 'Activo',
      completed: 'Completado',
      failed: 'Fallido',
      delayed: 'Retrasado',
      paused: 'Pausado',
    };
    return map[status] || status;
  }

  queueTotal(queue: AIQueueOverviewEntry): number {
    const c = queue.counts;
    if (!c) return 0;
    return c.waiting + c.active + c.completed + c.failed + c.delayed + c.paused;
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
