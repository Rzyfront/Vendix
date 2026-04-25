import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OrganizationInventorySettings } from '../../../../../core/models/organization.model';
import {
  OrganizationInventorySettingsService,
  InventoryModeConflictError,
} from './services/organization-inventory-settings.service';
import {
  StickyHeaderComponent,
  SpinnerComponent,
  CardComponent,
  ConfirmationModalComponent,
  AlertBannerComponent,
} from '../../../../../shared/components';
import { InventoryModeFormComponent } from './components/inventory-mode-form/inventory-mode-form.component';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    SpinnerComponent,
    CardComponent,
    ConfirmationModalComponent,
    AlertBannerComponent,
    InventoryModeFormComponent,
  ],
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss',
})
export class InventoryComponent {
  private settingsService = inject(OrganizationInventorySettingsService);
  private destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly settings = signal<OrganizationInventorySettings | null>(null);
  readonly error = signal<string | null>(null);
  readonly conflictError = signal<InventoryModeConflictError | null>(null);

  readonly showConfirmModal = signal(false);
  readonly pendingMode = signal<OrganizationInventorySettings['mode'] | null>(null);
  readonly previousMode = signal<OrganizationInventorySettings['mode'] | null>(null);

  readonly confirmModalTitle = computed(() => {
    const mode = this.pendingMode();
    if (mode === 'independent') {
      return 'Cambiar a modo independiente';
    }
    return 'Cambiar a modo organizacional';
  });

  readonly confirmModalMessage = computed(() => {
    const mode = this.pendingMode();
    if (mode === 'independent') {
      return 'Al cambiar a modo independiente, cada tienda gestionará su propio inventario de forma autónoma. Las transferencias pendientes y las ubicaciones compartidas dejarán de estar disponibles. ¿Desea continuar?';
    }
    return 'Al cambiar a modo organizacional, el inventario se gestionará de forma centralizada. Todas las tiendas compartirán el stock. ¿Desea continuar?';
  });

  constructor() {
    this.loadSettings();

    effect(() => {
      const err = this.conflictError();
      if (err) {
        this.error.set(err.message);
      }
    });
  }

  private loadSettings(): void {
    this.loading.set(true);
    this.error.set(null);
    this.settingsService
      .getSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.settings.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Error al cargar la configuración de inventario.');
          this.loading.set(false);
        },
      });
  }

  onSettingsChange(updated: OrganizationInventorySettings): void {
    const current = this.settings();
    if (!current) return;

    if (updated.mode !== current.mode) {
      this.pendingMode.set(updated.mode);
      this.previousMode.set(current.mode);
      this.showConfirmModal.set(true);
      return;
    }

    this.saveSettings(updated);
  }

  onConfirmModeChange(): void {
    const mode = this.pendingMode();
    if (!mode) return;

    this.showConfirmModal.set(false);
    this.saving.set(true);
    this.error.set(null);
    this.conflictError.set(null);

    this.settingsService
      .setMode(mode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const current = this.settings();
          if (current) {
            this.settings.set({ ...current, mode });
          }
          this.saving.set(false);
          this.pendingMode.set(null);
        },
        error: (err: InventoryModeConflictError) => {
          this.saving.set(false);
          this.pendingMode.set(null);
          if (err?.code) {
            this.conflictError.set(err);
          } else {
            this.error.set(
              'Error al cambiar el modo de inventario. Intente de nuevo.',
            );
          }
        },
      });
  }

  onCancelModeChange(): void {
    this.showConfirmModal.set(false);
    this.pendingMode.set(null);
  }

  private saveSettings(updated: OrganizationInventorySettings): void {
    this.saving.set(true);
    this.error.set(null);

    this.settingsService
      .saveFullSettings(updated)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.settings.set(updated);
          this.saving.set(false);
        },
        error: () => {
          this.error.set('Error al guardar la configuración.');
          this.saving.set(false);
        },
      });
  }

  dismissError(): void {
    this.error.set(null);
    this.conflictError.set(null);
  }
}
