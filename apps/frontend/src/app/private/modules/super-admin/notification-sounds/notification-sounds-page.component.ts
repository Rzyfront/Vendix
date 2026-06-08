import {
  Component,
  OnInit,
  DestroyRef,
  inject,
  signal,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import {
  CardComponent,
  ButtonComponent,
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  EmptyStateComponent,
  PaginationComponent,
  DialogService,
  ToastService,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../shared/components/index';

import { NotificationSoundsAdminService } from './services/notification-sounds-admin.service';
import {
  NotificationSoundAdmin,
  CreateNotificationSoundPayload,
  UpdateNotificationSoundPayload,
} from './interfaces/notification-sound.interface';
import { CreateNotificationSoundModalComponent } from './components/create-notification-sound-modal/create-notification-sound-modal.component';
import { EditNotificationSoundModalComponent } from './components/edit-notification-sound-modal/edit-notification-sound-modal.component';

@Component({
  selector: 'app-notification-sounds-page',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    PaginationComponent,
    CreateNotificationSoundModalComponent,
    EditNotificationSoundModalComponent,
  ],
  templateUrl: './notification-sounds-page.component.html',
})
export class NotificationSoundsPageComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(NotificationSoundsAdminService);
  private readonly dialogService = inject(DialogService);
  private readonly toast = inject(ToastService);

  readonly sounds = signal<NotificationSoundAdmin[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly searchTerm = signal<string>('');
  readonly filters = signal({ page: 1, limit: 25 });
  readonly totalItems = signal(0);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.filters().limit)),
  );

  readonly showCreateModal = signal<boolean>(false);
  readonly isCreating = signal<boolean>(false);

  readonly showEditModal = signal<boolean>(false);
  readonly isUpdating = signal<boolean>(false);
  readonly selectedSound = signal<NotificationSoundAdmin | null>(null);

  readonly filteredSounds = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const data = this.sounds();
    if (!term) return data;
    return data.filter((s) => s.name.toLowerCase().includes(term));
  });

  readonly stats = computed(() => {
    const data = this.sounds();
    return {
      total: data.length,
      active: data.filter((s) => s.is_active).length,
      inactive: data.filter((s) => !s.is_active).length,
    };
  });

  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'sort_order',
      label: 'Orden',
      sortable: true,
      align: 'center',
      priority: 2,
    },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      badge: true,
      priority: 1,
      align: 'center',
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    },
    {
      key: 'file_size_bytes',
      label: 'Tamaño',
      sortable: true,
      priority: 3,
      transform: (value: number) => this.formatSize(value),
    },
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'sort_order', label: 'Orden' },
      {
        key: 'file_size_bytes',
        label: 'Tamaño',
        transform: (value: number) => this.formatSize(value),
      },
      {
        key: 'created_at',
        label: 'Creado',
        transform: (value: string) => this.formatDate(value),
      },
    ],
  };

  readonly tableActions: TableAction[] = [
    {
      label: 'Previsualizar',
      icon: 'play',
      action: (sound: NotificationSoundAdmin) => this.previewSound(sound),
      variant: 'info',
    },
    {
      label: 'Activar/Desactivar',
      icon: 'refresh',
      action: (sound: NotificationSoundAdmin) => this.toggleActive(sound),
      variant: 'warning',
    },
    {
      label: 'Editar',
      icon: 'edit',
      action: (sound: NotificationSoundAdmin) => this.editSound(sound),
      variant: 'info',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (sound: NotificationSoundAdmin) => this.confirmDelete(sound),
      variant: 'danger',
    },
  ];

  ngOnInit(): void {
    this.loadSounds();
  }

  loadSounds(): void {
    this.isLoading.set(true);
    this.service
      .list({
        page: this.filters().page,
        limit: this.filters().limit,
        search: this.searchTerm() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.sounds.set(res.data ?? []);
          this.totalItems.set(res.meta?.total ?? (res.data?.length ?? 0));
          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Error loading notification sounds:', err);
          this.toast.error('Error al cargar los sonidos de notificación');
          this.isLoading.set(false);
        },
      });
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term ?? '');
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadSounds();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadSounds();
  }

  // ---- Preview ----
  previewSound(sound: NotificationSoundAdmin): void {
    if (!sound.url) {
      this.toast.warning('Este sonido no tiene URL disponible para preview');
      return;
    }
    try {
      const audio = new Audio(sound.url);
      audio.volume = 0.7;
      audio.play().catch((err) => {
        console.warn('Preview play failed:', err);
      });
      setTimeout(() => {
        try {
          audio.pause();
        } catch {
          // ignore
        }
      }, 1500);
    } catch (err) {
      console.warn('Preview audio error:', err);
    }
  }

  // ---- Create ----
  openCreateModal(): void {
    this.showCreateModal.set(true);
  }

  createSound(payload: CreateNotificationSoundPayload): void {
    this.isCreating.set(true);
    this.service
      .create(payload.name, payload.sort_order, payload.file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Sonido creado exitosamente');
          this.showCreateModal.set(false);
          this.isCreating.set(false);
          this.loadSounds();
        },
        error: (err) => {
          console.error('Error creating notification sound:', err);
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'Error al crear el sonido';
          this.toast.error(message);
          this.isCreating.set(false);
        },
      });
  }

  // ---- Edit ----
  editSound(sound: NotificationSoundAdmin): void {
    this.selectedSound.set(sound);
    this.showEditModal.set(true);
  }

  updateSound(payload: UpdateNotificationSoundPayload): void {
    const current = this.selectedSound();
    if (!current) return;
    this.isUpdating.set(true);
    this.service
      .update(current.id, payload.name ?? current.name, payload.sort_order)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Sonido actualizado exitosamente');
          this.showEditModal.set(false);
          this.selectedSound.set(null);
          this.isUpdating.set(false);
          this.loadSounds();
        },
        error: (err) => {
          console.error('Error updating notification sound:', err);
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'Error al actualizar el sonido';
          this.toast.error(message);
          this.isUpdating.set(false);
        },
      });
  }

  // ---- Toggle Active (optimistic) ----
  toggleActive(sound: NotificationSoundAdmin): void {
    const previous = this.sounds();
    const optimistic = previous.map((s) =>
      s.id === sound.id ? { ...s, is_active: !s.is_active } : s,
    );
    this.sounds.set(optimistic);

    this.service
      .toggleActive(sound.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          const merged = this.sounds().map((s) =>
            s.id === updated.id ? { ...s, ...updated } : s,
          );
          this.sounds.set(merged);
          this.toast.success(
            updated.is_active ? 'Sonido activado' : 'Sonido desactivado',
          );
        },
        error: (err) => {
          console.error('Error toggling notification sound:', err);
          // Rollback
          this.sounds.set(previous);
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'Error al cambiar el estado del sonido';
          this.toast.error(message);
        },
      });
  }

  // ---- Delete ----
  confirmDelete(sound: NotificationSoundAdmin): void {
    this.dialogService
      .confirm({
        title: 'Eliminar sonido',
        message: `¿Estás seguro de eliminar "${sound.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteSound(sound);
        }
      });
  }

  deleteSound(sound: NotificationSoundAdmin): void {
    this.service
      .remove(sound.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Sonido eliminado exitosamente');
          this.loadSounds();
        },
        error: (err) => {
          console.error('Error deleting notification sound:', err);
          if (err?.status === 409) {
            const detail =
              err?.error?.detail ||
              err?.error?.message ||
              'Sonido referenciado por una o más tiendas. Desactívalo en lugar de eliminarlo.';
            this.toast.error(detail);
          } else {
            const message =
              err?.error?.message ||
              err?.error?.detail ||
              'Error al eliminar el sonido';
            this.toast.error(message);
          }
        },
      });
  }

  // ---- Formatters ----
  formatSize(bytes: number): string {
    if (!bytes || bytes <= 0) return '—';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  }

  formatDate(value: string): string {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return value;
    }
  }
}
