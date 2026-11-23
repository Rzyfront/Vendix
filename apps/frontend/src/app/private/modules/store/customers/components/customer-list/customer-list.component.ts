import {
  Component,
  DestroyRef,
  TemplateRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { buildCrmFilterConfigs, toCrmFilterId } from './crm-filters.util';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  ResponsiveDataViewComponent,
  ListSearchBarComponent,
  IconComponent,
  ButtonComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  DropdownAction,
  PaginationComponent,
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components';
import {
  DianDepartmentOption,
  DianMunicipalityLookupService,
  DianMunicipalityOption,
} from '../../../../../../shared/services/dian-municipality-lookup.service';
import { Customer } from '../../models/customer.model';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { getDocumentTypeLabel } from '../../../../../../shared/constants/document-types';
import { customerDisplayName } from '../../../../../../shared/utils/customer-display-name.util';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CrmService } from '../../crm/shared/crm.service';
import { CustomerCrmMemberships } from '../../crm/shared/crm.interface';
import { CrmMembershipChipsComponent } from '../../crm/shared/crm-membership-chips.component';

export interface CustomerLocationFilter {
  state_province?: string;
  city?: string;
}

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [
    CardComponent,
    ResponsiveDataViewComponent,
    ListSearchBarComponent,
    IconComponent,
    ButtonComponent,
    FormsModule,
    PaginationComponent,
    CrmMembershipChipsComponent,
  ],
  template: `
    <ng-template #membershipCell let-row>
      <app-crm-membership-chips
        [segments]="membershipOf(row.id)?.segments ?? []"
        [tags]="membershipOf(row.id)?.tags ?? []"
      ></app-crm-membership-chips>
    </ng-template>

    <!-- Contenedor de lista de clientes - Mobile First -->
    <app-card [responsive]="true" [padding]="false" overflow="visible">
      <!-- Search Section: shared mobile search bar (sticky below stats on mobile) -->
      <app-list-search-bar
        [title]="'Todos los Clientes (' + totalItems() + ')'"
        placeholder="Buscar clientes..."
        [filters]="filterConfigs()"
        [filterValues]="filterValues()"
        [actions]="dropdownActions"
        [isLoading]="loading()"
        (searchChange)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearAllFilters)="clearFilters()"
        (actionClick)="onActionClick($event)"
      ></app-list-search-bar>

      <!-- Estado de carga -->
      @if (loading()) {
        <div class="p-6 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-sm text-text-secondary">Cargando clientes...</p>
        </div>
      }

      <!-- Estado vacío -->
      @if (!loading() && customers().length === 0) {
        <div class="p-12 text-center text-gray-500">
          <app-icon name="users" [size]="48" class="mx-auto mb-4 text-gray-300"></app-icon>
          <h3 class="text-lg font-medium text-gray-900">No se encontraron clientes</h3>
          <p class="mt-1 text-sm">Comienza creando un nuevo cliente.</p>
          <div class="mt-6 flex justify-center">
            <app-button variant="primary" (clicked)="create.emit()">
              <app-icon slot="icon" name="plus" [size]="16"></app-icon>
              Agregar Cliente
            </app-button>
          </div>
        </div>
      }

      <!-- Data Table + Pagination -->
      @if (!loading() && customers().length > 0) {
        <div class="px-2 pb-2 pt-1 md:p-4">
          <app-responsive-data-view
            [data]="customers()"
            [columns]="columns()"
            [cardConfig]="cardConfig"
            [actions]="actions"
            [loading]="loading()"
            [hoverable]="true"
            [striped]="true"
            [emptyMessage]="'No hay clientes para mostrar'"
            [emptyIcon]="'users'"
            tableSize="md"
          ></app-responsive-data-view>

          @if (totalItems() > 0) {
            <div class="mt-4 border-t border-border pt-4">
              <app-pagination
                [currentPage]="page()"
                [total]="totalItems()"
                [limit]="limit()"
                [totalPages]="totalPages"
                infoStyle="none"
                (pageChange)="onPageChangeAction($event)"
              ></app-pagination>
            </div>
          }
        </div>
      }
    </app-card>
  `,
})
export class CustomerListComponent {
  private currencyService = inject(CurrencyFormatService);
  private readonly crm = inject(CrmService);
  private readonly auth = inject(AuthFacade);
  private readonly canReadCustomers = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:customers:read'),
  );

  readonly customers = input<Customer[]>([]);
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());
  readonly totalItems = input(0);
  readonly page = input(1);
  readonly limit = input(10);

  readonly search = output<string>();
  readonly create = output<void>();
  readonly edit = output<Customer>();
  readonly delete = output<Customer>();
  readonly viewDetail = output<Customer>();
  readonly bulkUpload = output<void>();
  readonly aiImport = output<void>();
  readonly pageChange = output<number>();
  /** Department/city filter, as the names stored on `addresses`. */
  readonly locationFilter = output<CustomerLocationFilter>();
  /** Segment/tag filter. Solo se emite lo que el usuario elige. */
  readonly crmFilter = output<{ tag_id?: number; segment_id?: number }>();

  /**
   * Valores vivos de la tienda. Si una lista viene vacia, su filtro no se
   * pinta: nunca hay selectores sin opciones.
   */
  readonly segments = input<Array<{ id: number; name: string }>>([]);
  readonly tags = input<Array<{ id: number; name: string }>>([]);

  // ── Department / city filter (DANE catalog) ─────────────────────────────
  private readonly destroyRef = inject(DestroyRef);
  private readonly dane = inject(DianMunicipalityLookupService);
  private readonly departments = signal<DianDepartmentOption[]>([]);
  private readonly municipalities = signal<DianMunicipalityOption[]>([]);
  readonly filterValues = signal<FilterValues>({ department: null, city: null });

  readonly filterConfigs = computed<FilterConfig[]>(() => {
    const hasDepartment = !!this.filterValues()['department'];
    return [
      {
        key: 'department',
        label: 'Departamento',
        type: 'select',
        placeholder: 'Todos los departamentos',
        options: this.departments().map((d) => ({ value: d.code, label: d.name })),
      },
      {
        key: 'city',
        label: 'Ciudad',
        type: 'select',
        placeholder: hasDepartment ? 'Todas las ciudades' : 'Elige un departamento',
        disabled: !hasDepartment,
        options: this.municipalities().map((m) => ({ value: m.code, label: m.name })),
      },
      // Filtros dinamicos: solo aparecen si la tienda tiene valores.
      ...buildCrmFilterConfigs(this.segments(), this.tags()),
    ];
  });

  /** Filtro de segmento/etiqueta vigente, para no perderlo al cambiar otro. */
  private readonly crmFilterValues = signal<{ tag_id?: number; segment_id?: number }>({});

  get totalPages(): number {
    return Math.ceil(this.totalItems() / this.limit());
  }

  /** Segments and tags of the customers on screen, by customer id. */
  private readonly memberships = signal<Map<number, CustomerCrmMemberships>>(new Map());
  private membershipsRequest = 0;

  constructor() {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();

    // Best effort: without the catalog the filter shows no options.
    this.dane
      .listDepartments()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (departments) => this.departments.set(departments),
        error: () => this.departments.set([]),
      });

    effect(() => {
      const ids = this.customers()
        .map((customer) => customer.id)
        .filter((id): id is number => typeof id === 'number');
      untracked(() => void this.loadMemberships(ids));
    });
  }

  protected membershipOf(customerId: number): CustomerCrmMemberships | undefined {
    return this.memberships().get(customerId);
  }

  /** Text version for the mobile card: two names and "+N". */
  private membershipText(customerId: number | undefined): string {
    const row = customerId ? this.memberships().get(customerId) : undefined;
    const names = [
      ...(row?.segments ?? []).map((segment) => segment.name),
      ...(row?.tags ?? []).map((tag) => tag.name),
    ];
    if (!names.length) return '—';
    const rest = names.length - 2;
    return names.slice(0, 2).join(', ') + (rest > 0 ? ` +${rest}` : '');
  }

  /** Best effort: without CRM access the column shows a dash. */
  private async loadMemberships(ids: number[]): Promise<void> {
    const request = ++this.membershipsRequest;
    if (!ids.length || !this.canReadCustomers()) {
      this.memberships.set(new Map());
      return;
    }
    try {
      const rows = await firstValueFrom(this.crm.memberships(ids));
      if (request !== this.membershipsRequest) return;
      this.memberships.set(new Map(rows.map((row) => [row.customer_id, row])));
    } catch {
      if (request === this.membershipsRequest) this.memberships.set(new Map());
    }
  }

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Carga Masiva', icon: 'upload', action: 'bulk-upload' },
    { label: 'Cargar con IA', icon: 'sparkles', action: 'ai-import' },
    {
      label: 'Nuevo Cliente',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  private readonly membershipCell = viewChild<TemplateRef<unknown>>('membershipCell');

  // Nothing here sorts: the list does not pass [sortable] and the API has no
  // sort, so no column is marked sortable.
  readonly columns = computed<TableColumn[]>(() => [
    {
      // `id` y no `first_name`: la tabla compartida no aplica `transform`
      // cuando el valor de la columna está vacío, y una persona jurídica
      // tiene `first_name = ''` → se veía «—» en vez de su razón social.
      key: 'id',
      label: 'Cliente',
      priority: 1,
      transform: (_val: any, row?: any) => customerDisplayName(row, '-'),
    },
    {
      key: 'document_number',
      label: 'Documento',
      priority: 2,
      transform: (_val: any, row?: any) => {
        const docNumber = row?.document_number;
        const docType = row?.document_type;
        if (!docNumber) return 'Sin documento';
        return docType ? `${getDocumentTypeLabel(docType)} ${docNumber}` : docNumber;
      },
    },
    {
      key: 'email',
      label: 'Correo',
      priority: 2,
      transform: (val: any) => val || 'Sin correo',
    },
    {
      key: 'phone',
      label: 'Teléfono',
      priority: 3,
      transform: (val: any) => val || 'Sin teléfono',
    },
    {
      key: 'crm_memberships',
      label: 'Segmentos y etiquetas',
      priority: 2,
      template: this.membershipCell(),
      transform: (_val: any, row?: any) => this.membershipText(row?.id),
    },
  ]);

  cardConfig: ItemListCardConfig = {
    titleKey: 'first_name',
    titleTransform: (item: any) => customerDisplayName(item, '-'),
    subtitleKey: 'email',
    subtitleTransform: (item: any) => item?.email || 'Sin correo',
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',
    detailKeys: [
      {
        key: 'phone',
        label: 'Teléfono',
        icon: 'phone',
        transform: (v: any) => v || 'Sin teléfono',
      },
      {
        key: 'document_number',
        label: 'Documento',
        icon: 'credit-card',
        transform: (_v: any, item?: any) => {
          const docNumber = item?.document_number;
          const docType = item?.document_type;
          if (!docNumber) return 'Sin documento';
          return docType ? `${getDocumentTypeLabel(docType)} ${docNumber}` : docNumber;
        },
      },
      {
        // `id` always exists, so the card runs the transform instead of printing "-".
        key: 'id',
        label: 'Segmentos y etiquetas',
        icon: 'users',
        transform: (_v: any, item?: any) => this.membershipText(item?.id),
      },
    ],
    footerKey: 'total_spend',
    footerLabel: 'Total Gastado',
    footerStyle: 'prominent',
    footerTransform: (v: any) => this.formatCurrency(v || 0),
  };

  actions: TableAction[] = [
    {
      label: 'Ver',
      tooltip: 'Ver detalle',
      icon: 'eye',
      variant: 'secondary',
      action: (row: any) => this.viewDetail.emit(row),
    },
    {
      label: 'Editar',
      tooltip: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (row: any) => this.edit.emit(row),
    },
    {
      label: 'Eliminar',
      tooltip: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: any) => this.delete.emit(row),
    },
  ];

  onSearch(query: string) {
    this.search.emit(query);
  }

  onFilterChange(values: FilterValues): void {
    const department = (values['department'] as string | null) || null;
    const departmentChanged = department !== this.filterValues()['department'];
    // A new department invalidates the city chosen for the previous one.
    const city = departmentChanged ? null : (values['city'] as string | null) || null;

    this.filterValues.set({ department, city });
    if (departmentChanged) this.loadMunicipalities(department);
    this.emitLocationFilter();

    const segmentId = toCrmFilterId(values['segment']);
    const tagId = toCrmFilterId(values['tag']);
    const next = { segment_id: segmentId, tag_id: tagId };
    const previous = this.crmFilterValues();
    this.crmFilterValues.set(next);
    if (previous.segment_id !== segmentId || previous.tag_id !== tagId) {
      this.crmFilter.emit(next);
    }
  }

  clearFilters(): void {
    this.filterValues.set({ department: null, city: null });
    this.municipalities.set([]);
    this.emitLocationFilter();
    this.crmFilterValues.set({});
    this.crmFilter.emit({});
  }

  private loadMunicipalities(departmentCode: string | null): void {
    this.municipalities.set([]);
    if (!departmentCode) return;
    this.dane
      .listByDepartment(departmentCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          // Ignore a late answer for a department that is no longer selected.
          if (this.filterValues()['department'] === departmentCode) {
            this.municipalities.set(rows);
          }
        },
        error: () => this.municipalities.set([]),
      });
  }

  /** Sends names, not DANE codes: `addresses` stores the names. */
  private emitLocationFilter(): void {
    const { department, city } = this.filterValues();
    this.locationFilter.emit({
      state_province: this.departments().find((d) => d.code === department)?.name,
      city: this.municipalities().find((m) => m.code === city)?.name,
    });
  }

  onPageChangeAction(page: number) {
    this.pageChange.emit(page);
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
      case 'bulk-upload':
        this.bulkUpload.emit();
        break;
      case 'ai-import':
        this.aiImport.emit();
        break;
    }
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value);
  }

}
