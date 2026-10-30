import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  CardComponent,
  DialogService,
  EmptyStateComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../../../core/utils';
import {
  OptionGroupsService,
  ProductOptionGroup,
  SaveProductOptionGroupDto,
} from '../../services/option-groups.service';
import { OptionGroupFormModalComponent } from './option-group-form-modal.component';

/**
 * Administración de grupos de adiciones (Productos > Adiciones).
 * Eliminar = desactivar el grupo (`DELETE` del API).
 */
@Component({
  selector: 'app-option-groups-page',
  standalone: true,
  imports: [
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    OptionGroupFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Grupos"
          [value]="groups().length"
          smallText="Grupos de adiciones"
          iconName="layers"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="activeCount()"
          smallText="Disponibles en la venta"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Inactivos"
          [value]="groups().length - activeCount()"
          smallText="Ocultos de la venta"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false">
          <div
            class="flex items-center justify-between gap-3 px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border"
          >
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Adiciones ({{ groups().length }})
            </h2>
            <app-button variant="primary" size="sm" (clicked)="openCreate()">
              <app-icon slot="icon" name="plus" [size]="16" />
              Nuevo grupo
            </app-button>
          </div>

          @if (isLoading()) {
            <div class="p-4 md:p-6 text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p class="mt-2 text-text-secondary">Cargando adiciones...</p>
            </div>
          } @else if (groups().length === 0) {
            <app-empty-state
              icon="layers"
              title="Aún no tienes grupos de adiciones"
              description="Crea un grupo (por ejemplo Frutas o Velas) y enlázalo a tus productos."
              actionButtonText="Nuevo grupo"
              [showActionButton]="true"
              [showRefreshButton]="true"
              (actionClick)="openCreate()"
              (refreshClick)="load()"
            ></app-empty-state>
          } @else {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="groups()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                emptyMessage="No hay grupos de adiciones"
                emptyIcon="layers"
                (rowClick)="openEdit($event)"
              ></app-responsive-data-view>
            </div>
          }
        </app-card>
      </div>

      <app-option-group-form-modal
        [isOpen]="isModalOpen()"
        [group]="selected()"
        [isSubmitting]="isSubmitting()"
        (cancel)="closeModal()"
        (save)="onSave($event)"
      ></app-option-group-form-modal>
    </div>
  `,
})
export class OptionGroupsPageComponent implements OnInit {
  private readonly service = inject(OptionGroupsService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly groups = signal<ProductOptionGroup[]>([]);
  readonly isLoading = signal(false);
  readonly isModalOpen = signal(false);
  readonly isSubmitting = signal(false);
  readonly selected = signal<ProductOptionGroup | null>(null);

  readonly activeCount = computed(() => this.groups().filter((g) => g.is_active).length);

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', priority: 1 },
    {
      key: 'scope',
      label: 'Aplica',
      priority: 2,
      transform: (v: string) => (v === 'per_line' ? 'Por línea' : 'Por unidad'),
    },
    {
      key: 'max_select',
      label: 'Selección',
      priority: 3,
      transform: (_v: number, g?: ProductOptionGroup) =>
        g ? `${g.is_required ? 'Obligatorio · ' : ''}${g.min_select}-${g.max_select}` : '',
    },
    {
      key: 'options',
      label: 'Adiciones',
      priority: 2,
      transform: (_v: unknown, g?: ProductOptionGroup) =>
        String((g?.options ?? []).filter((o) => o.is_active !== false).length),
    },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (v: boolean) => (v ? 'Activo' : 'Inactivo'),
      badge: true,
      badgeConfig: { type: 'status' },
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: boolean) => (v ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'scope',
        label: 'Aplica',
        transform: (v: string) => (v === 'per_line' ? 'Por línea' : 'Por unidad'),
      },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'pencil',
      variant: 'info',
      action: (g: ProductOptionGroup) => this.openEdit(g),
    },
    {
      label: 'Desactivar',
      icon: 'toggle-left',
      variant: 'warning',
      show: (g: ProductOptionGroup) => g.is_active,
      action: (g: ProductOptionGroup) => this.deactivate(g),
    },
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.service
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.groups.set(rows);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toast.error(extractApiErrorMessage(error));
          this.isLoading.set(false);
        },
      });
  }

  openCreate(): void {
    this.selected.set(null);
    this.isModalOpen.set(true);
  }

  /** Trae el grupo completo (opciones y enganches) antes de abrir el modal. */
  openEdit(group: ProductOptionGroup): void {
    this.service
      .get(group.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (full) => {
          this.selected.set(full);
          this.isModalOpen.set(true);
        },
        error: (error) => this.toast.error(extractApiErrorMessage(error)),
      });
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.selected.set(null);
  }

  onSave(dto: SaveProductOptionGroupDto): void {
    const current = this.selected();
    this.isSubmitting.set(true);
    const request$ = current
      ? this.service.update(current.id, dto)
      : this.service.create(dto);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.toast.success(current ? 'Grupo actualizado' : 'Grupo creado');
        this.closeModal();
        this.load();
      },
      error: (error) => {
        this.isSubmitting.set(false);
        this.toast.error(extractApiErrorMessage(error));
      },
    });
  }

  async deactivate(group: ProductOptionGroup): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Desactivar grupo',
      message: `El grupo "${group.name}" dejará de ofrecerse en la venta. Podrás reactivarlo editándolo.`,
      confirmText: 'Desactivar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    this.service
      .deactivate(group.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Grupo desactivado');
          this.load();
        },
        error: (error) => this.toast.error(extractApiErrorMessage(error)),
      });
  }
}
