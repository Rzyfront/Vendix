import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

/**
 * Org-scoped accounting shell.
 * Hosts read-only sub-pages consuming /api/organization/accounting/*.
 */
@Component({
  selector: 'vendix-org-accounting',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="w-full">
      <router-outlet></router-outlet>
    </div>
  `,
})
export class OrgAccountingComponent {}
