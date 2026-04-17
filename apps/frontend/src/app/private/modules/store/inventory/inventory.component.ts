import { Component } from '@angular/core';

import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="h-full overflow-auto bg-background">
      <router-outlet></router-outlet>
    </div>
  `,
})
export class InventoryComponent { }
