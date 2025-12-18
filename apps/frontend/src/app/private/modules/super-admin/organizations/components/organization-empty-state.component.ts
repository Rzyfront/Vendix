import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-organization-empty-state',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="p-8 text-center">
      <!-- Empty State Icon -->
      <div
        class="w-16 h-16 mx-auto mb-4 rounded-lg flex items-center justify-center bg-muted/20"
      >
        <app-icon
          name="building"
          [size]="24"
          class="text-text-muted"
        ></app-icon>
      </div>

      <!-- Empty State Content -->
      <h3 class="text-lg font-semibold mb-2 text-text-primary">{{ title }}</h3>
      <p class="text-sm mb-6 text-text-secondary">{{ description }}</p>

      <!-- Action Button -->
      <button
        *ngIf="showActionButton"
        (click)="onActionClick()"
        class="px-4 py-2 rounded-button text-white font-medium bg-primary hover:bg-primary/90 transition-colors flex items-center gap-2"
      >
        <app-icon name="plus" [size]="16"></app-icon>
        {{ actionText }}
      </button>
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
export class OrganizationEmptyStateComponent {
  @Input() title = 'No organizations found';
  @Input() description = 'Get started by creating your first organization.';
  @Input() showActionButton = true;
  @Input() actionText = 'Create Organization';
  @Output() actionClick = new EventEmitter<void>();

  onActionClick(): void {
    this.actionClick.emit();
  }
}
