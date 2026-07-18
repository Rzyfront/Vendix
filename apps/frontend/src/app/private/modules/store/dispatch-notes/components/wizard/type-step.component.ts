import { Component, computed, inject } from '@angular/core';

import { IconComponent } from '../../../../../../shared/components';
import { WizardStepSectionComponent } from './wizard-step-section.component';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';
import {
  DispatchNoteDirection,
  DispatchNoteSubtype,
  DispatchNoteReason,
  DISPATCH_SUBTYPE_BY_DIRECTION,
  DISPATCH_REASON_BY_SUBTYPE,
} from '../../interfaces/dispatch-note.interface';
import {
  DIRECTION_LABELS,
  DIRECTION_DESCRIPTIONS,
  SUBTYPE_LABELS,
  SUBTYPE_DESCRIPTIONS,
  SUBTYPE_BG_CLASSES,
  REASON_LABELS,
} from '../../constants/dispatch-note.constants';

/**
 * Type step (step 0) — bidirectional remisión wizard cimiento.
 *
 * Selector visual de:
 *   1. direction (outbound | inbound) — dos cards grandes.
 *   2. subtype — filtrado por `DISPATCH_SUBTYPE_BY_DIRECTION[direction]`.
 *   3. reason — filtrado por `DISPATCH_REASON_BY_SUBTYPE[subtype]`, opcional.
 *
 * Lee/escribe signals del `DispatchNoteWizardService` inyectado.
 * Zoneless puro: signal/computed/input/output, sin NgZone/markForCheck.
 */
@Component({
  selector: 'app-dispatch-wizard-type-step',
  standalone: true,
  imports: [IconComponent, WizardStepSectionComponent],
  template: `
    <app-wizard-step-section
      icon="git-branch"
      title="Tipo de remisión"
      subtitle="Elige dirección y tipo"
    >
      <!-- 1. Direction selector -->
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
          Dirección del movimiento
        </h3>
        <div class="grid grid-cols-2 gap-3">
          @for (dir of directionOptions; track dir.value; let i = $index) {
            <button
              type="button"
              class="relative p-4 rounded-xl border-2 text-left transition-all duration-200"
              [class]="
                wizardService.direction() === dir.value
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] shadow-sm'
                  : 'border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
              "
              (click)="selectDirection(dir.value)"
            >
              <div class="flex items-center gap-2 mb-1">
                <span
                  class="flex items-center justify-center w-8 h-8 rounded-lg"
                  [class]="i === 0
                    ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                    : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'"
                >
                  <app-icon [name]="i === 0 ? 'arrow-up' : 'arrow-down'" [size]="18"></app-icon>
                </span>
                <span class="text-sm font-semibold text-[var(--color-text-primary)]">
                  {{ dir.label }}
                </span>
              </div>
              <p class="text-xs text-[var(--color-text-muted)] leading-snug">
                {{ dir.description }}
              </p>
              @if (wizardService.direction() === dir.value) {
                <span class="absolute top-2 right-2">
                  <app-icon
                    name="check-circle"
                    [size]="18"
                    color="var(--color-primary)"
                  ></app-icon>
                </span>
              }
            </button>
          }
        </div>
      </section>

      <!-- 2. Subtype selector -->
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
          Tipo de remisión
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          @for (st of availableSubtypes(); track st) {
            <button
              type="button"
              class="flex items-center gap-2.5 p-3 rounded-lg border-2 text-left transition-all duration-200"
              [class]="
                wizardService.subtype() === st
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
              "
              (click)="selectSubtype(st)"
            >
              <span
                class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold shrink-0"
                [class]="subtypeBgClass(st)"
              >
                {{ subtypeLabel(st) }}
              </span>
              <span class="text-xs text-[var(--color-text-muted)] truncate">
                {{ subtypeDescription(st) }}
              </span>
              @if (wizardService.subtype() === st) {
                <app-icon
                  name="check"
                  [size]="14"
                  color="var(--color-primary)"
                  class="ml-auto shrink-0"
                ></app-icon>
              }
            </button>
          }
        </div>
      </section>

      <!-- 3. Reason selector (optional) -->
      @if (availableReasons(); as reasons) {
        <section>
          <div class="flex items-center gap-1.5 mb-2">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Razón
            </h3>
            <span class="text-xs text-[var(--color-text-muted)] italic">(opcional)</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200"
              [class]="
                wizardService.reason() === null
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
              "
              (click)="selectReason(null)"
            >
              Sin razón
            </button>
            @for (r of reasons; track r) {
              <button
                type="button"
                class="px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200"
                [class]="
                  wizardService.reason() === r
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
                "
                (click)="selectReason(r)"
              >
                {{ reasonLabel(r) }}
              </button>
            }
          </div>
        </section>
      }

      <!-- Summary hint -->
      <div
        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-muted)]"
      >
        <p>
          Has seleccionado:
          <span class="font-medium text-[var(--color-text-primary)]">
            {{ directionLabel(wizardService.direction()) }}
          </span>
          →
          <span class="font-medium text-[var(--color-text-primary)]">
            {{ subtypeLabel(wizardService.subtype()) }}
          </span>
          @if (wizardService.reason(); as r) {
            →
            <span class="font-medium text-[var(--color-text-primary)]">
              {{ reasonLabel(r) }}
            </span>
          }
        </p>
      </div>
    </app-wizard-step-section>
  `,
})
export class TypeStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);

  // Static arrays for the direction cards (never changes).
  readonly directionOptions: ReadonlyArray<{
    value: DispatchNoteDirection;
    label: string;
    description: string;
  }> = [
    { value: 'outbound', label: DIRECTION_LABELS.outbound, description: DIRECTION_DESCRIPTIONS.outbound },
    { value: 'inbound', label: DIRECTION_LABELS.inbound, description: DIRECTION_DESCRIPTIONS.inbound },
  ];

  // --- Derived lists (computed) ---

  readonly availableSubtypes = computed<DispatchNoteSubtype[]>(() =>
    DISPATCH_SUBTYPE_BY_DIRECTION[this.wizardService.direction()] ?? [],
  );

  readonly availableReasons = computed<DispatchNoteReason[] | null>(() => {
    const reasons = DISPATCH_REASON_BY_SUBTYPE[this.wizardService.subtype()];
    return reasons ?? null;
  });

  // --- Selection handlers ---

  selectDirection(d: DispatchNoteDirection): void {
    this.wizardService.setDirection(d);
  }

  selectSubtype(s: DispatchNoteSubtype): void {
    this.wizardService.setSubtype(s);
  }

  selectReason(r: DispatchNoteReason | null): void {
    this.wizardService.setReason(r);
  }

  // --- Label helpers (pure functions, no signals needed for lookups) ---

  directionLabel(d: DispatchNoteDirection): string {
    return DIRECTION_LABELS[d] ?? d;
  }

  subtypeLabel(s: DispatchNoteSubtype): string {
    return SUBTYPE_LABELS[s] ?? s;
  }

  subtypeDescription(s: DispatchNoteSubtype): string {
    return SUBTYPE_DESCRIPTIONS[s] ?? '';
  }

  subtypeBgClass(s: DispatchNoteSubtype): string {
    return SUBTYPE_BG_CLASSES[s] ?? 'bg-[var(--color-muted)] text-[var(--color-text-primary)]';
  }

  reasonLabel(r: DispatchNoteReason): string {
    return REASON_LABELS[r] ?? r;
  }
}