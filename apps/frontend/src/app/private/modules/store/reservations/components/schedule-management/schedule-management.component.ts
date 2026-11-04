import {
  Component,
  DestroyRef,
  inject,
  signal,
  computed,
} from '@angular/core';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { ReservationsService } from '../../services/reservations.service';
import { AvailableProviderUser, ServiceProvider } from '../../interfaces/reservation.interface';
import {
  IconComponent,
  ToastService,
  StickyHeaderComponent,
  CardComponent,
  InputsearchComponent,
  ButtonComponent,
  ToggleComponent,
  BadgeComponent,
  SelectorComponent,
  ResponsiveDataViewComponent,
  ModalComponent,
  ScrollableTabsComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components';
import type {
  TableColumn,
  TableAction,
  ItemListCardConfig,
  StickyHeaderActionButton,
} from '../../../../../../shared/components';
import { WeeklyScheduleEditorComponent } from './weekly-schedule-editor/weekly-schedule-editor.component';
import { ExceptionsManagerComponent } from './exceptions-manager/exceptions-manager.component';
import {
  ServiceStationsService,
  ServiceStation,
} from '../service-stations/service-stations.service';
import {
  providerDisplayName,
  providerSubtitle,
} from '../../../../../../shared/utils/provider-display-name';
import { ProviderNamePipe } from '../../../../../../shared/pipes/provider-name/provider-name.pipe';
import { STATION_TYPES_META } from '../service-stations/service-stations-page.component';

interface BookableService {
  id: number;
  name: string;
  base_price?: number;
  service_duration_minutes?: number;
}

@Component({
  selector: 'app-schedule-management',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    StickyHeaderComponent,
    CardComponent,
    InputsearchComponent,
    ButtonComponent,
    ToggleComponent,
    BadgeComponent,
    ModalComponent,
    SelectorComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    EmptyStateComponent,
    WeeklyScheduleEditorComponent,
    ExceptionsManagerComponent,
    DecimalPipe,
    ProviderNamePipe,
  ],
  templateUrl: './schedule-management.component.html',
  styleUrls: ['./schedule-management.component.scss'],
})
export class ScheduleManagementComponent {
  private reservationsService = inject(ReservationsService);
  private stationsService = inject(ServiceStationsService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  /** Estaciones solo existen en tiendas de servicio (el backend responde 403 al resto). */
  readonly hasStations = inject(AuthFacade).isServiceIndustry;

  // Detail modal
  isDetailModalOpen = signal(false);
  activeTab = signal('services');

  // Data
  providers = signal<ServiceProvider[]>([]);
  selectedProvider = signal<ServiceProvider | null>(null);
  allServices = signal<BookableService[]>([]);
  loading = signal(true);

  // Search
  searchQuery = signal('');
  filteredProviders = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.providers();
    return this.providers().filter(
      (p) =>
        (p.display_name || '').toLowerCase().includes(query) ||
        providerDisplayName(p).toLowerCase().includes(query) ||
        (p.user?.email || '').toLowerCase().includes(query),
    );
  });

  // Add provider flow
  showAddForm = signal(false);
  availableUsers = signal<AvailableProviderUser[]>([]);
  selectedUserId = signal<string | number | null>(null);
  addingProvider = signal(false);

  userOptions = computed(() =>
    this.availableUsers().map((u) => {
      const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
      return {
        value: u.id,
        label: [name, u.email].filter(Boolean).join(' — ') || `Usuario #${u.id}`,
      };
    }),
  );

  // Service management
  managingServices = signal(false);
  savingServices = signal(false);
  serviceSearchQuery = signal('');
  filteredServices = computed(() => {
    const query = this.serviceSearchQuery().toLowerCase();
    const all = this.allServices();
    if (!query) return all;
    return all.filter(s => (s.name || '').toLowerCase().includes(query));
  });

  // Station management
  allStations = signal<ServiceStation[]>([]);
  stationSearchQuery = signal('');
  assignedStationIds = signal<number[]>([]);
  loadingStations = signal(false);
  togglingStationId = signal<number | null>(null);

  filteredStations = computed(() => {
    const query = this.stationSearchQuery().toLowerCase().trim();
    const all = this.allStations();
    if (!query) return all;
    return all.filter((st) => {
      const nameMatch = (st.name || '').toLowerCase().includes(query);
      const meta = st.station_type ? STATION_TYPES_META[st.station_type] : null;
      const typeMatch = meta
        ? meta.label.toLowerCase().includes(query) ||
          meta.singularLabel.toLowerCase().includes(query)
        : false;
      return nameMatch || typeMatch;
    });
  });

  assignedStationCount = computed(() => this.assignedStationIds().length);

  // Live schedule stats (updated in real-time from editor)
  liveWeeklyHours = signal<number | null>(null);
  liveActiveDays = signal<number | null>(null);

  // Bio editing
  editingBio = signal(false);
  bioValue = signal('');
  savingBio = signal(false);

  // Modal tabs
  readonly detailTabs = computed(() => [
    { id: 'services', label: 'Servicios', icon: 'layers' },
    ...(this.hasStations() ? [{ id: 'stations', label: 'Estaciones', icon: 'warehouse' }] : []),
    { id: 'schedule', label: 'Horario', icon: 'clock' },
    { id: 'exceptions', label: 'Excepciones', icon: 'calendar-x' },
  ]);

  // Provider table columns
  providerColumns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Nombre',
      priority: 0,
      transform: (val: any, item?: any) => val || providerDisplayName(item),
    },
    { key: 'employee.position', label: 'Cargo', priority: 1, transform: (val: any, item?: any) => val || providerSubtitle(item) || 'Sin cargo' },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 0,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { true: '#10b981', false: '#9ca3af' },
      },
      transform: (val: any) => (val ? 'Activo' : 'Inactivo'),
    },
    {
      key: 'services',
      label: 'Servicios',
      priority: 1,
      transform: (val: any) => {
        if (!val?.length) return 'Sin servicios';
        if (val.length <= 2) return val.map((s: any) => s.product?.name || 'Servicio').join(', ');
        return `${val.length} servicios`;
      },
    },
  ];

  // Provider card config (mobile)
  providerCardConfig: ItemListCardConfig = {
    titleKey: 'display_name',
    titleTransform: (item: any) => providerDisplayName(item),
    subtitleKey: 'employee.position',
    subtitleTransform: (item: any) => providerSubtitle(item) || 'Sin cargo',
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      colorMap: { true: '#10b981', false: '#9ca3af' },
    },
    badgeTransform: (v: any) => (v ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'services',
        label: 'Servicios',
        icon: 'layers',
        transform: (v: any) => {
          if (!v?.length) return 'Ninguno';
          if (v.length <= 2) return v.map((s: any) => s.product?.name || 'Servicio').join(', ');
          return `${v.length} servicios`;
        },
      },
      {
        key: 'services',
        label: 'Duración prom.',
        icon: 'clock',
        transform: (v: any) => {
          if (!v?.length) return '—';
          const durations = v
            .map((s: any) => s.product?.service_duration_minutes)
            .filter((d: any) => d != null);
          if (!durations.length) return '—';
          const avg = Math.round(
            durations.reduce((a: number, b: number) => a + b, 0) / durations.length,
          );
          return `${avg} min`;
        },
      },
    ],
    footerKey: 'services',
    footerLabel: 'Servicios asignados',
    footerStyle: 'prominent',
    footerTransform: (val: any) => (val?.length ? `${val.length}` : '0'),
  };

  // Provider row actions
  providerActions: TableAction[] = [
    {
      label: 'Configurar',
      icon: 'settings',
      variant: 'info',
      action: (item: any) => this.selectProvider(item),
    },
    {
      label: ((item: any) => (item.is_active ? 'Desactivar' : 'Activar')) as any,
      icon: ((item: any) => (item.is_active ? 'toggle-right' : 'toggle-left')) as any,
      variant: (item: any) => (item.is_active ? 'success' : 'danger'),
      action: (item: any) => this.toggleActive(item),
    },
  ];

  constructor() {
    this.loadProviders();
  }

  goBack(): void {
    this.router.navigate(['/admin/reservations']);
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
    this.selectedProvider.set(null);
    this.activeTab.set('services');
    this.liveWeeklyHours.set(null);
    this.liveActiveDays.set(null);
    this.assignedStationIds.set([]);
    this.stationSearchQuery.set('');
  }

  loadProviders(): void {
    this.loading.set(true);
    this.loadAllStations();
    forkJoin([
      this.reservationsService.getProviders(),
      this.reservationsService.getBookableServices(),
    ])
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ([providers, services]) => {
          this.providers.set(providers);
          this.allServices.set(services || []);
        },
        error: () => this.toastService.error('Error al cargar proveedores'),
      });
  }

  selectProvider(provider: ServiceProvider): void {
    this.managingServices.set(false);
    this.editingBio.set(false);
    this.activeTab.set('services');
    this.stationSearchQuery.set('');
    this.isDetailModalOpen.set(true);
    this.loadProviderStations(provider.id);
    if (this.allStations().length === 0) {
      this.loadAllStations();
    }
    this.reservationsService
      .getProvider(provider.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (full) => {
          this.selectedProvider.set(full);
          const list = this.providers().map((p) => (p.id === full.id ? full : p));
          this.providers.set(list);
        },
        error: () => {
          this.selectedProvider.set(provider);
        },
      });
  }

  startAddProvider(): void {
    this.showAddForm.set(true);
    this.selectedUserId.set(null);
    this.reservationsService
      .getAvailableUsers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (users) => this.availableUsers.set(users),
        error: () => this.toastService.error('Error al cargar usuarios disponibles'),
      });
  }

  cancelAddProvider(): void {
    this.showAddForm.set(false);
    this.selectedUserId.set(null);
  }

  addProvider(): void {
    const userId = Number(this.selectedUserId());
    if (!userId) {
      this.toastService.error('Selecciona un usuario');
      return;
    }

    const user = this.availableUsers().find((u) => u.id === userId);
    const displayName = user
      ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || undefined
      : undefined;

    this.addingProvider.set(true);
    this.reservationsService
      .createProvider({ user_id: userId, display_name: displayName })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.addingProvider.set(false)),
      )
      .subscribe({
        next: (provider) => {
          this.toastService.success('Proveedor creado exitosamente');
          this.showAddForm.set(false);
          this.selectedUserId.set(null);
          this.loadProviders();
          this.selectProvider(provider);
        },
        error: () => this.toastService.error('Error al crear proveedor'),
      });
  }

  toggleActive(provider: ServiceProvider): void {
    this.reservationsService
      .updateProvider(provider.id, { is_active: !provider.is_active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          if (this.selectedProvider()?.id === updated.id) {
            this.selectedProvider.set(updated);
          }
          const list = this.providers().map((p) =>
            p.id === updated.id ? updated : p,
          );
          this.providers.set(list);
          this.toastService.success(
            updated.is_active ? 'Proveedor activado' : 'Proveedor desactivado',
          );
        },
        error: () => this.toastService.error('Error al actualizar proveedor'),
      });
  }

  toggleServiceAssignment(productId: number, assign: boolean): void {
    const provider = this.selectedProvider();
    if (!provider) return;

    const obs$ = assign
      ? this.reservationsService.assignServiceToProvider(provider.id, productId)
      : this.reservationsService.removeServiceFromProvider(provider.id, productId);

    obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.reservationsService
          .getProvider(provider.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (full) => {
              this.selectedProvider.set(full);
              const list = this.providers().map((p) =>
                p.id === full.id ? full : p,
              );
              this.providers.set(list);
            },
          });
      },
      error: () =>
        this.toastService.error('Error al actualizar asignacion de servicio'),
    });
  }

  startEditBio(): void {
    const provider = this.selectedProvider();
    this.bioValue.set(provider?.bio || '');
    this.editingBio.set(true);
  }

  saveBio(): void {
    const provider = this.selectedProvider();
    if (!provider) return;

    this.savingBio.set(true);
    this.reservationsService
      .updateProvider(provider.id, { bio: this.bioValue() })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.savingBio.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.selectedProvider.set(updated);
          const list = this.providers().map((p) =>
            p.id === updated.id ? updated : p,
          );
          this.providers.set(list);
          this.editingBio.set(false);
          this.toastService.success('Bio actualizada');
        },
        error: () => this.toastService.error('Error al guardar bio'),
      });
  }

  getInitials(provider: ServiceProvider): string {
    return providerDisplayName(provider)
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  getWeeklyHours(provider: ServiceProvider): number {
    if (!provider.schedules || provider.schedules.length === 0) return 0;
    let totalMinutes = 0;
    for (const s of provider.schedules) {
      if (!s.is_active) continue;
      const [sh, sm] = s.start_time.split(':').map(Number);
      const [eh, em] = s.end_time.split(':').map(Number);
      totalMinutes += eh * 60 + em - (sh * 60 + sm);
    }
    return Math.round(totalMinutes / 60);
  }

  getServiceCount(provider: ServiceProvider): number {
    return provider.services?.length || 0;
  }

  getActiveDaysCount(provider: ServiceProvider): number {
    if (this.liveActiveDays() !== null) return this.liveActiveDays()!;
    if (!provider.schedules) return 0;
    return provider.schedules.filter(s => s.is_active).length;
  }

  getLiveWeeklyHours(provider: ServiceProvider): number {
    if (this.liveWeeklyHours() !== null) return this.liveWeeklyHours()!;
    return this.getWeeklyHours(provider);
  }

  onScheduleChanged(stats: { activeDays: number; weeklyHours: number }): void {
    this.liveActiveDays.set(stats.activeDays);
    this.liveWeeklyHours.set(stats.weeklyHours);
  }

  isServiceAssigned(productId: number): boolean {
    const provider = this.selectedProvider();
    if (!provider?.services) return false;
    return provider.services.some((s) => s.product_id === productId);
  }

  getProviderSubtitle(provider: ServiceProvider): string {
    return providerSubtitle(provider);
  }

  getProviderDisplayName(provider: ServiceProvider): string {
    return providerDisplayName(provider);
  }

  // --- Stations Management ---

  loadAllStations(): void {
    if (!this.hasStations()) return;
    this.stationsService
      .list(1, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.allStations.set(res.data || []);
        },
        error: () => {
          // Non-blocking fallback
        },
      });
  }

  loadProviderStations(providerId: number): void {
    if (!this.hasStations()) {
      this.assignedStationIds.set([]);
      return;
    }
    this.loadingStations.set(true);
    this.reservationsService
      .getProviderStations(providerId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingStations.set(false)),
      )
      .subscribe({
        next: (ids) => {
          this.assignedStationIds.set(ids || []);
        },
        error: () => {
          this.toastService.error('Error al cargar estaciones del personal');
        },
      });
  }

  isStationAssigned(stationId: number): boolean {
    return this.assignedStationIds().includes(stationId);
  }

  toggleStationAssignment(stationId: number, assign: boolean): void {
    const provider = this.selectedProvider();
    if (!provider) return;

    this.togglingStationId.set(stationId);
    const current = this.assignedStationIds();
    const next = assign
      ? [...current, stationId]
      : current.filter((id) => id !== stationId);
    this.assignedStationIds.set(next);

    const obs$ = assign
      ? this.reservationsService.assignStationToProvider(provider.id, stationId)
      : this.reservationsService.removeStationFromProvider(provider.id, stationId);

    obs$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.togglingStationId.set(null)),
      )
      .subscribe({
        next: () => {
          this.toastService.success(
            assign ? 'Estación vinculada al personal' : 'Estación desvinculada',
          );
        },
        error: () => {
          this.assignedStationIds.set(current);
          this.toastService.error('Error al actualizar asignación de estación');
        },
      });
  }

  toggleAllStations(assignAll: boolean): void {
    const provider = this.selectedProvider();
    if (!provider) return;

    const targetIds = assignAll ? this.allStations().map((s) => s.id) : [];

    this.loadingStations.set(true);
    this.reservationsService
      .setProviderStations(provider.id, targetIds)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingStations.set(false)),
      )
      .subscribe({
        next: (ids) => {
          this.assignedStationIds.set(ids);
          this.toastService.success(
            assignAll
              ? 'Todas las estaciones asignadas'
              : 'Todas las estaciones desvinculadas',
          );
        },
        error: () => this.toastService.error('Error al actualizar estaciones'),
      });
  }

  getStationIcon(type?: string): string {
    if (!type) return 'warehouse';
    return (
      STATION_TYPES_META[type as keyof typeof STATION_TYPES_META]?.icon ||
      'warehouse'
    );
  }

  getStationTypeLabel(type?: string): string {
    if (!type) return 'General';
    return (
      STATION_TYPES_META[type as keyof typeof STATION_TYPES_META]?.singularLabel ||
      'General'
    );
  }
}

