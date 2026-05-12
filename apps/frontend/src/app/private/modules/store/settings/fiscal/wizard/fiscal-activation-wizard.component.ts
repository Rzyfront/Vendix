import { Component } from '@angular/core';

import { FiscalActivationWizardComponent } from '../../../../../../shared/components/fiscal-activation-wizard/fiscal-activation-wizard.component';

@Component({
  selector: 'app-store-fiscal-activation-wizard',
  standalone: true,
  imports: [FiscalActivationWizardComponent],
  template: `<app-fiscal-activation-wizard />`,
})
export class StoreFiscalActivationWizardComponent {}
