import { Component } from '@angular/core';

import { FiscalManagementPanelComponent } from '../../../../../shared/components/fiscal-management-panel/fiscal-management-panel.component';

@Component({
  selector: 'app-organization-fiscal-management',
  standalone: true,
  imports: [FiscalManagementPanelComponent],
  template: `<app-fiscal-management-panel />`,
})
export class OrganizationFiscalManagementComponent {}
