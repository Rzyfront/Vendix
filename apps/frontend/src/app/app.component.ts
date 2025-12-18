import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { GlobalUserModalsComponent } from './shared/components/global-user-modals/global-user-modals.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, GlobalUserModalsComponent],
  template: `
    <main>
      <router-outlet></router-outlet>
      <app-global-user-modals></app-global-user-modals>
    </main>
  `,
})
export class AppComponent {
  title = 'Vendix';
}
