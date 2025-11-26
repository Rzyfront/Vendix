import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-access-audit',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Auditoría de acceso</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
         Los registros de auditoría de acceso y los informes de seguridad se mostrarán aquí.
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
export class AccessAuditComponent {}
