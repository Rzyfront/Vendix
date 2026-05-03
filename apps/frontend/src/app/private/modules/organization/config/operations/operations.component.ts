import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  CardComponent,
  ConfirmationModalComponent,
  IconComponent,
  SpinnerComponent,
  StickyHeaderComponent,
} from '../../../../../shared/components';
import { OrganizationOperatingScope } from '../../../../../core/models/organization.model';
import {
  OrganizationOperationsConfig,
  OrganizationOperationsService,
} from './services/organization-operations.service';

@Component({
  selector: 'app-organization-operations',
  standalone: true,
  imports: [
    AlertBannerComponent,
    CardComponent,
    ConfirmationModalComponent,
    IconComponent,
    SpinnerComponent,
    StickyHeaderComponent,
  ],
  templateUrl: './operations.component.html',
})
export class OperationsComponent {
  private readonly operationsService = inject(OrganizationOperationsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly config = signal<OrganizationOperationsConfig | null>(null);
  readonly pendingScope = signal<OrganizationOperatingScope | null>(null);
  readonly showConfirmModal = signal(false);

  readonly currentScope = computed(
    () => this.config()?.organization.operating_scope ?? 'STORE',
  );

  readonly isMultiStore = computed(
    () =>
      this.config()?.organization.account_type ===
      'MULTI_STORE_ORG',
  );

  readonly confirmTitle = computed(() => {
    const scope = this.pendingScope();
    return scope === 'ORGANIZATION'
      ? 'Cambiar a organización consolidada'
      : 'Cambiar a operación por tienda';
  });

  readonly confirmMessage = computed(() => {
    const scope = this.pendingScope();
    if (scope === 'ORGANIZATION') {
      return 'Este cambio consolida la operación a nivel organización. Inventario, proveedores, compras, contabilidad, valoración y reportes podrán operar de forma centralizada. ¿Deseas continuar?';
    }

    return 'Cambiar de consolidado a operación por tienda puede separar datos ya consolidados. Por seguridad, el backend bloqueará este cambio si requiere revisión manual.';
  });

  constructor() {
    this.loadConfig();
  }

  loadConfig(): void {
    this.loading.set(true);
    this.error.set(null);

    this.operationsService
      .getConfig()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (config) => {
          this.config.set(config);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Error al cargar la configuración operativa.');
          this.loading.set(false);
        },
      });
  }

  selectScope(scope: OrganizationOperatingScope): void {
    if (this.saving() || scope === this.currentScope()) return;

    if (scope === 'ORGANIZATION' && !this.isMultiStore()) {
      this.error.set(
        'El modo consolidado requiere convertir la cuenta a organización multi-tienda.',
      );
      return;
    }

    this.pendingScope.set(scope);
    this.showConfirmModal.set(true);
  }

  confirmScopeChange(): void {
    const scope = this.pendingScope();
    if (!scope) return;

    this.showConfirmModal.set(false);
    this.saving.set(true);
    this.error.set(null);

    this.operationsService
      .updateOperatingScope(scope)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          const current = this.config();
          if (current) {
            this.config.set({
              ...current,
              organization: {
                ...current.organization,
                operating_scope: result.operating_scope,
              },
            });
          }
          this.saving.set(false);
          this.pendingScope.set(null);
        },
        error: (err) => {
          this.error.set(
            err?.error?.message ||
              err?.error?.error ||
              'No se pudo actualizar el alcance operativo.',
          );
          this.saving.set(false);
          this.pendingScope.set(null);
        },
      });
  }

  cancelScopeChange(): void {
    this.showConfirmModal.set(false);
    this.pendingScope.set(null);
  }

  dismissError(): void {
    this.error.set(null);
  }

  scopeCardClasses(scope: OrganizationOperatingScope): string {
    const selected = this.currentScope() === scope;
    return [
      'w-full rounded-2xl border p-5 text-left transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-primary/40',
      this.saving()
        ? 'cursor-not-allowed opacity-70'
        : 'hover:-translate-y-0.5',
      selected
        ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
        : 'border-[var(--color-border)] bg-white hover:border-primary/50 hover:shadow-md',
    ].join(' ');
  }
}
