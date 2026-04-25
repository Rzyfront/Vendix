import { Component, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SpinnerComponent,
  AlertBannerComponent,
  TableComponent,
  TableColumn,
  TableAction,
  StatsComponent,
  ModalComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  ConfirmationModalComponent,
  StickyHeaderComponent,
} from '../../../../../shared/components';
import { PaymentMethodsService, StorePaymentMethod, SystemPaymentMethod, PaymentMethodStats } from './services/payment-methods.service';

@Component({
  selector: 'app-payment-methods',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    CardComponent,
    IconComponent,
    SpinnerComponent,
    AlertBannerComponent,
    TableComponent,
    StatsComponent,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    ConfirmationModalComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Métodos de pago"
        subtitle="Gestiona los métodos de pago de tu tienda"
        icon="credit-card"
        [showBackButton]="true"
        backRoute="/organization/config"
      ></app-sticky-header>

      <!-- Stats Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <app-stats [title]="'Métodos activos'" [value]="stats()?.enabled_methods?.toString() || '0'" iconName="check-circle" iconBgColor="bg-green-100" iconColor="text-green-600"></app-stats>
        <app-stats [title]="'Total transacciones'" [value]="stats()?.total_transactions?.toString() || '0'" iconName="repeat"></app-stats>
        <app-stats [title]="'Exitosas'" [value]="stats()?.successful_transactions?.toString() || '0'" iconName="check" iconBgColor="bg-green-100" iconColor="text-green-600"></app-stats>
        <app-stats [title]="'Fallidas'" [value]="stats()?.failed_transactions?.toString() || '0'" iconName="x-circle" iconBgColor="bg-red-100" iconColor="text-red-600"></app-stats>
      </div>

      <div class="mt-6">
        @if (loading()) {
          <div class="flex justify-center py-12">
            <app-spinner size="lg" text="Cargando métodos de pago..."></app-spinner>
          </div>
        } @else if (error()) {
          <app-alert-banner variant="danger" icon="alert-circle">
            {{ error() }}
            <button class="ml-3 underline font-semibold" (click)="dismissError()">Cerrar</button>
          </app-alert-banner>
        } @else {
          <app-card [responsivePadding]="true">
            <div class="flex items-center justify-between mb-6">
              <h3 class="text-lg font-semibold">Métodos de pago activos</h3>
              <app-button variant="primary" size="sm" icon="plus" (clicked)="openEnableModal()">
                Agregar método
              </app-button>
            </div>

            @if (methods().length === 0) {
              <div class="text-center py-8 text-gray-500">
                <app-icon name="credit-card" size="48" class="mx-auto mb-3 opacity-50"></app-icon>
                <p>No hay métodos de pago activos</p>
                <p class="text-sm mt-1">Agrega un método para comenzar a recibir pagos</p>
              </div>
            } @else {
              <app-table [data]="methods()" [columns]="columns" [actions]="actions" [sortable]="true" [striped]="true"></app-table>
            }
          </app-card>
        }
      </div>
    </div>

    <!-- Enable Method Modal -->
    <app-modal [(isOpen)]="showEnableModal" title="Agregar método de pago" size="lg">
      @if (availableMethods().length === 0) {
        <div class="text-center py-6 text-gray-500">
          <p>No hay métodos de pago disponibles para agregar</p>
        </div>
      } @else {
        <div class="space-y-4">
          <app-selector label="Seleccionar método" [options]="availableMethodOptions()" [(ngModel)]="selectedSystemMethodId" [ngModelOptions]="{ standalone: true }" placeholder="Elige un método de pago"></app-selector>
          @if (selectedSystemMethodId()) {
            <app-input label="Nombre para mostrar" [(ngModel)]="newMethodDisplayName" [ngModelOptions]="{ standalone: true }" placeholder="Nombre personalizado (opcional)"></app-input>
          }
        </div>
      }
      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" (clicked)="closeEnableModal()">Cancelar</app-button>
        <app-button variant="primary" [loading]="saving()" [disabled]="!selectedSystemMethodId()" (clicked)="onEnableMethod()">Habilitar</app-button>
      </div>
    </app-modal>

    <!-- Edit Method Modal -->
    <app-modal [(isOpen)]="showEditModal" [title]="'Editar: ' + (editingMethod()?.display_name || '')" size="lg">
      @if (editingMethod()) {
        <div class="space-y-4">
          <app-input label="Nombre para mostrar" [(ngModel)]="editForm.display_name" [ngModelOptions]="{ standalone: true }"></app-input>
          <div class="grid grid-cols-2 gap-4">
            <app-input label="Monto mínimo" type="number" [(ngModel)]="editForm.min_amount" [ngModelOptions]="{ standalone: true }" placeholder="0"></app-input>
            <app-input label="Monto máximo" type="number" [(ngModel)]="editForm.max_amount" [ngModelOptions]="{ standalone: true }" placeholder="Sin límite"></app-input>
          </div>
        </div>
      }
      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" (clicked)="closeEditModal()">Cancelar</app-button>
        <app-button variant="primary" [loading]="saving()" (clicked)="onUpdateMethod()">Guardar cambios</app-button>
      </div>
    </app-modal>

    <!-- Delete Confirmation -->
    <app-confirmation-modal [isOpen]="showDeleteModal()" [title]="'Eliminar ' + (deletingMethod()?.display_name || 'método')" message="¿Estás seguro de que deseas eliminar este método de pago? Esta acción no se puede deshacer." confirmText="Eliminar" cancelText="Cancelar" confirmVariant="danger" (confirm)="onConfirmDelete()" (cancel)="closeDeleteModal()"></app-confirmation-modal>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class PaymentMethodsComponent {
  private paymentService = inject(PaymentMethodsService);

  readonly loading = this.paymentService.loading;
  readonly saving = this.paymentService.saving;
  readonly error = this.paymentService.error;

  readonly methods = signal<StorePaymentMethod[]>([]);
  readonly availableMethods = signal<SystemPaymentMethod[]>([]);
  readonly stats = signal<PaymentMethodStats | null>(null);

  readonly showEnableModal = signal(false);
  readonly showEditModal = signal(false);
  readonly showDeleteModal = signal(false);

  readonly selectedSystemMethodId = signal<number | null>(null);
  readonly newMethodDisplayName = signal('');
  readonly editingMethod = signal<StorePaymentMethod | null>(null);
  readonly deletingMethod = signal<StorePaymentMethod | null>(null);

  editForm = {
    display_name: '',
    min_amount: null as number | null,
    max_amount: null as number | null,
  };

  readonly columns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Método',
      sortable: true,
      template: `<div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <app-icon name="credit-card" size="20" class="text-primary"></app-icon>
          </div>
          <div>
            <div class="font-medium">\${row.display_name}</div>
            <div class="text-xs text-gray-500">\${row.system_payment_method?.display_name || ''}</div>
          </div>
        </div>` as any,
    },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'status',
      },
    },
    {
      key: 'min_amount',
      label: 'Min',
      transform: (v) => v ? `$${Number(v).toLocaleString()}` : '-',
    },
    {
      key: 'max_amount',
      label: 'Max',
      transform: (v) => v ? `$${Number(v).toLocaleString()}` : '-',
    },
    {
      key: 'display_order',
      label: 'Orden',
      sortable: true,
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'secondary',
      action: (item) => this.openEditModal(item),
    },
    {
      label: (item) => item.state === 'enabled' ? 'Deshabilitar' : 'Habilitar',
      icon: (item) => item.state === 'enabled' ? 'toggle-left' : 'toggle-right',
      variant: (item) => item.state === 'enabled' ? 'warning' : 'success',
      action: (item) => this.toggleMethod(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item) => this.openDeleteModal(item),
    },
  ];

  readonly availableMethodOptions = computed<SelectorOption[]>(() =>
    this.availableMethods().map((m) => ({
      value: m.id,
      label: `${m.display_name} (${m.provider})`,
    })),
  );

  constructor() {
    this.paymentService.getEnabled().pipe(takeUntilDestroyed()).subscribe((methods) => {
      this.methods.set(methods);
    });

    this.paymentService.getAvailable().pipe(takeUntilDestroyed()).subscribe((available) => {
      this.availableMethods.set(available);
    });

    this.paymentService.getStats().pipe(takeUntilDestroyed()).subscribe((stats) => {
      this.stats.set(stats);
    });
  }

  openEnableModal(): void {
    this.selectedSystemMethodId.set(null);
    this.newMethodDisplayName.set('');
    this.showEnableModal.set(true);
  }

  closeEnableModal(): void {
    this.showEnableModal.set(false);
  }

  onEnableMethod(): void {
    const systemMethodId = this.selectedSystemMethodId();
    if (!systemMethodId) return;

    this.paymentService.enable(systemMethodId, undefined, this.newMethodDisplayName() || undefined).subscribe({
      next: () => {
        this.closeEnableModal();
        this.loadData();
      },
      error: () => {},
    });
  }

  openEditModal(item: StorePaymentMethod): void {
    this.editingMethod.set(item);
    this.editForm.display_name = item.display_name;
    this.editForm.min_amount = item.min_amount ?? null;
    this.editForm.max_amount = item.max_amount ?? null;
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
    this.editingMethod.set(null);
  }

  onUpdateMethod(): void {
    const method = this.editingMethod();
    if (!method) return;

    this.paymentService.update(method.id, {
      display_name: this.editForm.display_name,
      min_amount: this.editForm.min_amount ?? undefined,
      max_amount: this.editForm.max_amount ?? undefined,
    }).subscribe({
      next: () => {
        this.closeEditModal();
        this.loadData();
      },
      error: () => {},
    });
  }

  toggleMethod(item: StorePaymentMethod): void {
    if (item.state === 'enabled') {
      this.paymentService.disable(item.id).subscribe({ next: () => this.loadData(), error: () => {} });
    } else {
      this.paymentService.enableMethod(item.id).subscribe({ next: () => this.loadData(), error: () => {} });
    }
  }

  openDeleteModal(item: StorePaymentMethod): void {
    this.deletingMethod.set(item);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.deletingMethod.set(null);
  }

  onConfirmDelete(): void {
    const method = this.deletingMethod();
    if (!method) return;

    this.paymentService.remove(method.id).subscribe({
      next: () => {
        this.closeDeleteModal();
        this.loadData();
      },
      error: () => {},
    });
  }

  private loadData(): void {
    this.paymentService.getEnabled().pipe(takeUntilDestroyed()).subscribe((methods) => this.methods.set(methods));
    this.paymentService.getStats().pipe(takeUntilDestroyed()).subscribe((stats) => this.stats.set(stats));
  }

  dismissError(): void {
    this.error.set(null);
  }
}