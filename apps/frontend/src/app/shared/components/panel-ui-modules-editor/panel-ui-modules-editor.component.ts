import {
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';

import { APP_MODULES, AppModule } from '../../constants/app-modules.constant';
import { InputsearchComponent } from '../inputsearch/inputsearch.component';
import { SettingToggleComponent } from '../setting-toggle/setting-toggle.component';

/**
 * Presentational, storage-agnostic editor for the `panel_ui` module tree
 * of a single `app_type`. The component owns the render, the gating, the
 * parent/child cascade and the search; the consumer owns the persistence
 * (FormGroup, signal Record, JSON, etc.) and the save semantics (only
 * `false`, diff, full map).
 *
 * Contract:
 * - Input `value` is the resolved `Record<string, boolean>` for the active
 *   `app_type`. Absent keys are treated as `true` (allowed).
 * - Inputs `hiddenByIndustry` and `hiddenByStore` declare which keys are
 *   gated. The consumer passes the SAME arrays to its save diff so the
 *   persisted value is preserved untouched when the ceiling later lifts.
 * - Input `newKeys` is the list of keys that should render the "Nuevo" badge
 *   (per-user discovery, computed by the backend read path).
 * - Output `valueChange` emits the full `Record<string, boolean>` for the
 *   active `app_type` — gated keys are OMITTED so the consumer can merge
 *   the result straight into its store without re-applying the ceiling.
 */
@Component({
  selector: 'app-panel-ui-modules-editor',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    InputsearchComponent,
    SettingToggleComponent,
  ],
  templateUrl: './panel-ui-modules-editor.component.html',
  styleUrls: ['./panel-ui-modules-editor.component.scss'],
})
export class PanelUiModulesEditorComponent {
  readonly appType = input.required<string>();
  readonly value = input.required<Record<string, boolean>>();
  readonly hiddenByIndustry = input<string[]>([]);
  readonly hiddenByStore = input<string[]>([]);
  readonly newKeys = input<string[]>([]);
  readonly searchable = input(true);
  readonly parentSync = input(true);
  readonly readOnly = input(false);

  readonly valueChange = output<Record<string, boolean>>();

  /** Internal flat FormGroup — one FormControl per module key. Required by
   *  the `setting-toggle` CVA, which only accepts value via `formControl`/
   *  `formControlName`. The FormGroup is purely an implementation detail
   *  of the CVA binding; the public surface is `value` / `valueChange`. */
  private readonly _form = signal<FormGroup>(new FormGroup({}));
  readonly form = this._form.asReadonly();

  private lastAppType: string | null = null;

  readonly modulesWithChildren = computed<AppModule[]>(() => {
    const all = this.modulesForAppType();
    return all.filter((m) => !!m.isParent && (m.children?.length ?? 0) > 0);
  });

  readonly standaloneModules = computed<AppModule[]>(() => {
    const all = this.modulesForAppType();
    return all.filter((m) => !m.isParent || (m.children?.length ?? 0) === 0);
  });

  private readonly allKeys = computed<string[]>(() => {
    const all = this.modulesForAppType();
    return all.reduce<string[]>((acc, m) => {
      acc.push(m.key);
      for (const c of m.children || []) acc.push(c.key);
      return acc;
    }, []);
  });

  private readonly modulesForAppType = computed<AppModule[]>(
    () =>
      (APP_MODULES as Record<string, AppModule[]>)[this.appType()] || [],
  );

  readonly searchTerm = signal('');

  readonly filteredModulesWithChildren = computed<AppModule[]>(() => {
    const modules = this.modulesWithChildren();
    const term = this.searchTerm().toLowerCase().trim();
    if (!term) return modules;
    return modules
      .map((module) => {
        const parentMatches =
          module.label.toLowerCase().includes(term) ||
          (module.description &&
            module.description.toLowerCase().includes(term));
        const matchingChildren = (module.children || []).filter(
          (child) =>
            child.label.toLowerCase().includes(term) ||
            (child.description &&
              child.description.toLowerCase().includes(term)),
        );
        if (parentMatches) return module;
        if (matchingChildren.length > 0) {
          return { ...module, children: matchingChildren };
        }
        return null;
      })
      .filter((m): m is AppModule => !!m);
  });

  readonly filteredStandaloneModules = computed<AppModule[]>(() => {
    const modules = this.standaloneModules();
    const term = this.searchTerm().toLowerCase().trim();
    if (!term) return modules;
    return modules.filter(
      (m) =>
        m.label.toLowerCase().includes(term) ||
        (m.description && m.description.toLowerCase().includes(term)),
    );
  });

  constructor() {
    // Rebuild FormGroup when `appType` changes (or initialize on first run).
    effect(() => {
      const at = this.appType();
      if (at !== this.lastAppType) {
        this.lastAppType = at;
        this._form.set(this.buildForm(at));
      }
      this.applyValueAndGating();
    });

    // Re-apply the value + disabled state when value/inputs change.
    effect(() => {
      this.value();
      this.hiddenByIndustry();
      this.hiddenByStore();
      this.readOnly();
      this.applyValueAndGating();
    });
  }

  control(key: string): FormControl<boolean> {
    return this._form().get(key) as FormControl<boolean>;
  }

  isGated(key: string): boolean {
    return (
      this.hiddenByIndustry().includes(key) ||
      this.hiddenByStore().includes(key)
    );
  }

  isNewKey(key: string): boolean {
    return this.newKeys().includes(key);
  }

  /** Ordered reason labels: `Industria` (industry ceiling) first, then
   *  `Tienda` (store panel UI). Empty list when not gated. */
  getReasons(key: string): string[] {
    const reasons: string[] = [];
    if (this.hiddenByIndustry().includes(key)) reasons.push('Industria');
    if (this.hiddenByStore().includes(key)) reasons.push('Tienda');
    return reasons;
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  onToggle(key: string): void {
    if (this.readOnly() || this.isGated(key)) return;
    this.emitValue();
  }

  /** Cascade the parent value onto its children. Children gated by
   *  industry / store panel UI are left untouched (their stored value
   *  is preserved so the user's previous preference resurfaces if the
   *  ceiling later lifts). */
  onParentToggle(isEnabled: boolean, parent: AppModule): void {
    if (this.readOnly() || !this.parentSync() || !parent.children) return;
    for (const child of parent.children) {
      if (this.isGated(child.key)) continue;
      const ctrl = this._form().get(child.key);
      if (!ctrl) continue;
      ctrl.setValue(isEnabled, { emitEvent: false });
      if (isEnabled) {
        ctrl.enable({ emitEvent: false });
      } else {
        ctrl.disable({ emitEvent: false });
      }
    }
    this.emitValue();
  }

  private buildForm(appType: string): FormGroup {
    const all = (APP_MODULES as Record<string, AppModule[]>)[appType] || [];
    const keys: string[] = all.reduce<string[]>((acc, m) => {
      acc.push(m.key);
      for (const c of m.children || []) acc.push(c.key);
      return acc;
    }, []);
    return new FormGroup(
      keys.reduce<Record<string, FormControl<boolean>>>(
        (acc, key) => {
          acc[key] = new FormControl<boolean>(true, { nonNullable: true });
          return acc;
        },
        {},
      ),
    );
  }

  private applyValueAndGating(): void {
    const form = this._form();
    if (Object.keys(form.controls).length === 0) return;
    const incoming = this.value() ?? {};
    const hiddenI = this.hiddenByIndustry();
    const hiddenS = this.hiddenByStore();
    const keys = this.allKeys();
    const patch: Record<string, boolean> = {};
    for (const key of keys) {
      if (hiddenI.includes(key) || hiddenS.includes(key)) {
        patch[key] = false;
      } else {
        patch[key] = incoming[key] !== false;
      }
    }
    form.patchValue(patch, { emitEvent: false });
    this.syncDisabledStates();
  }

  private syncDisabledStates(): void {
    const form = this._form();
    if (Object.keys(form.controls).length === 0) return;
    const readOnly = this.readOnly();
    const hiddenI = this.hiddenByIndustry();
    const hiddenS = this.hiddenByStore();
    const keys = this.allKeys();

    for (const key of keys) {
      const ctrl = form.get(key);
      if (!ctrl) continue;
      if (hiddenI.includes(key) || hiddenS.includes(key)) {
        ctrl.disable({ emitEvent: false });
        ctrl.setValue(false, { emitEvent: false });
      } else if (readOnly) {
        // Read-only: preservar el valor almacenado pero renderizar el toggle
        // deshabilitado (opacity-50 + not-allowed) para que se vea el bloqueo.
        ctrl.disable({ emitEvent: false });
      } else {
        ctrl.enable({ emitEvent: false });
      }
    }

    // El cascade padre/hijo solo aplica cuando se puede editar; en read-only
    // ya quedó todo deshabilitado en el bucle anterior.
    if (!readOnly && this.parentSync()) {
      for (const parent of this.modulesWithChildren()) {
        const parentOff = form.get(parent.key)?.value === false;
        for (const child of parent.children || []) {
          if (hiddenI.includes(child.key) || hiddenS.includes(child.key)) {
            continue;
          }
          const childCtrl = form.get(child.key);
          if (!childCtrl) continue;
          if (parentOff) {
            childCtrl.disable({ emitEvent: false });
          } else {
            childCtrl.enable({ emitEvent: false });
          }
        }
      }
    }
  }

  private emitValue(): void {
    if (this.readOnly()) return;
    const form = this._form();
    if (Object.keys(form.controls).length === 0) return;
    const result: Record<string, boolean> = {};
    for (const key of this.allKeys()) {
      if (this.isGated(key)) continue; // gated = consumer's responsibility
      const ctrl = form.get(key);
      if (!ctrl) continue;
      result[key] = ctrl.value === true;
    }
    this.valueChange.emit(result);
  }
}
