import { Component } from '@angular/core';

@Component({
  selector: 'app-login-page-deprecated',
  standalone: true,
  template: `
    <div class="p-6 text-red-700 bg-red-50 rounded-xl border border-red-200">
      <h2 class="font-bold text-xl mb-2">Deprecated component</h2>
      <p>Do not use this component. Use routes under <code>/auth</code> from modules/auth instead.</p>
    </div>
  `,
})
export class LoginPageComponent {
  constructor() {
    if (true) {
      throw new Error('Deprecated component loaded. Remove any references to views/auth/login-page.component.* and use modules/auth.');
    }
  }
}