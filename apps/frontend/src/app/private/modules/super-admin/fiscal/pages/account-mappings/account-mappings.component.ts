import {
  Component,
  DestroyRef,
  computed,
  effect,
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
  ItemListCardConfig,
  ModalComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
  SortDirection,
  SpinnerComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components';
import { AccountSelectComponent } from '../../../../../../shared/components/account-select/account-select.component';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { AccountMapping } from '../../interfaces/superadmin-fiscal.interface';
import { SuperadminFiscalService } from '../../services/superadmin-fiscal.service';

const PREFIX_OPTIONS: SelectorOption[] = [
  { value: '', label: 'Todos los prefijos' },
  { value: 'saas_', label: 'SaaS' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'payment', label: 'Payment' },
  { value: 'expense', label: 'Expense' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'tax', label: 'Tax' },
];

/**
 * EL FORMULARIO GUARDA EL ID, NO EL CÓDIGO.
 *
 * Antes era `account_code: FormControl<string>` y el submit no lo miraba: mandaba
 * `m.override_account_id ?? m.account_id`, o sea la cuenta que el mapeo YA tenía.
 * Elegir otra cuenta y guardar devolvía 200 y un toast de éxito sin cambiar nada.
 *
 * `SetMappingOverrideDto` exige `account_id: number`, y `app-account-select` es
 * un CVA cuyo valor ya es ese id: el formulario y el contrato del backend hablan
 * la misma moneda, sin traducción intermedia que se pueda olvidar.
 */
interface OverrideForm {
  account_id: FormControl<number | null>;
}

interface MappingStats {
  total: number;
  defaults: number;
  organization: number;
  partner: number;
}

@Component({
  selector: 'app-account-mappings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    SpinnerComponent,
    StatsComponent,
    AccountSelectComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        @if (stats(); as s) {
          <app-stats
            title="Total Mapeos"
            [value]="s.total"
            iconName="link"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          />
          <app-stats
            title="Por Defecto"
            [value]="s.defaults"
            iconName="lock"
            iconBgColor="bg-gray-100"
            iconColor="text-gray-600"
            [clickable]="false"
          />
          <app-stats
            title="Organización"
            [value]="s.organization"
            iconName="building-2"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          />
          <app-stats
            title="Partner"
            [value]="s.partner"
            iconName="handshake"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
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
        <!-- Filter header (sticky on mobile) -->
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
              Llaves de Mapeo ({{ mappings().length }})
            </h2>
            <div class="w-full md:w-72">
              <app-selector
                size="sm"
                variant="outline"
                label="Filtrar por prefijo"
                [options]="prefixOptions"
                [ngModel]="prefixFilter()"
                (ngModelChange)="onPrefixChange($any($event))"
              />
            </div>
          </div>
        </div>

        <!-- Data content -->
        <div class="relative p-2 md:p-4">
          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <app-spinner size="md" label="Cargando mapeos…" />
            </div>
          }

          @if (!loading() && mappings().length === 0) {
            <app-empty-state
              icon="link"
              title="Sin mapeos"
              description="No hay mapeos contables para el prefijo seleccionado."
              [showActionButton]="false"
            />
          }

          @if (!loading() && mappings().length > 0) {
            <app-responsive-data-view
              [data]="mappings()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [loading]="loading()"
              [sortable]="true"
              (sort)="onSort($event)"
              (rowClick)="onRowClick($any($event))"
            />
          }
        </div>
      </app-card>
    </div>

    <!-- Override modal -->
    <app-modal
      [isOpen]="modalOpen()"
      title="Override de mapeo"
      [subtitle]="overrideSubtitle()"
      size="md"
      (closed)="closeModal()"
    >
      <form
        [formGroup]="form"
        (ngSubmit)="onSubmit()"
        class="space-y-4"
        autocomplete="off"
      >
        <div>
          <label
            class="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
          >
            Cuenta PUC destino
            <span class="text-[var(--color-destructive)]">*</span>
          </label>
          <!--
            app-account-select y no app-selector con [ngModel]. Dos motivos, y
            ninguno es de gusto:

            1. ngModel dentro de un formGroup sin standalone lanza NG01350 en
               tiempo de ejecución y aborta la detección de cambios — el modal
               entero quedaba muerto al abrirse.
            2. app-selector recibía las 200 primeras cuentas cargadas de una:
               con un PUC completo la cuenta buscada podía sencillamente no
               estar en la lista. Este selector busca en el servidor por código
               o por nombre y arranca con 5.
          -->
          <app-account-select
            formControlName="account_id"
            scope="super-admin/fiscal"
            placeholder="Busca por código o nombre…"
          />
          <p class="text-xs text-text-secondary mt-1.5">
            Por defecto: {{ selectedMapping()?.account_code }} —
            {{ selectedMapping()?.account_name }}
          </p>
        </div>
      </form>

      <div slot="footer" class="flex items-center justify-end gap-2">
        @if (selectedMapping()?.override_account_code) {
          <app-button
            variant="outline-danger"
            size="md"
            label="Restablecer"
            (clicked)="onReset()"
          />
        }
        <app-button
          variant="outline"
          size="md"
          label="Cancelar"
          (clicked)="closeModal()"
        />
        <app-button
          variant="primary"
          size="md"
          label="Guardar override"
          [loading]="saving()"
          [disabled]="formInvalid()"
          (clicked)="onSubmit()"
        />
      </div>
    </app-modal>
  `,
})
export class AccountMappingsComponent {
  private readonly api = inject(SuperadminFiscalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  readonly mappings = signal<AccountMapping[]>([]);
  readonly loading = signal<boolean>(false);
  readonly saving = signal<boolean>(false);
  readonly prefixFilter = signal<string>('');
  readonly modalOpen = signal<boolean>(false);
  readonly selectedMapping = signal<AccountMapping | null>(null);

  readonly prefixOptions: SelectorOption[] = PREFIX_OPTIONS;

  readonly overrideSubtitle = computed(() => {
    const m = this.selectedMapping();
    if (!m) return '';
    return `Llave: ${m.mapping_key}`;
  });

  // ─── Stats derivadas de la cascada (default/org/partner) ───────────────
  readonly stats = computed<MappingStats>(() => {
    const list = this.mappings();
    return {
      total: list.length,
      defaults: list.filter((m) => (m.source ?? 'default') === 'default').length,
      organization: list.filter((m) => m.source === 'organization').length,
      partner: list.filter((m) => m.source === 'partner').length,
    };
  });

  // ─── Form ──────────────────────────────────────────────────────────────
  readonly form: FormGroup<OverrideForm> = this.fb.group<OverrideForm>({
    account_id: this.fb.control<number | null>(null, {
      validators: [Validators.required],
    }),
  });

  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  readonly formInvalid = computed(() => this.formStatus() !== 'VALID');

  // ─── Table config ───────────────────────────────────────────────────────
  readonly columns: TableColumn[] = [
    {
      key: 'mapping_key',
      label: 'Llave',
      sortable: true,
      priority: 1,
    },
    {
      key: 'account_code',
      label: 'Cuenta',
      width: '160px',
      priority: 1,
    },
    {
      key: 'account_name',
      label: 'Nombre cuenta',
      priority: 1,
    },
    {
      key: 'source',
      label: 'Origen',
      width: '120px',
      align: 'center',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          default: '#6b7280',
          organization: '#3b82f6',
          partner: '#a855f7',
        },
      },
      transform: (v: string) => v ?? 'default',
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Override',
      icon: 'edit-2',
      variant: 'primary',
      action: (item: AccountMapping) => this.openModal(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'mapping_key',
    subtitleKey: 'account_name',
    avatarFallbackIcon: 'link',
    avatarShape: 'square',
    detailKeys: [
      { key: 'account_code', label: 'Cuenta' },
      { key: 'source', label: 'Origen' },
    ],
  };

  constructor() {
    // Ya no se precargan 200 cuentas al montar: `app-account-select` pide sus
    // 5 primeras cuando se abre y el resto por búsqueda en servidor.
    effect(() => {
      // Reload when prefix changes.
      const p = this.prefixFilter();
      this.loadMappings(p || undefined);
    });
  }

  // ─── Loaders ────────────────────────────────────────────────────────────
  private loadMappings(prefix?: string): void {
    this.loading.set(true);
    this.api
      .getAccountMappings(prefix)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.mappings.set(list);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.toast.error(parseApiError(err).userMessage);
          this.loading.set(false);
        },
      });
  }

  // ─── Handlers ───────────────────────────────────────────────────────────
  onPrefixChange(value: string): void {
    this.prefixFilter.set(value);
  }

  onSort(_event: { column: string; direction: SortDirection }): void {
    // client-side sort would happen here in V2
  }

  onRowClick(item: AccountMapping): void {
    this.openModal(item);
  }

  // ─── Modal ──────────────────────────────────────────────────────────────
  openModal(item: AccountMapping): void {
    this.selectedMapping.set(item);
    // El override vigente si lo hay, si no la cuenta por defecto del mapeo.
    // `app-account-select` hidrata el chip por id contra el backend, así que
    // basta el número: no hace falta arrastrar código ni nombre.
    this.form.reset({
      account_id: item.override_account_id ?? item.account_id ?? null,
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.selectedMapping.set(null);
  }

  onSubmit(): void {
    if (this.formInvalid()) return;
    const m = this.selectedMapping();
    if (!m) return;
    // LA CUENTA QUE ELIGIÓ EL USUARIO, no la que el mapeo ya tenía. La versión
    // anterior mandaba `m.override_account_id ?? m.account_id`, así que guardar
    // reescribía el mismo valor: 200, toast de éxito, y el override sin cambiar.
    const target_id = this.form.controls.account_id.value;
    if (target_id == null) {
      this.toast.error('Elige la cuenta PUC destino antes de guardar.');
      return;
    }
    this.saving.set(true);
    this.api
      .setMappingOverride(m.mapping_key, target_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(`Override guardado para ${m.mapping_key}.`);
          this.closeModal();
          this.loadMappings(this.prefixFilter() || undefined);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.toast.error(parseApiError(err).userMessage);
        },
      });
  }

  onReset(): void {
    const m = this.selectedMapping();
    if (!m) return;
    this.saving.set(true);
    this.api
      .resetMappingOverride(m.mapping_key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(`Override restablecido para ${m.mapping_key}.`);
          this.closeModal();
          this.loadMappings(this.prefixFilter() || undefined);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.toast.error(parseApiError(err).userMessage);
        },
      });
  }
}
