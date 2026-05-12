import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

@Injectable({
  providedIn: 'root',
})
export class PartnerOrgGuard implements CanActivate {
  private tenantFacade = inject(TenantFacade);
  private router = inject(Router);
  private toastService = inject(ToastService);

  canActivate(): boolean {
    const isPartner = this.tenantFacade.currentOrganization()?.is_partner;

    if (!isPartner) {
      this.toastService.warning('Esta sección solo está disponible para organizaciones partner');
      this.router.navigate(['/admin/subscriptions']);
      return false;
    }

    return true;
  }
}
