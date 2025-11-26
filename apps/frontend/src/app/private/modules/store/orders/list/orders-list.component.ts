import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TableComponent,
  TableColumn,
  TableAction,
} from '../../../../../shared/components/table/table.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { OrdersService } from '../services/orders.service';
import { SalesOrder } from '../interfaces/order.interface';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [CommonModule, TableComponent, ButtonComponent, ModalComponent],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Lista de Pedidos</h1>
        <p class="text-gray-600">
          Ver y gestionar todos los pedidos de clientes
        </p>
      </div>

      <div class="bg-white rounded-lg shadow-sm border p-8">
        <div class="text-center">
          <div
            class="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4"
          >
            <svg
              class="w-8 h-8 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
              ></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">
            Gestión de Pedidos
          </h2>
          <p class="text-gray-600 max-w-md mx-auto">
            La gestión de lista de pedidos está en desarrollo. Podrás ver,
            filtrar y gestionar todos los pedidos aquí.
          </p>
        </div>
        <div slot="footer" class="flex justify-end space-x-2">
          <app-button (clicked)="closeCreateModal()" variant="ghost"
            >Cancel</app-button
          >
          <app-button (clicked)="createOrder()" variant="primary"
            >Create Order</app-button
          >
        </div>
      </app-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class OrdersListComponent {}
