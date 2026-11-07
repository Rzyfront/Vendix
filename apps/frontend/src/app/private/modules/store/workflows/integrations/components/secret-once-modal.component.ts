import { Component, inject, input, model } from '@angular/core';
import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../shared/components/index';

/** Shows a freshly generated secret (API key or signing secret) exactly once. */
@Component({
  selector: 'app-secret-once-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent, AlertBannerComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" [title]="title()" [subtitle]="subtitle()" size="md">
      <div class="flex flex-col gap-3">
        <app-alert-banner variant="warning" icon="alert-triangle">
          Guárdala ahora: no la volverás a ver.
        </app-alert-banner>
        <div class="rounded-xl border border-border p-3" data-testid="secret-once">
          <p class="text-xs font-semibold text-text-secondary">{{ label() }}</p>
          <p class="mt-1 break-all rounded-lg bg-background px-2 py-1.5 font-mono text-xs text-text-primary">
            {{ secret() }}
          </p>
        </div>
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Ya la guardé</app-button>
        <app-button variant="primary" (clicked)="copy()">
          <app-icon name="copy" [size]="14" slot="icon" />
          Copiar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class SecretOnceModalComponent {
  private readonly toast = inject(ToastService);

  readonly isOpen = model<boolean>(false);
  readonly title = input('Tu secreto');
  readonly subtitle = input('');
  readonly label = input('Secreto');
  readonly secret = input('');

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.secret());
      this.toast.success('Copiado');
    } catch {
      this.toast.warning('No se pudo copiar; selecciona el texto y cópialo a mano.');
    }
  }
}
