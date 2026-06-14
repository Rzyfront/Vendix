import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { startWith } from 'rxjs/operators';

import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SortDirection,
  SpinnerComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToggleComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  ChartAccount,
  CreateChartAccountDto,
} from '../../interfaces/superadmin-fiscal.interface';
import { SuperadminFiscalService } from '../../services/superadmin-fiscal.service';

interface NewAccountForm {
  code: FormControl<string>;
  name: FormControl<string>;
  parent_code: FormControl<string>;
  accepts_entries: FormControl<boolean>;
  is_active: FormControl<boolean>;
  description: FormControl<string>;
}

interface AccountStats {
  total: number;
  active: number;
  accepts_entries: number;
  types: number;
}

@Component({
  selector: 'app-chart-of-accounts',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    ModalComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SpinnerComponent,
    StatsComponent,
    ToggleComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        @if (stats(); as s) {
          <app-stats
            title="Total Cuentas"
            [value]="s.total"
            iconName="book-open"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          />
          <app-stats
            title="Activas"
            [value]="s.active"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          />
          <app-stats
            title="Aceptan Asientos"
            [value]="s.accepts_entries"
            iconName="file-text"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
            [clickable]="false"
          />
          <app-stats
            title="Tipos de Cuenta"
            [value]="s.types"
            iconName="layers"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          />
        }
      </div>

      <!-- Unified container: sticky search header + data -->
      <app-card
        [responsive]="true"
        [padding]="false"
        customClasses="md:min-h-[400px]"
      >
        <!-- Search header (sticky on mobile) -->
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
              Plan de Cuentas ({{ pagination().total }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar cuenta…"
                [debounceTime]="400"
                (searchChange)="onSearch($event)"
              />
              <app-button
                variant="primary"
                size="sm"
                (clicked)="openModal()"
              >
                <app-icon name="plus" [size]="16" slot="icon" />
                <span class="hidden sm:inline">Nueva Subcuenta</span>
                <span class="sm:hidden">Nueva</span>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Data content -->
        <div class="relative p-2 md:p-4">
          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <app-spinner size="md" label="Cargando PUC…" />
            </div>
          }

          @if (!loading() && accounts().length === 0) {
            <app-empty-state
              icon="book-open"
              title="Sin cuentas"
              [description]="
                searchTerm()
                  ? 'Ninguna cuenta coincide con tu búsqueda.'
                  : 'Aún no se ha cargado el PUC de la plataforma.'
              "
              [showActionButton]="false"
            />
          }

          @if (!loading() && accounts().length > 0) {
            <app-responsive-data-view
              [data]="accounts()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [loading]="loading()"
              [sortable]="true"
              (sort)="onSort($event)"
              (rowClick)="onRowClick($any($event))"
            />
            @if (pagination().totalPages > 1) {
              <div class="mt-4 flex justify-center">
                <app-pagination
                  [currentPage]="pagination().page"
                  [totalPages]="pagination().totalPages"
                  [total]="pagination().total"
                  [limit]="pagination().limit"
                  infoStyle="range"
                  (pageChange)="onPageChange($any($event))"
                />
              </div>
            }
          }
        </div>
      </app-card>
    </div>

    <!-- Create sub-account modal -->
    <app-modal
      [isOpen]="modalOpen()"
      title="Nueva subcuenta"
      subtitle="Añade una subcuenta al PUC de la plataforma"
      size="md"
      (closed)="closeModal()"
    >
      <form
        [formGroup]="form"
        (ngSubmit)="onSubmit()"
        class="space-y-4"
        autocomplete="off"
      >
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-input
            label="Código"
            placeholder="Ej. 11050501"
            [required]="true"
            [control]="form.controls.code"
          />
          <app-input
            label="Código padre"
            placeholder="Ej. 110505"
            [required]="true"
            [control]="form.controls.parent_code"
          />
        </div>

        <app-input
          label="Nombre"
          placeholder="Ej. Caja general — Bogotá"
          [required]="true"
          [control]="form.controls.name"
        />

        <app-input
          label="Descripción"
          placeholder="Descripción opcional"
          [control]="form.controls.description"
        />

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-toggle
            label="Acepta asientos"
            [checked]="form.controls.accepts_entries.value"
            (changed)="form.controls.accepts_entries.setValue($event)"
          />
          <app-toggle
            label="Activa"
            [checked]="form.controls.is_active.value"
            (changed)="form.controls.is_active.setValue($event)"
          />
        </div>
      </form>

      <div slot="footer" class="flex items-center justify-end gap-2">
        <app-button
          variant="outline"
          size="md"
          label="Cancelar"
          (clicked)="closeModal()"
        />
        <app-button
          variant="primary"
          size="md"
          label="Crear subcuenta"
          [loading]="saving()"
          [disabled]="formInvalid()"
          (clicked)="onSubmit()"
        />
      </div>
    </app-modal>
  `,
})
export class ChartOfAccountsComponent {
  private readonly api = inject(SuperadminFiscalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  readonly accounts = signal<ChartAccount[]>([]);
  readonly loading = signal<boolean>(false);
  readonly saving = signal<boolean>(false);
  readonly searchTerm = signal<string>('');
  readonly modalOpen = signal<boolean>(false);
  readonly pagination = signal({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  // ─── Stats derivadas del page actual + total backend ────────────────────
  readonly stats = computed<AccountStats>(() => {
    const list = this.accounts();
    const types = new Set(list.map((a) => a.account_type));
    return {
      total: this.pagination().total,
      active: list.filter((a) => a.is_active).length,
      accepts_entries: list.filter((a) => a.accepts_entries).length,
      types: types.size,
    };
  });

  // ─── Form (Reactive) ────────────────────────────────────────────────────
  readonly form: FormGroup<NewAccountForm> = this.fb.group<NewAccountForm>({
    code: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.minLength(2)],
    }),
    name: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.minLength(3)],
    }),
    parent_code: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.minLength(2)],
    }),
    accepts_entries: this.fb.nonNullable.control(true),
    is_active: this.fb.nonNullable.control(true),
    description: this.fb.nonNullable.control(''),
  });

  // Bridge form.status to a signal so computed()/template re-evaluate on change.
  // Fixes the "Guardar disabled forever" zoneless bug from vendix-zoneless-signals.
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  readonly formInvalid = computed(() => this.formStatus() !== 'VALID');

  // ─── Table config ───────────────────────────────────────────────────────
  readonly columns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true, width: '140px', priority: 1 },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'account_type',
      label: 'Tipo',
      sortable: true,
      width: '120px',
      priority: 2,
      transform: (v: string) => v ?? '—',
    },
    {
      key: 'nature',
      label: 'Naturaleza',
      width: '120px',
      align: 'center',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          DEBIT: '#3b82f6',
          CREDIT: '#a855f7',
        },
      },
      transform: (v: string) => v ?? '—',
    },
    {
      key: 'accepts_entries',
      label: 'Acepta asientos',
      width: '140px',
      align: 'center',
      priority: 3,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (v: boolean) => (v ? 'Sí' : 'No'),
    },
    {
      key: 'is_active',
      label: 'Estado',
      width: '100px',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (v: boolean) => (v ? 'Activa' : 'Inactiva'),
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'info',
      action: (item: ChartAccount) => this.onRowClick(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    avatarFallbackIcon: 'book',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: boolean) => (v ? 'Activa' : 'Inactiva'),
    detailKeys: [
      { key: 'account_type', label: 'Tipo' },
      { key: 'nature', label: 'Naturaleza' },
    ],
  };

  constructor() {
    this.loadAccounts();
  }

  // ─── Data loading ───────────────────────────────────────────────────────
  private loadAccounts(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.api
      .getChartOfAccounts({
        page: pag.page,
        limit: pag.limit,
        search: this.searchTerm() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.accounts.set(res.data ?? []);
          this.pagination.update((p) => ({
            ...p,
            total: res.meta?.total ?? 0,
            totalPages: res.meta?.totalPages ?? 0,
          }));
          this.loading.set(false);
        },
        error: (err) => {
          this.toast.error(
            typeof err === 'string'
              ? err
              : err?.error?.message ?? 'Error al cargar el PUC',
          );
          this.loading.set(false);
        },
      });
  }

  // ─── Handlers ───────────────────────────────────────────────────────────
  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadAccounts();
  }

  onPageChange(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadAccounts();
  }

  onSort(_event: { column: string; direction: SortDirection }): void {
    // Backend currently supports only `search`; sort wiring is a V2 concern.
  }

  onRowClick(item: ChartAccount): void {
    this.toast.info(`Cuenta ${item.code} — ${item.name}`);
  }

  // ─── Modal ──────────────────────────────────────────────────────────────
  openModal(): void {
    this.form.reset({
      code: '',
      name: '',
      parent_code: '',
      accepts_entries: true,
      is_active: true,
      description: '',
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  onSubmit(): void {
    if (this.formInvalid()) return;
    const v = this.form.getRawValue();
    const dto: CreateChartAccountDto = {
      code: v.code.trim(),
      name: v.name.trim(),
      parent_code: v.parent_code.trim(),
      accepts_entries: Boolean(v.accepts_entries),
      is_active: Boolean(v.is_active),
      description: v.description?.trim() || undefined,
    };
    this.saving.set(true);
    this.api
      .createChartAccount(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.saving.set(false);
          if (created) {
            this.toast.success(`Subcuenta ${created.code} creada.`);
            this.closeModal();
            this.pagination.update((p) => ({ ...p, page: 1 }));
            this.loadAccounts();
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo crear la subcuenta.',
          );
        },
      });
  }
}
