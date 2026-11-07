import { Component, input, model } from '@angular/core';
import { ButtonComponent, ModalComponent } from '../../../../../shared/components/index';

/** Lists the validator errors that stopped a publication, one Spanish line each. */
@Component({
  selector: 'app-publish-issues-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      [title]="'No se pudo publicar ' + flowName()"
      subtitle="Corrige estos puntos en la definición y vuelve a publicar"
      size="md"
    >
      <ul class="list-disc space-y-2 pl-5 text-sm text-text-primary" data-testid="publish-issues">
        @for (line of issues(); track $index) {
          <li>{{ line }}</li>
        }
      </ul>
      <div slot="footer" class="flex w-full justify-end">
        <app-button variant="primary" (clicked)="isOpen.set(false)">Entendido</app-button>
      </div>
    </app-modal>
  `,
})
export class PublishIssuesModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly flowName = input<string>('');
  readonly issues = input<string[]>([]);
}
