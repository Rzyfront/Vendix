import { Component } from '@angular/core';

import { FiscalActivationWizardComponent } from '../../../../../../shared/components/fiscal-activation-wizard/fiscal-activation-wizard.component';

@Component({
  selector: 'app-organization-fiscal-activation-wizard',
  standalone: true,
  imports: [FiscalActivationWizardComponent],
  template: `<app-fiscal-activation-wizard />`,
})
export class OrganizationFiscalActivationWizardComponent {}
