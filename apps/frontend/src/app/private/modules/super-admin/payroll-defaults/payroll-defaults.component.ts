import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';


import {
  PayrollSystemDefault,
  CreatePayrollDefaultDto,
  UpdatePayrollDefaultDto} from './interfaces';
import { PayrollDefaultsApiService } from './services';
import { PayrollDefaultsFormComponent } from './components';
import {
  TableColumn,
  TableAction,
  ButtonComponent,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  EmptyStateComponent,
  CardComponent} from '../../../../shared/components/index';

@Component({
  selector: 'app-payroll-defaults',
  standalone: true,
  imports: [
    PayrollDefaultsFormComponent,
    ButtonComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    CardComponent
],
  template: `
    <div class="flex flex-col gap-6">
      <!-- Main Content Card -->
      <app-card [padding]="false" overflow="hidden">
        <!-- Header -->
        <div class="p-2 md:px-6 md:py-4 border-b border-[var(--color-border)] flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div class="flex-1 min-w-0">
            <h3 class="text-lg font-semibold text-text-primary">Parámetros de Nómina por Año</h3>
            <p class="hidden sm:block text-xs text-text-secondary mt-0.5">
              Gestiona los parámetros legales de nómina para cada año fiscal
            </p>
          </div>
          <div class="flex items-center gap-2">
            <app-button
              variant="primary"
              size="sm"
              iconName="plus"
              (clicked)="openCreateModal()"
            >
              <span class="hidden sm:inline">Nuevo año fiscal</span>
              <span class="sm:hidden">Nuevo</span>
            </app-button>
          </div>
        </div>

        <!-- Table Container -->
        <div class="relative min-h-[300px] p-2 md:p-4">
          @if (isLoading()) {
            <div class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          }

          @if (!isLoading() && records().length === 0) {
            <div class="p-8 flex justify-center w-full">
              <app-empty-state
                icon="banknote"
                title="Sin parámetros registrados"
                description="Crea el primer conjunto de parámetros de nómina para un año fiscal"
                actionButtonText="Nuevo año fiscal"
                [showActionButton]="true"
                (actionClick)="openCreateModal()"
              ></app-empty-state>
            </div>
          }

          @if (records().length > 0) {
            <app-responsive-data-view
              [columns]="tableColumns"
              [data]="records()"
              [actions]="tableActions"
              [cardConfig]="cardConfig"
              [loading]="isLoading()"
            ></app-responsive-data-view>
          }
        </div>
      </app-card>
    </div>

    <!-- Modal Form -->
    <app-payroll-defaults-form
      [isOpen]="showFormModal()"
      (isOpenChange)="showFormModal.set($event)"
      [record]="selectedRecord()"
      [isSubmitting]="isSubmitting()"
      (submitCreate)="onCreate($event)"
      (submitUpdate)="onUpdate($event)"
    ></app-payroll-defaults-form>
  `,
  styles: []})
export class PayrollDefaultsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private api = inject(PayrollDefaultsApiService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  records = signal<PayrollSystemDefault[]>([]);
  isLoading = signal(false);
  isSubmitting = signal(false);
  showFormModal = signal(false);
  selectedRecord = signal<PayrollSystemDefault | null>(null);
tableColumns: TableColumn[] = [
    { key: 'year', label: 'Año', sortable: true, priority: 1 },
    { key: 'decree_ref', label: 'Decreto', sortable: false, priority: 2 },
    {
      key: 'is_published',
      label: 'Estado',
      sortable: false,
      badge: true,
      priority: 1,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: boolean) => (value ? 'Publicado' : 'Borrador')},
    {
      key: 'published_at',
      label: 'Publicado',
      sortable: true,
      priority: 3,
      transform: (value: string | null) =>
        value ? new Date(value).toLocaleDateString('es-CO') : '—'},
    {
      key: 'updated_at',
      label: 'Actualizado',
      sortable: true,
      priority: 3,
      transform: (value: string) =>
        new Date(value).toLocaleDateString('es-CO')},
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'year',
    subtitleKey: 'decree_ref',
    badgeKey: 'is_published',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: boolean) => (value ? 'Publicado' : 'Borrador'),
    detailKeys: [
      { key: 'published_at', label: 'Publicado' },
    ]};

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (rec: PayrollSystemDefault) => this.openEditModal(rec),
      variant: 'info',
      show: (rec: PayrollSystemDefault) => !rec.is_published},
    {
      label: 'Ver',
      icon: 'eye',
      action: (rec: PayrollSystemDefault) => this.openViewModal(rec),
      variant: 'secondary',
      show: (rec: PayrollSystemDefault) => rec.is_published},
    {
      label: 'Publicar',
      icon: 'send',
      action: (rec: PayrollSystemDefault) => this.confirmPublish(rec),
      variant: 'success',
      show: (rec: PayrollSystemDefault) => !rec.is_published},
    {
      label: 'Despublicar',
      icon: 'archive',
      action: (rec: PayrollSystemDefault) => this.confirmUnpublish(rec),
      variant: 'danger',
      show: (rec: PayrollSystemDefault) => rec.is_published},
  ];

  ngOnInit(): void {
    this.loadRecords();
  }
loadRecords(): void {
    this.isLoading.set(true);
    this.api
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.records.set(response.data || []);
          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Error loading payroll defaults:', err);
          this.toastService.error('Error al cargar los parámetros de nómina');
          this.isLoading.set(false);
        }});
  }

  openCreateModal(): void {
    this.selectedRecord.set(null);
    this.showFormModal.set(true);
  }

  openEditModal(rec: PayrollSystemDefault): void {
    this.selectedRecord.set(rec);
    this.showFormModal.set(true);
  }

  openViewModal(rec: PayrollSystemDefault): void {
    this.selectedRecord.set(rec);
    this.showFormModal.set(true);
  }

  onCreate(dto: CreatePayrollDefaultDto): void {
    this.isSubmitting.set(true);
    this.api
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showFormModal.set(false);
          this.loadRecords();
          this.toastService.success('Año fiscal creado exitosamente');
          this.isSubmitting.set(false);
        },
        error: (err) => {
          console.error('Error creating payroll default:', err);
          this.toastService.error(
            err.error?.message || 'Error al crear el año fiscal',
          );
          this.isSubmitting.set(false);
        }});
  }

  onUpdate(dto: UpdatePayrollDefaultDto): void {
    const rec = this.selectedRecord();
    if (!rec) return;

    this.isSubmitting.set(true);
    this.api
      .update(rec.year, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showFormModal.set(false);
          this.selectedRecord.set(null);
          this.loadRecords();
          this.toastService.success('Parámetros actualizados exitosamente');
          this.isSubmitting.set(false);
        },
        error: (err) => {
          console.error('Error updating payroll default:', err);
          this.toastService.error(
            err.error?.message || 'Error al actualizar los parámetros',
          );
          this.isSubmitting.set(false);
        }});
  }

  confirmPublish(rec: PayrollSystemDefault): void {
    this.dialogService
      .confirm({
        title: `Publicar parámetros ${rec.year}`,
        message: `¿Publicar los parámetros de nómina para ${rec.year}? Esto notificará a todas las organizaciones y los parámetros estarán disponibles para calcular nóminas.`,
        confirmText: 'Publicar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary'})
      .then((confirmed) => {
        if (confirmed) {
          this.publishRecord(rec);
        }
      });
  }

  confirmUnpublish(rec: PayrollSystemDefault): void {
    this.dialogService
      .confirm({
        title: `Despublicar parámetros ${rec.year}`,
        message: `¿Despublicar los parámetros de nómina para ${rec.year}? Las organizaciones dejarán de usarlos como referencia activa.`,
        confirmText: 'Despublicar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger'})
      .then((confirmed) => {
        if (confirmed) {
          this.unpublishRecord(rec);
        }
      });
  }

  private publishRecord(rec: PayrollSystemDefault): void {
    this.api
      .publish(rec.year)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadRecords();
          this.toastService.success(`Parámetros ${rec.year} publicados exitosamente`);
        },
        error: (err) => {
          console.error('Error publishing payroll default:', err);
          this.toastService.error(
            err.error?.message || 'Error al publicar los parámetros',
          );
        }});
  }

  private unpublishRecord(rec: PayrollSystemDefault): void {
    this.api
      .unpublish(rec.year)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadRecords();
          this.toastService.success(`Parámetros ${rec.year} despublicados`);
        },
        error: (err) => {
          console.error('Error unpublishing payroll default:', err);
          this.toastService.error(
            err.error?.message || 'Error al despublicar los parámetros',
          );
        }});
  }
}
