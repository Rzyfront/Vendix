import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'vendix-org-purchase-orders',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="w-full">
      <router-outlet></router-outlet>
    </div>
  `,
})
export class OrgPurchaseOrdersComponent {}
