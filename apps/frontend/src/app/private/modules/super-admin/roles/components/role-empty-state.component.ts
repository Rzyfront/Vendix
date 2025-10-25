import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-role-empty-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="text-center py-12">
      <!-- Icon -->
      <div class="mx-auto h-12 w-12 text-gray-400">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      </div>

      <!-- Title -->
      <h3 class="mt-2 text-sm font-medium text-gray-900">
        {{ title }}
      </h3>

      <!-- Description -->
      <p class="mt-1 text-sm text-gray-500">
        {{ description }}
      </p>

      <!-- Action Button -->
      <div class="mt-6" *ngIf="showAction">
        <button
          type="button"
          class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          (click)="actionClick.emit()"
        >
          <svg class="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          {{ actionText }}
        </button>
      </div>
    </div>
  `
})
export class RoleEmptyStateComponent {
  @Input() title = 'No roles found';
  @Input() description = 'Get started by creating your first role.';
  @Input() showAction = true;
  @Input() actionText = 'Create Role';
  @Output() actionClick = new EventEmitter<void>();
}