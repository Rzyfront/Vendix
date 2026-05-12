import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  ToastService,
} from '../../../../shared/components/index';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import {
  SettingsSyncResult,
  SuperAdminSettingsSyncService,
} from './services/settings-sync.service';

@Component({
  selector: 'app-super-admin-settings-sync',
  standalone: true,
  imports: [ButtonComponent, CardComponent, IconComponent],
  template: `
    <div class="space-y-6">
      <!-- Header card -->
      <app-card>
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div class="flex items-start gap-3 min-w-0">
            <div
              class="flex-shrink-0 w-10 h-10 rounded-card bg-[var(--color-primary-50)] flex items-center justify-center"
            >
              <app-icon
                name="refresh-cw"
                [size]="20"
                class="text-[var(--color-primary)]"
              />
            </div>
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
                Sincronización de Settings
              </h2>
              <p class="text-sm text-[var(--color-text-secondary)] mt-1">
                Sincroniza esquemas de settings deprecados en todas las tiendas.
                Útil cuando cambias el formato del JSON o agregas migraciones nuevas.
              </p>
            </div>
          </div>

          <div class="flex-shrink-0">
            <app-button
              variant="primary"
              size="md"
              [disabled]="loading()"
              (clicked)="onSyncClick()"
            >
              <app-icon
                [name]="loading() ? 'loader-2' : 'refresh-cw'"
                [size]="16"
                [spin]="loading()"
                slot="icon"
              />
              <span>
                {{ loading() ? 'Sincronizando...' : 'Sincronizar todas las tiendas' }}
              </span>
            </app-button>
          </div>
        </div>
      </app-card>

      <!-- Error banner -->
      @if (errorMessage()) {
        <app-card>
          <div class="flex items-start gap-3">
            <app-icon
              name="alert-triangle"
              [size]="20"
              class="text-[var(--color-danger)] flex-shrink-0 mt-0.5"
            />
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-[var(--color-danger)]">
                No se pudo completar la sincronización
              </h3>
              <p class="text-sm text-[var(--color-text-secondary)] mt-1 break-words">
                {{ errorMessage() }}
              </p>
            </div>
          </div>
        </app-card>
      }

      <!-- Result -->
      @if (result(); as r) {
        <app-card>
          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <app-icon
                name="check-circle"
                [size]="20"
                class="text-[var(--color-success)]"
              />
              <h3 class="text-base font-semibold text-[var(--color-text-primary)]">
                Sincronización completada
              </h3>
            </div>

            <!-- Stats grid -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div
                class="rounded-card border border-[var(--color-border)] p-4 bg-[var(--color-surface)]"
              >
                <p class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Tiendas escaneadas
                </p>
                <p class="text-2xl font-semibold text-[var(--color-text-primary)] mt-1">
                  {{ r.totalScanned }}
                </p>
              </div>
              <div
                class="rounded-card border border-[var(--color-border)] p-4 bg-[var(--color-surface)]"
              >
                <p class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Tiendas migradas
                </p>
                <p class="text-2xl font-semibold text-[var(--color-success)] mt-1">
                  {{ r.totalMigrated }}
                </p>
              </div>
              <div
                class="rounded-card border border-[var(--color-border)] p-4 bg-[var(--color-surface)]"
              >
                <p class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Errores
                </p>
                <p
                  class="text-2xl font-semibold mt-1"
                  [class.text-danger]="hasErrors()"
                  [style.color]="
                    hasErrors() ? 'var(--color-danger)' : 'var(--color-text-primary)'
                  "
                >
                  {{ r.errors.length }}
                </p>
              </div>
            </div>

            <!-- Error list -->
            @if (hasErrors()) {
              <div class="border-t border-[var(--color-border)] pt-4">
                <button
                  type="button"
                  class="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-primary)] transition-colors"
                  (click)="toggleErrors()"
                >
                  <app-icon
                    [name]="errorsExpanded() ? 'chevron-down' : 'chevron-right'"
                    [size]="16"
                  />
                  <span>
                    {{ errorsExpanded() ? 'Ocultar errores' : 'Ver errores' }}
                    ({{ r.errors.length }})
                  </span>
                </button>

                @if (errorsExpanded()) {
                  <ul
                    class="mt-3 space-y-2 max-h-96 overflow-y-auto"
                  >
                    @for (err of r.errors; track err.storeId + '-' + $index) {
                      <li
                        class="rounded-card border border-[var(--color-border)] p-3 bg-[var(--color-surface)] text-sm"
                      >
                        <div class="flex items-start gap-2">
                          <app-icon
                            name="alert-triangle"
                            [size]="16"
                            class="text-[var(--color-danger)] flex-shrink-0 mt-0.5"
                          />
                          <div class="min-w-0">
                            <p class="font-medium text-[var(--color-text-primary)]">
                              Tienda #{{ err.storeId }}
                            </p>
                            <p
                              class="text-[var(--color-text-secondary)] mt-1 break-words"
                            >
                              {{ err.message }}
                            </p>
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </div>
        </app-card>
      }
    </div>
  `,
})
export class SuperAdminSettingsSyncComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly settingsSyncService = inject(SuperAdminSettingsSyncService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);

  readonly loading = signal(false);
  readonly result = signal<SettingsSyncResult | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly errorsExpanded = signal(false);

  readonly hasErrors = computed(() => (this.result()?.errors.length ?? 0) > 0);

  onSyncClick(): void {
    if (this.loading()) return;

    this.dialogService
      .confirm({
        title: 'Sincronizar todas las tiendas',
        message:
          '¿Confirmas ejecutar la sincronización de settings sobre TODAS las tiendas? La operación puede tardar varios segundos.',
        confirmText: 'Sincronizar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.runSync();
        }
      });
  }

  toggleErrors(): void {
    this.errorsExpanded.update((v) => !v);
  }

  private runSync(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.errorsExpanded.set(false);

    this.settingsSyncService
      .syncAllStores()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response?.data;
          if (response?.success && data) {
            this.result.set(data);
            const summary = this.buildSummary(data);
            if (data.errors.length > 0) {
              this.toastService.warning(summary, 'Sincronización con errores');
            } else {
              this.toastService.success(summary, 'Sincronización completada');
            }
          } else {
            this.errorMessage.set(
              response?.message || 'Respuesta inesperada del servidor',
            );
          }
          this.loading.set(false);
        },
        error: (error) => {
          const parsed = parseApiError(error);
          this.errorMessage.set(parsed.userMessage);
          this.toastService.error(parsed.userMessage, 'Error');
          this.loading.set(false);
          // eslint-disable-next-line no-console
          console.error('[SettingsSync] sync failed:', parsed.devMessage, error);
        },
      });
  }

  private buildSummary(r: SettingsSyncResult): string {
    return `Escaneadas: ${r.totalScanned} • Migradas: ${r.totalMigrated} • Errores: ${r.errors.length}`;
  }
}
