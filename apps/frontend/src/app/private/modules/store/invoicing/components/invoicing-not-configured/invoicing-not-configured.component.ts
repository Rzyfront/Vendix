import { Component, computed, inject, input, model } from '@angular/core';
import { Router } from '@angular/router';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../../shared/components';
import { DianGateReason } from '../../state/selectors/invoicing.selectors';

@Component({
  selector: 'app-invoicing-not-configured',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onCancel()"
      title="Configuración DIAN requerida"
      size="md"
    >
      <div class="p-4 md:p-6 space-y-4">
        <div class="flex items-start gap-3">
          <div
            class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0"
          >
            <app-icon name="alert-triangle" [size]="20"></app-icon>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm text-text-primary leading-relaxed">
              {{ message() }}
            </p>
            <p class="text-xs text-text-secondary mt-2">
              Ve a la configuración DIAN para completar los datos antes de emitir facturas electrónicas.
            </p>
          </div>
        </div>
      </div>

      <div slot="footer" class="flex gap-3 justify-end w-full">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button variant="primary" (clicked)="goToConfig()">
          <app-icon slot="icon" name="arrow-right" [size]="14"></app-icon>
          Ir a configuración
        </app-button>
      </div>
    </app-modal>
  `,
})
export class InvoicingNotConfiguredComponent {
  private router = inject(Router);

  readonly isOpen = model.required<boolean>();
  readonly reason = input<DianGateReason>('missing');

  readonly message = computed<string>(() => {
    switch (this.reason()) {
      case 'not_enabled':
        return 'La configuración DIAN no está habilitada en producción. Revisa el estado en DIAN.';
      case 'expired_cert':
        return 'El certificado digital está vencido. Renuévalo antes de facturar.';
      case 'missing':
      default:
        return 'No hay configuración DIAN activa. Configura una antes de facturar.';
    }
  });

  onCancel(): void {
    this.isOpen.set(false);
  }

  goToConfig(): void {
    this.isOpen.set(false);
    this.router.navigate(['/admin/invoicing/dian-config']);
  }
}
