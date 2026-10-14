import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent, CardComponent, IconComponent, ItemListCardConfig, PaginationComponent, ResponsiveDataViewComponent, TableColumn } from '../../../../../../shared/components';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { ReservationsService } from '../../services/reservations.service';
import { ServiceProvider } from '../../interfaces/reservation.interface';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { storeWallTimeToIso } from './service-stations-time.util';
import {
  ServiceStation,
  ServiceStationsService,
  StationException,
  StationProviderOption,
  StationSchedule,
  StationServiceOption,
} from './service-stations.service';

const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

@Component({
  selector: 'app-service-stations-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, CardComponent, IconComponent, ResponsiveDataViewComponent, PaginationComponent],
  templateUrl: './service-stations-page.component.html',
  styleUrl: './service-stations-page.component.scss',
})
export class ServiceStationsPageComponent implements OnInit {
  private readonly stationsApi = inject(ServiceStationsService);
  private readonly reservationsApi = inject(ReservationsService);
  private readonly router = inject(Router);
  private readonly storeSettings = inject(StoreSettingsFacade);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly stations = signal<ServiceStation[]>([]);
  readonly selectedId = signal<number | null>(null);
  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.filters().limit) || 1);
  readonly timezone = computed(() => this.storeSettings.timezone());
  readonly selectedStation = computed(() => this.stations().find((station) => station.id === this.selectedId()) ?? null);
  readonly services = signal<StationServiceOption[]>([]);
  readonly providers = signal<StationProviderOption[]>([]);
  readonly schedule = signal<StationSchedule[]>([]);
  readonly exceptions = signal<StationException[]>([]);
  readonly serviceIds = signal<number[]>([]);
  readonly providerIds = signal<number[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly showCreateForm = signal(false);
  readonly newName = signal('');
  readonly editName = signal('');
  readonly exceptionStart = signal('');
  readonly exceptionEnd = signal('');
  readonly exceptionReason = signal('');
  readonly weekdays = WEEKDAYS;
  readonly activeCount = computed(() => this.stations().filter((station) => station.status === 'active').length);
  readonly stationColumns: TableColumn[] = [
    { key: 'name', label: 'Estación', priority: 1 },
    { key: 'status', label: 'Estado', priority: 1, transform: (value: string) => value === 'active' ? 'Activa' : 'Inactiva', badge: true, badgeConfig: { type: 'status' } },
    { key: 'services', label: 'Servicios', priority: 2, transform: (value: ServiceStation['services']) => String(value?.length ?? 0) },
    { key: 'providers', label: 'Proveedores', priority: 2, transform: (value: ServiceStation['providers']) => String(value?.length ?? 0) },
  ];
  readonly stationRowClass = (station: ServiceStation): string =>
    station.id === this.selectedId() ? 'station-row--selected' : '';
  readonly stationCardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'status',
    subtitleTransform: (value: string) => value === 'active' ? 'Activa' : 'Inactiva',
    avatarFallbackIcon: 'map-pin',
    avatarShape: 'square',
    detailKeys: [
      { key: 'services', label: 'Servicios', icon: 'wrench', transform: (value: ServiceStation['services']) => String(value?.length ?? 0) },
      { key: 'providers', label: 'Proveedores', icon: 'users', transform: (value: ServiceStation['providers']) => String(value?.length ?? 0) },
    ],
  };

  ngOnInit(): void {
    this.loadStations();
    this.stationsApi.getServiceOptions().subscribe({ next: (items) => this.services.set(items), error: () => this.services.set([]) });
    this.reservationsApi.getProviders().subscribe({
      next: (items: ServiceProvider[]) => {
        this.providerRecords.set(items);
        this.providers.set(items.filter((item) => item.is_active).map((item) => ({
        id: item.id,
        display_name: item.display_name || `${item.employee?.first_name ?? ''} ${item.employee?.last_name ?? ''}`.trim() || `Proveedor ${item.id}`,
        is_active: item.is_active,
      })));
      },
      error: () => this.providers.set([]),
    });
  }

  goBack(): void { void this.router.navigate(['/admin/reservations']); }

  loadStations(selectId?: number): void {
    this.loading.set(true);
    const { page, limit } = this.filters();
    this.stationsApi.list(page, limit).subscribe({
      next: (response) => {
        const items = response.data ?? [];
        this.stations.set(items);
        this.totalItems.set(response.meta?.total ?? items.length);
        this.loading.set(false);
        const target = selectId ?? this.selectedId() ?? items[0]?.id ?? null;
        if (target && items.some((item) => item.id === target)) this.selectStation(target);
        else if (items[0]) this.selectStation(items[0].id);
        else this.selectedId.set(null);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.errorMessage.set(this.errorText(error, 'No fue posible cargar las estaciones.'));
      },
    });
  }

  onPageChange(page: number): void {
    this.filters.update((filters) => ({ ...filters, page }));
    this.selectedId.set(null);
    this.loadStations();
  }

  onStationRowClick(station: ServiceStation): void {
    if (station?.id) this.selectStation(station.id);
  }

  selectStation(id: number): void {
    this.selectedId.set(id);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    const station = this.stations().find((item) => item.id === id);
    if (!station) return;
    this.editName.set(station.name);
    this.serviceIds.set(station.services.map((item) => item.product_id));
    this.providerIds.set(station.providers.map((item) => item.provider_id));
    this.stationsApi.getSchedules(id).subscribe({
      next: (rows) => {
        this.schedule.set(WEEKDAYS.flatMap((day) => {
          const blocks = rows
            .filter((row) => row.weekday === day.value)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
            .map((row, block_order) => ({ ...row, block_order }));
          return blocks.length ? blocks : [{
            weekday: day.value, block_order: 0, start_time: '09:00', end_time: '18:00', is_active: false,
          }];
        }));
      },
      error: (error: unknown) => this.errorMessage.set(this.errorText(error, 'No fue posible cargar el horario.')),
    });
    this.loadExceptions(id);
  }

  loadExceptions(id: number): void {
    this.stationsApi.getExceptions(id).subscribe({
      next: (rows) => this.exceptions.set(rows),
      error: (error: unknown) => this.errorMessage.set(this.errorText(error, 'No fue posible cargar las excepciones.')),
    });
  }

  createStation(): void {
    const name = this.newName().trim();
    if (!name) { this.errorMessage.set('Escribe el nombre de la estación.'); return; }
    this.saving.set(true);
    this.errorMessage.set(null);
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.stationsApi.create({ name, capacity: 1 }).subscribe({
      next: (station) => {
        this.saving.set(false);
        this.showCreateForm.set(false);
        this.newName.set('');
        this.successMessage.set('Estación creada.');
        this.loadStations(station.id);
      },
      error: (error: unknown) => { this.saving.set(false); this.errorMessage.set(this.errorText(error, 'No fue posible crear la estación.')); },
    });
  }

  saveDetails(): void {
    const station = this.selectedStation();
    if (!station) return;
    const name = this.editName().trim();
    if (!name) { this.errorMessage.set('El nombre es obligatorio.'); return; }
    this.runSave(this.stationsApi.update(station.id, { name, capacity: station.capacity }), 'Datos de estación guardados.', station.id);
  }

  toggleStatus(): void {
    const station = this.selectedStation();
    if (!station) return;
    if (station.status === 'active') {
      this.runSave(this.stationsApi.deactivate(station.id), 'Estación desactivada.', station.id);
    } else {
      this.runSave(this.stationsApi.update(station.id, { status: 'active' }), 'Estación activada.', station.id);
    }
  }

  toggleService(id: number): void {
    this.serviceIds.update((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  }

  toggleProvider(id: number): void {
    this.providerIds.update((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  }

  providerSupportsSelectedServices(provider: StationProviderOption): boolean {
    const item = this.reservationsApiProvider(provider.id);
    const selected = this.serviceIds();
    return selected.length > 0 && (item?.services ?? []).some((service) => selected.includes(service.product_id));
  }

  private reservationsApiProvider(id: number): ServiceProvider | undefined {
    return this.providerRecords().find((provider) => provider.id === id);
  }

  private readonly providerRecords = signal<ServiceProvider[]>([]);

  updateSchedule(weekday: number, blockOrder: number, field: 'start_time' | 'end_time' | 'is_active', value: string | boolean): void {
    this.schedule.update((rows) => rows.map((row) => row.weekday === weekday && row.block_order === blockOrder ? { ...row, [field]: value } : row));
  }

  schedulesFor(weekday: number): StationSchedule[] {
    return this.schedule().filter((row) => row.weekday === weekday).sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  addScheduleBlock(weekday: number): void {
    this.schedule.update((rows) => {
      const dayRows = rows.filter((row) => row.weekday === weekday);
      const block_order = Math.max(-1, ...dayRows.map((row) => row.block_order ?? 0)) + 1;
      const next = rows.filter((row) => row.weekday !== weekday || row.is_active);
      next.push({ weekday, block_order, start_time: '13:00', end_time: '18:00', is_active: true });
      return next;
    });
  }

  removeScheduleBlock(weekday: number, blockOrder: number): void {
    this.schedule.update((rows) => {
      const remaining = rows.filter((row) => row.weekday !== weekday || row.block_order !== blockOrder);
      if (remaining.some((row) => row.weekday === weekday)) return remaining;
      return [...remaining, { weekday, block_order: 0, start_time: '09:00', end_time: '18:00', is_active: false }];
    });
  }

  saveSchedule(): void {
    const station = this.selectedStation();
    if (!station) return;
    const active = this.schedule().filter((row) => row.is_active);
    if (active.some((row) => row.start_time >= row.end_time)) {
      this.errorMessage.set('En cada día, la hora final debe ser posterior a la inicial.');
      return;
    }
    const overlaps = WEEKDAYS.some((day) => {
      const blocks = active.filter((row) => row.weekday === day.value).sort((a, b) => a.start_time.localeCompare(b.start_time));
      return blocks.some((row, index) => index > 0 && row.start_time < blocks[index - 1].end_time);
    });
    if (overlaps) {
      this.errorMessage.set('Los bloques del mismo día no pueden superponerse.');
      return;
    }
    this.runSave(this.stationsApi.setSchedules(station.id, active), 'Horario de estación guardado.', station.id);
  }

  addException(): void {
    const station = this.selectedStation();
    if (!station || !this.exceptionStart() || !this.exceptionEnd()) {
      this.errorMessage.set('Completa el inicio y el fin de la excepción.');
      return;
    }
    const startIso = storeWallTimeToIso(this.exceptionStart(), this.timezone());
    const endIso = storeWallTimeToIso(this.exceptionEnd(), this.timezone());
    if (!startIso || !endIso) {
      this.errorMessage.set(`La hora indicada no existe en ${this.timezone()} por un cambio de horario. Elige otra hora.`);
      return;
    }
    this.saving.set(true);
    this.stationsApi.createException(station.id, {
      start_at: startIso, end_at: endIso, reason: this.exceptionReason().trim() || undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.exceptionStart.set(''); this.exceptionEnd.set(''); this.exceptionReason.set('');
        this.loadExceptions(station.id);
        this.successMessage.set('Excepción agregada.');
      },
      error: (error: unknown) => { this.saving.set(false); this.errorMessage.set(this.errorText(error, 'No fue posible agregar la excepción.')); },
    });
  }

  formatExceptionTime(value: string): string {
    return formatStoreDateTime(value, this.timezone(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  deleteException(exceptionId: number): void {
    const station = this.selectedStation();
    if (!station) return;
    this.stationsApi.deleteException(station.id, exceptionId).subscribe({
      next: () => { this.loadExceptions(station.id); this.successMessage.set('Excepción eliminada.'); },
      error: (error: unknown) => this.errorMessage.set(this.errorText(error, 'No fue posible eliminar la excepción.')),
    });
  }

  saveServices(): void {
    const station = this.selectedStation();
    if (!station) return;
    this.runSave(this.stationsApi.setServices(station.id, this.serviceIds()), 'Servicios compatibles guardados.', station.id);
  }

  saveProviders(): void {
    const station = this.selectedStation();
    if (!station) return;
    this.runSave(this.stationsApi.setProviders(station.id, this.providerIds()), 'Proveedores compatibles guardados.', station.id);
  }

  private runSave<T>(request: import('rxjs').Observable<T>, message: string, stationId: number): void {
    this.saving.set(true);
    this.errorMessage.set(null);
    request.subscribe({
      next: () => { this.saving.set(false); this.successMessage.set(message); this.loadStations(stationId); },
      error: (error: unknown) => { this.saving.set(false); this.errorMessage.set(this.errorText(error, 'No fue posible guardar los cambios.')); },
    });
  }

  private errorText(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'error' in error) {
      const body = (error as { error?: { message?: string | string[] } }).error;
      if (Array.isArray(body?.message)) return body.message.join(' ');
      if (body?.message) return body.message;
    }
    return fallback;
  }
}
