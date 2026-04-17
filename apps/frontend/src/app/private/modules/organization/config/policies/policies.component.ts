import { Component } from '@angular/core';


@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Políticas organizacionales</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          La gestión y configuración de políticas se mostrará aquí
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PoliciesComponent {}
