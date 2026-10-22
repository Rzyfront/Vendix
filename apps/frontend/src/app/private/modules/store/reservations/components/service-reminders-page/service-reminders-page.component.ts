import {
  Component,
  DestroyRef,
  TemplateRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { BadgeVariant } from '../../../../../../shared/components/badge/badge.component';
import {
  DaysRemainingBadgeComponent,
  describeDaysRemaining,
} from './components/days-remaining-badge/days-remaining-badge.component';
import { ServiceRegistryService } from './service-registry.service';
import {
  ServiceRegistryFilter,
  ServiceRegistryRow,
  ServiceRegistryStats,
} from './service-registry.interfaces';

/** Fila + campos derivados para la tabla / cards (calculados una vez por carga). */
interface RegistryViewRow extends ServiceRegistryRow {
  customer_name: string;
  service_name: string;
  station_name: string;
  subject_display: string;
  service_date_label: string;
  next_due_label: string;
  countdown_text: string;
  countdown_variant: BadgeVariant;
  reminder_label: string;
}

const VARIANT_COLORS: Record<BadgeVariant, string> = {
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',
  neutral: '#6b7280',
  primary: '#2563eb',
  info: '#2563eb',
  service: '#7c3aed',
};

/** Fecha date-only (YYYY-MM-DD) → "3 oct 2026" sin corrimiento de zona horaria. */
function formatDateOnly(value: string | null): string {
  if (!value) return '—';
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('es-CO', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function reminderLabel(row: ServiceRegistryRow): string {
  const r = row.reminder;
  if (!r) return 'Sin contactar';
  if (r.status === 'dismissed') return 'Descartado';
  if (r.status === 'sent') {
    const via = r.channel === 'whatsapp' ? 'WhatsApp' : r.channel === 'email' ? 'correo' : r.channel;
    return `Contactado por ${via}`;
  }
  return 'Pendiente';
}

@Component({
  selector: 'app-service-reminders-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    DaysRemainingBadgeComponent,
  ],
  templateUrl: './service-reminders-page.component.html',
})
export class ServiceRemindersPageComponent {
  /** Dentro de Estaciones de Servicio (pestaña) no muestra su propio encabezado. */
  readonly embedded = input(false);
  private readonly registry = inject(ServiceRegistryService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<RegistryViewRow[]>([]);
  readonly stats = signal<ServiceRegistryStats>({ total: 0, recurring: 0, due_soon: 0, overdue: 0 });
  readonly loading = signal(false);
  readonly busyKey = signal<string | null>(null);

  readonly filter = signal<ServiceRegistryFilter>('all');
  readonly searchTerm = signal('');
  readonly pageState = signal({ page: 1, limit: 20 });
  readonly totalItems = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.pageState().limit) || 1);
  readonly filterValues = computed<FilterValues>(() => ({ filter: this.filter() }));
  readonly hasFilters = computed(() => this.filter() !== 'all' || this.searchTerm().length > 0);

  private readonly countdownTpl = viewChild<TemplateRef<unknown>>('countdownTpl');

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'filter',
      label: 'Mostrar',
      type: 'select',
      options: [
        { value: 'all', label: 'Todos los servicios' },
        { value: 'recurring', label: 'Recurrentes vigentes' },
        { value: 'due_soon', label: 'Vencen pronto (≤ 3 días)' },
        { value: 'overdue', label: 'Vencidos' },
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [{ label: 'Actualizar', icon: 'refresh-cw', action: 'refresh' }];

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'customer_name', label: 'Cliente', priority: 1 },
    { key: 'service_name', label: 'Servicio', priority: 1 },
    { key: 'station_name', label: 'Estación', priority: 2 },
    { key: 'subject_display', label: 'Vehículo / sujeto', priority: 2 },
    { key: 'service_date_label', label: 'Fecha del servicio', priority: 1 },
    { key: 'next_due_label', label: 'Próxima vez', priority: 2 },
    { key: 'countdown_text', label: 'Estado', priority: 1, template: this.countdownTpl() },
    { key: 'reminder_label', label: 'Recordatorio', priority: 3 },
  ]);

  readonly actions: TableAction[] = [
    {
      label: 'Correo',
      icon: 'mail',
      variant: 'info',
      action: (row: RegistryViewRow) => this.sendEmail(row),
      disabled: (row: RegistryViewRow) => !row.customer.email || this.busyKey() === row.row_key,
      tooltip: (row: RegistryViewRow) =>
        row.customer.email ? `Enviar mensaje a ${row.customer.email}` : 'El cliente no tiene correo registrado',
    },
    {
      label: 'WhatsApp',
      icon: 'message-circle',
      variant: 'success',
      action: (row: RegistryViewRow) => this.openWhatsapp(row),
      disabled: (row: RegistryViewRow) => !row.customer.phone || this.busyKey() === row.row_key,
      tooltip: (row: RegistryViewRow) =>
        row.customer.phone ? `Abrir WhatsApp con ${row.customer.phone}` : 'El cliente no tiene teléfono registrado',
    },
    {
      label: 'Descartar',
      icon: 'x-circle',
      variant: 'muted',
      action: (row: RegistryViewRow) => this.dismiss(row),
      show: (row: RegistryViewRow) => row.service.is_recurring && row.recurrence_status !== 'superseded',
      disabled: (row: RegistryViewRow) => !row.can_dismiss || this.busyKey() === row.row_key,
      tooltip: (row: RegistryViewRow) =>
        !row.customer.registered
          ? 'Solo se pueden descartar recordatorios de clientes registrados'
          : row.reminder?.status === 'dismissed'
            ? 'Ya fue descartado'
            : 'Descartar este recordatorio',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'customer_name',
    subtitleTransform: (row: RegistryViewRow) =>
      [row.service_name, row.subject_display !== '—' ? row.subject_display : null].filter(Boolean).join(' · '),
    avatarFallbackIcon: 'clipboard-list',
    avatarShape: 'square',
    badgeKey: 'countdown_text',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorFn: (_value: unknown, row?: RegistryViewRow) => (row ? VARIANT_COLORS[row.countdown_variant] : null),
    },
    detailKeys: [
      { key: 'station_name', label: 'Estación', icon: 'warehouse' },
      { key: 'service_date_label', label: 'Servicio', icon: 'calendar' },
      { key: 'next_due_label', label: 'Próxima vez', icon: 'calendar-clock' },
      { key: 'reminder_label', label: 'Recordatorio', icon: 'bell' },
    ],
  };

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    const { page, limit } = this.pageState();
    this.registry
      .list({ filter: this.filter(), search: this.searchTerm() || undefined, page, limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res?.data ?? [];
          this.rows.set(data.map((row) => this.toView(row)));
          this.totalItems.set(res?.meta?.total ?? data.length);
          if (res?.meta?.stats) this.stats.set(res.meta.stats);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('No se pudo cargar el registro de servicios');
        },
      });
  }

  private toView(row: ServiceRegistryRow): RegistryViewRow {
    const countdown = describeDaysRemaining(row.recurrence_status, row.days_remaining, row.reminder?.status);
    return {
      ...row,
      customer_name: row.customer.name,
      service_name: row.service.name,
      station_name: row.station?.name ?? (row.source === 'order' ? 'Venta directa' : '—'),
      subject_display: row.subject?.display || '—',
      service_date_label: formatDateOnly(row.service_local_date),
      next_due_label: row.next_due_date ? formatDateOnly(row.next_due_date) : '—',
      countdown_text: countdown.text,
      countdown_variant: countdown.variant,
      reminder_label: reminderLabel(row),
    };
  }

  setFilter(filter: ServiceRegistryFilter): void {
    this.filter.set(filter);
    this.pageState.update((s) => ({ ...s, page: 1 }));
    this.load();
  }

  onFilterChange(values: FilterValues): void {
    const value = (values['filter'] as ServiceRegistryFilter | undefined) || 'all';
    this.setFilter(value);
  }

  onSearch(term: string): void {
    this.searchTerm.set((term ?? '').trim());
    this.pageState.update((s) => ({ ...s, page: 1 }));
    this.load();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.setFilter('all');
  }

  onPageChange(page: number): void {
    this.pageState.update((s) => ({ ...s, page }));
    this.load();
  }

  onDropdownAction(action: string): void {
    if (action === 'refresh') this.load();
  }

  private sendEmail(row: RegistryViewRow): void {
    this.busyKey.set(row.row_key);
    this.registry
      .sendEmail(row)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyKey.set(null);
          this.toast.success(`Mensaje enviado a ${row.customer.email}`);
          this.load();
        },
        error: (error: { error?: { message?: string } }) => {
          this.busyKey.set(null);
          this.toast.error(error?.error?.message || 'No se pudo enviar el correo');
        },
      });
  }

  private openWhatsapp(row: RegistryViewRow): void {
    // Se abre la pestaña de forma síncrona (gesto del usuario) para que el
    // navegador no la bloquee como popup; luego se le asigna la URL.
    const tab = window.open('', '_blank');
    this.busyKey.set(row.row_key);
    this.registry
      .whatsapp(row)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busyKey.set(null);
          if (res?.url) {
            if (tab) {
              tab.opener = null;
              tab.location.href = res.url;
            } else {
              window.open(res.url, '_blank', 'noopener');
            }
          } else {
            tab?.close();
          }
          this.load();
        },
        error: (error: { error?: { message?: string } }) => {
          tab?.close();
          this.busyKey.set(null);
          this.toast.error(error?.error?.message || 'No se pudo preparar el mensaje de WhatsApp');
        },
      });
  }

  private dismiss(row: RegistryViewRow): void {
    this.busyKey.set(row.row_key);
    this.registry
      .dismiss(row)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyKey.set(null);
          this.toast.success('Recordatorio descartado');
          this.load();
        },
        error: (error: { error?: { message?: string } }) => {
          this.busyKey.set(null);
          this.toast.error(error?.error?.message || 'No se pudo descartar el recordatorio');
        },
      });
  }
}
