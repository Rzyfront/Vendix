import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { IconComponent } from '../icon/icon.component';

/**
 * CHIP DE UN IMPUESTO: IDENTIDAD, DECISIÓN Y QUITAR EN UNA SOLA ALTURA.
 *
 * Componente compartido para selección de impuesto con conmutador
 * de estado Incluido / Adicional y acción de remoción.
 */
@Component({
  selector: 'vendix-tax-inclusive-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span
      class="inline-flex h-[30px] items-stretch overflow-hidden rounded-xl border border-border bg-[var(--color-surface)] text-xs"
      [class.opacity-50]="disabled()"
    >
      <!-- Identidad: nombre y tarifa. Sólo lectura. -->
      <span
        class="flex items-center gap-1 px-2 border-r border-border"
        [title]="name()"
      >
        <span class="font-medium text-text-primary max-w-[9rem] truncate">
          {{ name() }}
        </span>
        @if (showRate()) {
          <span class="text-[var(--color-text-secondary)]">
            {{ formatRate(rate()) }}%
          </span>
        }
      </span>

      <!--
        Decisión: incluido en el precio o adicional sobre él. Pressed pinta el
        tinte primario; unpressed queda neutro pero con hover, para que se
        lea que se puede pulsar en los dos estados.
      -->
      <button
        type="button"
        class="flex items-center gap-1 px-2 border-r border-border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed"
        [class]="
          inclusive()
            ? 'bg-primary-50 text-primary'
            : 'text-[var(--color-text-secondary)] hover:bg-primary-50 hover:text-primary'
        "
        [attr.aria-pressed]="inclusive()"
        [attr.aria-label]="
          name() +
          (inclusive()
            ? ': impuesto incluido en el precio unitario'
            : ': impuesto adicional sobre el precio unitario')
        "
        [title]="hint()"
        [disabled]="disabled()"
        (click)="inclusiveChange.emit(!inclusive())"
      >
        <app-icon [name]="inclusive() ? 'check' : 'plus'" [size]="12" />
        {{ inclusive() ? 'Incluido' : 'Adicional' }}
      </button>

      <!-- Quitar el impuesto. -->
      <button
        type="button"
        class="flex items-center px-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed"
        [attr.aria-label]="'Quitar ' + name()"
        [title]="'Quitar ' + name()"
        [disabled]="disabled()"
        (click)="remove.emit()"
      >
        <app-icon name="x" [size]="12" />
      </button>
    </span>
  `,
})
export class TaxInclusiveChipComponent {
  /** Nombre visible del impuesto, p. ej. «IVA 19%». */
  readonly name = input.required<string>();
  /** Tarifa en porcentaje (19 para 19 %). `null` la oculta. */
  readonly rate = input<number | null | undefined>(null);
  /** `true` = el precio unitario ya trae el impuesto dentro. */
  readonly inclusive = input(false);
  readonly disabled = input(false);
  /** Ayuda del segmento de decisión. */
  readonly hint = input('');

  /** El valor que el operador acaba de pedir, no una inversión ciega del actual. */
  readonly inclusiveChange = output<boolean>();
  readonly remove = output<void>();

  /**
   * El catálogo de la tienda suele nombrar el impuesto con su tarifa dentro
   * («IVA 19%»); repetirla al lado daba «IVA 19% 19%» y gastaba el ancho del
   * chip en decir lo mismo dos veces. Sólo se pinta cuando el nombre no la
   * trae ya («IVA general» → «IVA general 19%»).
   */
  readonly showRate = computed(() => {
    const rate = this.rate();
    if (rate == null) return false;
    const compactName = this.name().replace(/\s+/g, '');
    return !compactName.includes(`${this.formatRate(rate)}%`);
  });

  formatRate(rate: number | null | undefined): string {
    if (rate == null) return '0';
    return Number.isInteger(rate) ? String(rate) : rate.toFixed(2);
  }
}
