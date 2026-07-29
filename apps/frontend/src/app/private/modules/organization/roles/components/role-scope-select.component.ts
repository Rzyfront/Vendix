import { Component, computed, input, model, output } from '@angular/core';

import { Role } from '../interfaces/role.interface';
import {
  ROLE_SCOPE_LABELS,
  RoleScope,
} from '../../../../../shared/constants/role-scope.constant';

/** Orden de los grupos: primero lo que el nivel organización sí administra. */
const SCOPE_ORDER: readonly RoleScope[] = ['organization', 'store', 'system'];

interface RoleScopeGroup {
  scope: RoleScope;
  label: string;
  roles: Role[];
}

/**
 * QUI-72 — selector de rol AGRUPADO POR ALCANCE.
 *
 * `app-selector` / `app-multi-selector` son listas planas: con roles de
 * organización y de varias tiendas mezclados, dos "Cajero" distintos se ven
 * idénticos. Este selector agrupa por `scope` y anota la tienda dueña, que es
 * justo el dato que desambigua.
 *
 * Se usa en las DOS direcciones (pestaña Usuarios del rol y editor de roles
 * del usuario) para que no diverjan.
 */
@Component({
  selector: 'app-role-scope-select',
  standalone: true,
  template: `
    @if (label()) {
      <label
        class="block text-sm font-medium text-[var(--color-text-primary)] mb-1"
        [attr.for]="selectId"
      >
        {{ label() }}
      </label>
    }

    <select
      [id]="selectId"
      class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md
             bg-[var(--color-surface)] text-[var(--color-text-primary)] text-sm
             focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]
             focus:border-[var(--color-primary)] disabled:opacity-60"
      [disabled]="disabled()"
      [value]="value() === null ? '' : String(value())"
      (change)="onSelect($event)"
    >
      <option value="">{{ placeholder() }}</option>

      @for (group of groups(); track group.scope) {
        <optgroup [label]="group.label">
          @for (role of group.roles; track role.id) {
            <option
              [value]="String(role.id)"
              [disabled]="isOptionDisabled(role)"
            >
              {{ optionLabel(role) }}
            </option>
          }
        </optgroup>
      }
    </select>

    @if (helpText()) {
      <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
        {{ helpText() }}
      </p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class RoleScopeSelectComponent {
  readonly roles = input<Role[]>([]);
  readonly label = input<string>('');
  readonly placeholder = input<string>('Seleccionar rol...');
  readonly helpText = input<string>('');
  readonly disabled = input<boolean>(false);
  /** IDs ya usados (p. ej. roles que el usuario ya tiene en ese alcance). */
  readonly excludedRoleIds = input<number[]>([]);
  /**
   * Deshabilita los roles de sistema. El backend los rechaza con
   * `ROLE_ASSIGN_003` para cualquier actor que no sea superadmin, así que
   * ofrecerlos aquí sólo produce un 403 evitable.
   */
  readonly blockSystemRoles = input<boolean>(true);

  readonly value = model<number | null>(null);
  readonly roleSelected = output<Role | null>();

  readonly selectId = `role-scope-select-${Math.random().toString(36).slice(2, 10)}`;

  /** Expuesto al template: `String` no existe en el contexto de plantilla. */
  readonly String = String;

  readonly groups = computed<RoleScopeGroup[]>(() => {
    const excluded = new Set(this.excludedRoleIds());
    const available = this.roles().filter((role) => !excluded.has(role.id));

    return SCOPE_ORDER.map((scope) => ({
      scope,
      label: ROLE_SCOPE_LABELS[scope],
      roles: available
        .filter((role) => role.scope === scope)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((group) => group.roles.length > 0);
  });

  isOptionDisabled(role: Role): boolean {
    return this.blockSystemRoles() && role.scope === 'system';
  }

  optionLabel(role: Role): string {
    if (role.scope === 'store' && role.store_name) {
      return `${role.name} — ${role.store_name}`;
    }
    return role.name;
  }

  onSelect(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const next = raw === '' ? null : Number(raw);
    this.value.set(next);
    this.roleSelected.emit(
      next === null ? null : (this.roles().find((r) => r.id === next) ?? null),
    );
  }
}
