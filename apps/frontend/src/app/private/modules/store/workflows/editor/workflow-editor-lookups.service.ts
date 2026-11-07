import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StoreRolesService } from '../../settings/roles/services/store-roles.service';
import { WorkflowsApiService } from '../services/workflows-api.service';

export interface LookupOption {
  value: string;
  label: string;
}

/** Store roles and work groups for the Responsable pickers (page scoped). */
@Injectable()
export class WorkflowEditorLookups {
  private readonly roleService = inject(StoreRolesService);
  private readonly api = inject(WorkflowsApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** `value` is the role name: the contract's `role_key` is the role name. */
  readonly roles = signal<LookupOption[]>([]);
  readonly groups = signal<LookupOption[]>([]);
  /** Published flows of the store (`value` is the flow key) for the subflow picker. */
  readonly flows = signal<LookupOption[]>([]);
  readonly loadError = signal<string | null>(null);

  load(): void {
    this.roleService
      .getRoles()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (roles) => {
        const names = [...new Set(roles.map((r) => r.name))];
        this.roles.set(names.map((name) => ({ value: name, label: name })));
      },
      error: () => this.loadError.set('No se pudieron cargar los roles de la tienda.'),
    });
    this.api
      .listWorkGroups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (groups) =>
        this.groups.set(
          groups
            .filter((g) => g.is_active)
            .map((g) => ({ value: g.key, label: g.name })),
        ),
      error: () => this.loadError.set('No se pudieron cargar los grupos de trabajo.'),
    });
    this.api
      .listDefinitions({ limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) =>
          this.flows.set(
            res.data
              .filter((d) => d.status === 'active' && d.published_version !== null)
              .map((d) => ({ value: d.key, label: d.name })),
          ),
        error: () => this.loadError.set('No se pudieron cargar los flujos de la tienda.'),
      });
  }
}
