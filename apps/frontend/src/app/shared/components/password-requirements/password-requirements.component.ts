import {
  Component,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { AbstractControl } from '@angular/forms';

import {
  PASSWORD_CHECKLIST_RULES,
  PasswordRule,
  evaluatePassword,
} from '../../../core/utils/password-policy';
import { IconComponent } from '../icon/icon.component';

interface ChecklistItem {
  readonly rule: PasswordRule;
  readonly satisfied: boolean;
}

/**
 * Checklist en vivo de la política de contraseñas (`core/utils/password-policy`).
 *
 * Existe porque un formulario que solo dice "formato inválido" obliga al usuario
 * a adivinar el requisito incumplido. Aquí cada regla se marca en verde en
 * cuanto se cumple, mientras se escribe.
 *
 * Dos formas de alimentarlo:
 *   <app-password-requirements [control]="form.get('password')" />
 *   <app-password-requirements [password]="passwordSignal()" />
 *
 * Preferir `[control]`: evita replicar en cada modal el puente
 * FormControl → signal, que es exactamente el boilerplate que este componente
 * encapsula.
 */
@Component({
  selector: 'app-password-requirements',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (isVisible()) {
      <div
        class="password-requirements rounded-lg p-3"
        role="group"
        aria-label="Requisitos de la contraseña"
      >
        <p class="password-requirements__title text-xs font-medium">
          {{ title() }}
        </p>

        <ul class="mt-2 space-y-1">
          @for (item of items(); track item.rule.id) {
            <li
              class="flex items-center gap-1.5 text-xs"
              [style.color]="
                item.satisfied
                  ? 'var(--color-success)'
                  : 'var(--color-text-secondary)'
              "
            >
              <app-icon
                [name]="item.satisfied ? 'check-circle' : 'circle'"
                [size]="14"
                class="flex-shrink-0"
              ></app-icon>
              <span>{{ item.rule.label }}</span>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /*
       * Con el campo vacío el @if deja solo un comentario ancla, y :empty lo
       * ignora: el host colapsa por completo en vez de aportar una fila vacía
       * al grid del formulario y su gap.
       */
      :host(:empty) {
        display: none;
      }

      .password-requirements {
        border: 1px solid var(--color-border);
        background: color-mix(
          in srgb,
          var(--color-text-secondary) 6%,
          transparent
        );
      }

      .password-requirements__title {
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class PasswordRequirementsComponent {
  /** Control reactivo de la contraseña. Tiene prioridad sobre `password`. */
  readonly control = input<AbstractControl | null>(null);

  /** Valor plano, para formularios que no usan Reactive Forms. */
  readonly password = input<string>('');

  readonly title = input<string>('Requisitos de la contraseña:');

  /**
   * `true` mantiene el checklist visible aunque el campo esté vacío. Por
   * defecto se oculta: listar requisitos antes de que el usuario escriba nada
   * es ruido, y en un formulario de edición el campo vacío significa "no
   * cambiar la contraseña".
   */
  readonly alwaysVisible = input<boolean>(false);

  /**
   * Puente FormControl → signal. Un `computed` que leyera `control().value`
   * NO sería reactivo: el valor de un FormControl no es una señal, así que el
   * grafo nunca se invalidaría al teclear. Hace falta suscribirse.
   */
  private readonly controlValue = signal('');

  constructor() {
    effect((onCleanup) => {
      const control = this.control();

      if (!control) {
        return;
      }

      this.controlValue.set(control.value ?? '');

      const subscription = control.valueChanges.subscribe((value) =>
        this.controlValue.set(value ?? ''),
      );

      onCleanup(() => subscription.unsubscribe());
    });
  }

  private readonly value = computed(() =>
    this.control() ? this.controlValue() : this.password(),
  );

  /** Solo se muestra una vez que hay algo escrito. */
  readonly isVisible = computed(
    () => this.alwaysVisible() || this.value().length > 0,
  );

  readonly items = computed<ChecklistItem[]>(() => {
    const states = evaluatePassword(this.value());

    return PASSWORD_CHECKLIST_RULES.map((rule) => ({
      rule,
      satisfied: states.find((state) => state.rule.id === rule.id)!.satisfied,
    }));
  });
}
