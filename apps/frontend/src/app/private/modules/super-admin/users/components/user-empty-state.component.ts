import { Component, Input, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-user-empty-state',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="flex flex-col items-center justify-center py-16 px-4">
      <!-- Icon -->
      <div class="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
        <app-icon name="users" class="w-10 h-10 text-gray-400"></app-icon>
      </div>

      <!-- Title -->
      <h3 class="text-xl font-semibold text-text mb-2">
        {{ title }}
      </h3>

      <!-- Description -->
      <p class="text-text-muted text-center max-w-md mb-6">
        {{ description }}
      </p>

      <!-- Action Button (optional) -->
      <button
        *ngIf="showActionButton"
        (click)="actionClick.emit()"
        class="px-4 py-2 rounded-button text-white font-medium bg-primary hover:bg-primary/90 transition-colors flex items-center gap-2"
      >
        <app-icon name="plus" [size]="16"></app-icon>
        {{ actionText }}
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class UserEmptyStateComponent {
  @Input() title: string = 'No users found';
  @Input() description: string = 'Get started by creating your first user.';
  @Input() showActionButton: boolean = true;
  @Input() actionText: string = 'Create User';

  @Output() actionClick = new EventEmitter<void>();

  constructor() {}
}