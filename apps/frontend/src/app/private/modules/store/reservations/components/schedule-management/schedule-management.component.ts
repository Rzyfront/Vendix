import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, takeUntil, finalize, forkJoin } from 'rxjs';
import { ReservationsService } from '../../services/reservations.service';
import { ServiceProvider } from '../../interfaces/reservation.interface';
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
} from '../../../../../../shared/components';
import type {
  TableColumn,
  TableAction,
  ItemListCardConfig,
  StickyHeaderActionButton,
} from '../../../../../../shared/components';
import { WeeklyScheduleEditorComponent } from './weekly-schedule-editor/weekly-schedule-editor.component';
import { ExceptionsManagerComponent } from './exceptions-manager/exceptions-manager.component';

interface AvailableEmployee {
  id: number;
  first_name: string;
  last_name: string;
  position?: string;
}

interface BookableService {
  id: number;
  name: string;
  base_price?: number;
  service_duration_minutes?: number;
}

@Component({
  selector: 'app-schedule-management',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
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
    WeeklyScheduleEditorComponent,
    ExceptionsManagerComponent,
  ],
  templateUrl: './schedule-management.component.html',
  styleUrls: ['./schedule-management.component.scss'],
})
export class ScheduleManagementComponent implements OnInit, OnDestroy {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

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
        (p.employee?.first_name || '').toLowerCase().includes(query) ||
        (p.employee?.last_name || '').toLowerCase().includes(query),
    );
  });

  // Add provider flow
  showAddForm = signal(false);
  availableEmployees = signal<AvailableEmployee[]>([]);
  selectedEmployeeId = signal<string | number | null>(null);
  addingProvider = signal(false);

  employeeOptions = computed(() =>
    this.availableEmployees().map(emp => ({
      value: emp.id,
      label: `${emp.first_name} ${emp.last_name}`,
      description: emp.position || '',
    })),
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

  // Bio editing
  editingBio = signal(false);
  bioValue = signal('');
  savingBio = signal(false);

  // Modal tabs
  readonly detailTabs = [
    { id: 'services', label: 'Servicios' },
    { id: 'schedule', label: 'Horario' },
    { id: 'exceptions', label: 'Excepciones' },
  ];

  // Provider table columns
  providerColumns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Nombre',
      priority: 0,
      transform: (val: any, item?: any) =>
        val || `${item?.employee?.first_name || ''} ${item?.employee?.last_name || ''}`.trim(),
    },
    { key: 'employee.position', label: 'Cargo', priority: 1, transform: (val: any) => val || 'Sin cargo' },
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
      priority: 2,
      transform: (val: any) =>
        val?.length ? `${val.length} servicio${val.length > 1 ? 's' : ''}` : 'Sin servicios',
    },
  ];

  // Provider card config (mobile)
  providerCardConfig: ItemListCardConfig = {
    titleKey: 'display_name',
    titleTransform: (item: any) =>
      item.display_name || `${item.employee?.first_name || ''} ${item.employee?.last_name || ''}`.trim(),
    subtitleKey: 'employee.position',
    subtitleTransform: (item: any) => item.employee?.position || 'Sin cargo',
    avatarFallbackIcon: 'user',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      colorMap: { true: '#10b981', false: '#9ca3af' },
    },
    footerKey: 'services',
    footerTransform: (val: any) =>
      val?.length ? `${val.length} servicio${val.length > 1 ? 's' : ''}` : 'Sin servicios',
  };

  // Provider row actions
  providerActions: TableAction[] = [
    {
      label: 'Configurar',
      icon: 'settings',
      variant: 'primary',
      action: (item: any) => this.selectProvider(item),
    },
    {
      label: ((item: any) => (item.is_active ? 'Desactivar' : 'Activar')) as any,
      icon: 'toggle-right',
      variant: 'ghost',
      action: (item: any) => this.toggleActive(item),
    },
  ];

  ngOnInit(): void {
    this.loadProviders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.router.navigate(['/admin/reservations']);
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
    this.selectedProvider.set(null);
    this.activeTab.set('services');
  }

  loadProviders(): void {
    this.loading.set(true);
    forkJoin([
      this.reservationsService.getProviders(),
      this.reservationsService.getBookableServices(),
    ])
      .pipe(
        takeUntil(this.destroy$),
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
    this.isDetailModalOpen.set(true);
    this.reservationsService
      .getProvider(provider.id)
      .pipe(
        takeUntil(this.destroy$),
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
    this.selectedEmployeeId.set(null);
    this.reservationsService
      .getAvailableEmployees()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (employees) => this.availableEmployees.set(employees),
        error: () => this.toastService.error('Error al cargar empleados disponibles'),
      });
  }

  addProvider(): void {
    const employeeId = Number(this.selectedEmployeeId());
    if (!employeeId) {
      this.toastService.error('Selecciona un empleado');
      return;
    }

    const employee = this.availableEmployees().find((e) => e.id === employeeId);
    const displayName = employee
      ? `${employee.first_name} ${employee.last_name}`
      : undefined;

    this.addingProvider.set(true);
    this.reservationsService
      .createProvider({ employee_id: employeeId, display_name: displayName })
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.addingProvider.set(false)),
      )
      .subscribe({
        next: (provider) => {
          this.toastService.success('Proveedor creado exitosamente');
          this.showAddForm.set(false);
          this.loadProviders();
          this.selectProvider(provider);
        },
        error: () => this.toastService.error('Error al crear proveedor'),
      });
  }

  toggleActive(provider: ServiceProvider): void {
    this.reservationsService
      .updateProvider(provider.id, { is_active: !provider.is_active })
      .pipe(takeUntil(this.destroy$))
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

    obs$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.reservationsService
          .getProvider(provider.id)
          .pipe(takeUntil(this.destroy$))
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
        takeUntil(this.destroy$),
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
    const name =
      provider.display_name ||
      `${provider.employee?.first_name ?? ''} ${provider.employee?.last_name ?? ''}`;
    return name
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

  isServiceAssigned(productId: number): boolean {
    const provider = this.selectedProvider();
    if (!provider?.services) return false;
    return provider.services.some((s) => s.product_id === productId);
  }

  getProviderDisplayName(provider: ServiceProvider): string {
    return (
      provider.display_name ||
      `${provider.employee?.first_name ?? ''} ${provider.employee?.last_name ?? ''}`.trim()
    );
  }
}
