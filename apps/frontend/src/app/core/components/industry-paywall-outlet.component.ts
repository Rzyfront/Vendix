import { Component, inject } from '@angular/core';
import { ModalComponent } from '../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { IndustryPaywallService } from '../services/industry-paywall.service';
import { AuthFacade } from '../store/auth/auth.facade';

/**
 * Industry paywall host (flujos-documental S6): explains that Flujos and
 * Documentos belong to the `administration` industry and, for the owner, links
 * to the settings page where industries are edited. Mounted once per private
 * layout, next to `<app-plan-paywall-outlet />`.
 */
@Component({
  selector: 'app-industry-paywall-outlet',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onIsOpenChange($event)"
      title="Flujos y Documentos son para empresas de administración"
      size="sm"
    >
      <div class="flex items-start gap-3" data-testid="industry-paywall">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <app-icon name="lock" [size]="18" />
        </span>
        <div class="flex flex-col gap-2">
          <p class="text-sm text-text-secondary">
            Activa la industria Administración en la configuración de tu tienda para diseñar
            procesos con etapas, responsables, aprobaciones y expedientes.
          </p>
          @if (!isOwner()) {
            <p class="text-xs text-text-secondary">
              Solo el propietario de la tienda puede cambiar las industrias.
            </p>
          }
        </div>
      </div>

      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="close()">Cerrar</app-button>
        @if (isOwner()) {
          <app-button variant="primary" (clicked)="goToSettings()">Ir a configuración</app-button>
        }
      </div>
    </app-modal>
  `,
})
export class IndustryPaywallOutletComponent {
  private readonly paywall = inject(IndustryPaywallService);
  private readonly authFacade = inject(AuthFacade);

  readonly isOpen = this.paywall.isOpen;

  isOwner(): boolean {
    return this.authFacade.isOwner();
  }

  close(): void {
    this.paywall.close();
  }

  goToSettings(): void {
    this.paywall.goToSettings();
  }

  onIsOpenChange(open: boolean): void {
    if (!open) this.paywall.close();
  }
}
