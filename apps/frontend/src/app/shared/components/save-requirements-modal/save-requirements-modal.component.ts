import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
} from '@angular/core';

import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { ModalComponent } from '../modal/modal.component';
import { SaveRequirement } from './save-requirements.interface';

/**
 * Modal generico que lista, en lenguaje humano, todo lo que impide completar
 * una accion (guardar un producto, activar el manejo fiscal, etc.). Reutiliza
 * el patron de checklist del wizard fiscal (fila con icono de estado, label +
 * motivo, y un CTA por fila accionable). Los `blocker` van arriba con mas
 * enfasis; los `required` debajo.
 */
@Component({
  selector: 'app-save-requirements-modal',
  standalone: true,
  imports: [ModalComponent, IconComponent, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './save-requirements-modal.component.html',
  styles: [
    `
      .requirements-body {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .requirements-banner {
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        padding: 0.85rem 1rem;
        margin: 0;
        border: 1px solid #fcd34d;
        border-radius: 0.5rem;
        background: #fffbeb;
        color: var(--warning-color, #92400e);
      }
      .requirements-banner__body {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .requirements-banner__body strong {
        display: block;
        font-size: 0.9rem;
        color: var(--warning-color, #92400e);
      }
      .requirements-banner__body small {
        display: block;
        font-size: 0.8rem;
        line-height: 1.35;
        color: #78350f;
      }
      .requirements-banner app-icon {
        flex: 0 0 auto;
        color: var(--warning-color, #92400e);
      }
      .requirements-list {
        display: grid;
        gap: 0.6rem;
      }
      .requirement-row {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
        padding: 0.85rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--surface-color, #ffffff);
      }
      .requirement-row--blocker {
        border-color: var(--color-destructive, #b91c1c);
        background: color-mix(
          in srgb,
          var(--color-destructive, #b91c1c) 5%,
          #ffffff
        );
      }
      .requirement-row__body {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        flex: 1 1 auto;
        min-width: 0;
      }
      .requirement-row__body strong {
        display: block;
        font-size: 0.95rem;
        color: var(--text-primary, #0f172a);
      }
      .requirement-row__reason {
        color: var(--warning-color, #92400e) !important;
        font-weight: 600;
        font-size: 0.85rem;
        line-height: 1.25rem;
      }
      .requirement-row--blocker .requirement-row__reason {
        color: var(--color-destructive, #b91c1c) !important;
      }
      .requirement-state {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 1.45rem;
        height: 1.45rem;
        border-radius: 999px;
        background: color-mix(
          in srgb,
          var(--warning-color, #f59e0b) 14%,
          #ffffff
        );
        color: var(--warning-color, #92400e);
      }
      .requirement-state--blocker {
        background: color-mix(
          in srgb,
          var(--color-destructive, #b91c1c) 14%,
          #ffffff
        );
        color: var(--color-destructive, #b91c1c);
      }
      @media (max-width: 560px) {
        .requirement-row {
          flex-wrap: wrap;
        }
        .requirement-row app-button {
          width: 100%;
        }
      }
    `,
  ],
})
export class SaveRequirementsModalComponent {
  /** Visibilidad del modal (two-way desde el padre). */
  readonly isOpen = model<boolean>(false);

  /** Lista completa de requisitos pendientes para poder continuar. */
  readonly requirements = input<SaveRequirement[]>([]);

  /** Se emite cuando el usuario pulsa el CTA de una fila. */
  readonly action = output<SaveRequirement>();

  /** Requisitos que bloquean por completo la accion (mas enfasis, arriba). */
  readonly blockers = computed(() =>
    this.requirements().filter((r) => r.severity === 'blocker'),
  );

  /** Requisitos obligatorios estandar (debajo de los blockers). */
  readonly requiredItems = computed(() =>
    this.requirements().filter((r) => r.severity === 'required'),
  );

  /** Total de requisitos pendientes. */
  readonly count = computed(() => this.requirements().length);

  onCta(req: SaveRequirement): void {
    this.action.emit(req);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
