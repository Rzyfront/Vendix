import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="h-full overflow-auto bg-background">
      <router-outlet></router-outlet>
    </div>
  `,
})
export class InventoryComponent { }
