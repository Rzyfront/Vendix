import { Component, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  TextareaComponent,
} from '../../../../../shared/components/index';

/**
 * Small modal that asks for the comment of a quick "Rechazar" / "Devolver"
 * action. The parent runs the request and closes the modal; `busy` and
 * `errorMessage` come from the parent.
 */
@Component({
  selector: 'app-workflow-comment-outcome-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, TextareaComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      [title]="title()"
      [subtitle]="subtitle()"
      size="sm"
    >
      <app-textarea
        label="Comentario *"
        placeholder="Escribe el motivo"
        helperText="Quedará en la línea de tiempo de la solicitud."
        [rows]="4"
        [error]="localError() || undefined"
        [ngModel]="comment()"
        (ngModelChange)="onChange($event)"
      />
      @if (errorMessage()) {
        <p class="mt-3 text-sm text-error" role="alert">{{ errorMessage() }}</p>
      }
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="onOpenChange(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="busy()" (clicked)="confirm()">
          {{ confirmText() }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class WorkflowCommentOutcomeModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly title = input<string>('Comentario');
  readonly subtitle = input<string>('');
  readonly confirmText = input<string>('Confirmar');
  readonly busy = input<boolean>(false);
  readonly errorMessage = input<string>('');
  readonly confirmed = output<string>();

  readonly comment = signal('');
  readonly localError = signal('');

  onOpenChange(open: boolean): void {
    this.isOpen.set(open);
    if (!open) {
      this.comment.set('');
      this.localError.set('');
    }
  }

  onChange(value: string | null): void {
    this.comment.set(value ?? '');
    this.localError.set('');
  }

  confirm(): void {
    const text = this.comment().trim();
    if (!text) {
      this.localError.set('El comentario es obligatorio.');
      return;
    }
    this.confirmed.emit(text);
  }
}
