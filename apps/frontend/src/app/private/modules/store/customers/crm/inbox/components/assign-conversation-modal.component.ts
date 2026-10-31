import { Component, effect, input, model, output, signal, untracked } from '@angular/core';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  StoreUserSelectComponent,
} from '../../../../../../../shared/components';

/** Pick the staff member responsible for a conversation, or leave it unassigned. */
@Component({
  selector: 'app-crm-assign-conversation-modal',
  standalone: true,
  imports: [ButtonComponent, IconComponent, ModalComponent, StoreUserSelectComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Asignar conversación"
      subtitle="Solo puedes asignar a personal activo con acceso a la bandeja."
      size="sm"
    >
      <div class="flex flex-col gap-4">
        <app-store-user-select
          placeholder="Buscar persona del equipo..."
          [value]="selected()"
          (valueChange)="selected.set($event)"
        ></app-store-user-select>
        @if (currentUserId(); as me) {
          <button
            type="button"
            class="inline-flex h-8 w-fit items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-3 text-xs font-semibold text-primary-on-tint hover:bg-primary/15"
            (click)="selected.set(me)"
          >
            <app-icon name="user-check" [size]="12"></app-icon>
            Asignarme a mí
          </button>
        }
      </div>

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        @if (assignedUserId() !== null) {
          <app-button
            variant="outline-danger"
            size="md"
            [disabled]="saving()"
            (clicked)="assign.emit(null)"
          >
            Quitar responsable
          </app-button>
        }
        <app-button
          variant="primary"
          size="md"
          [disabled]="selected() === null || selected() === assignedUserId()"
          [loading]="saving()"
          (clicked)="assign.emit(selected())"
        >
          Asignar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class AssignConversationModalComponent {
  readonly isOpen = model(false);
  readonly assignedUserId = input<number | null>(null);
  readonly currentUserId = input<number | null>(null);
  readonly saving = input(false);
  readonly assign = output<number | null>();

  protected readonly selected = signal<number | null>(null);

  constructor() {
    // Start from the current assignee every time the modal opens.
    effect(() => {
      if (this.isOpen()) {
        const current = this.assignedUserId();
        untracked(() => this.selected.set(current));
      }
    });
  }
}
