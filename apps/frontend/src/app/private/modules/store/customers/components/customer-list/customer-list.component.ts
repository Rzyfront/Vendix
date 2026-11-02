import {
  Component,
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
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  ResponsiveDataViewComponent,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  OptionsDropdownComponent,
  DropdownAction,
  PaginationComponent,
} from '../../../../../../shared/components';
import { Customer } from '../../models/customer.model';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { getDocumentTypeLabel } from '../../../../../../shared/constants/document-types';
import { customerDisplayName } from '../../../../../../shared/utils/customer-display-name.util';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CrmService } from '../../crm/shared/crm.service';
import { CustomerCrmMemberships } from '../../crm/shared/crm.interface';
import { CrmMembershipChipsComponent } from '../../crm/shared/crm-membership-chips.component';

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [
    CardComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
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
      <!-- Search Section: sticky below stats on mobile -->
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div
          class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
        >
          <!-- Title -->
          <h2
            class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
          >
            Todos los Clientes ({{ totalItems() }})
          </h2>

          <!-- Search + Options -->
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar clientes..."
              (search)="onSearch($event)"
            ></app-inputsearch>

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [actions]="dropdownActions"
              [isLoading]="loading()"
              (actionClick)="onActionClick($event)"
            ></app-options-dropdown>
          </div>
        </div>
      </div>

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
  readonly pageChange = output<number>();

  get totalPages(): number {
    return Math.ceil(this.totalItems() / this.limit());
  }

  /** Segments and tags of the customers on screen, by customer id. */
  private readonly memberships = signal<Map<number, CustomerCrmMemberships>>(new Map());
  private membershipsRequest = 0;

  constructor() {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();

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
      key: 'first_name',
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
    }
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value);
  }
}
