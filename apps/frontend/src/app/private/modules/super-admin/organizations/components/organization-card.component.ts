import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { OrganizationListItem } from '../interfaces/organization.interface';
import { IconComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-organization-card',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    <div 
      class="bg-white border border-border rounded-lg p-6 hover:shadow-md transition-shadow duration-200 cursor-pointer"
      (click)="onCardClick()">
      <div class="flex items-center justify-between">
        <!-- Organization Info -->
        <div class="flex items-center gap-4 flex-1">
          <!-- Organization Icon -->
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10">
            <app-icon name="building" [size]="20" class="text-primary"></app-icon>
          </div>
          
          <!-- Organization Details -->
          <div class="flex-1">
            <h3 class="font-semibold text-text-primary mb-1">{{ organization.name }}</h3>
            <p class="text-sm text-text-secondary mb-2">{{ organization.email }}</p>
            <div class="flex items-center gap-4 text-xs text-text-muted">
              <span>
                <app-icon name="calendar" [size]="14" class="mr-1"></app-icon>
                {{ organization.createdAt | date:'shortDate' }}
              </span>
              <span>
                <app-icon name="store" [size]="14" class="mr-1"></app-icon>
                {{ organization.settings.maxStores || 0 }} stores max
              </span>
            </div>
          </div>
        </div>

        <!-- Status Badge & Actions -->
        <div class="flex items-center gap-3">
          <!-- Status Badge -->
          <span 
            [class]="'px-3 py-1 rounded-full text-xs font-medium ' + getStatusClasses()">
            {{ getStatusLabel() }}
          </span>
          
          <!-- Actions Dropdown -->
          <div class="relative">
            <button
              class="p-2 rounded-lg hover:bg-gray-100 text-text-primary"
              (click)="toggleMenu($event)">
              <app-icon name="settings" [size]="16"></app-icon>
            </button>
            
            <!-- Dropdown Menu -->
            <div
              *ngIf="showMenu"
              class="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-border z-10">
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 rounded-t-lg flex items-center gap-2"
                (click)="viewDetails($event)">
                <app-icon name="search" [size]="14" class="text-text-secondary"></app-icon>
                View Details
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                (click)="editOrganization($event)">
                <app-icon name="edit" [size]="14" class="text-text-secondary"></app-icon>
                Edit
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 rounded-b-lg flex items-center gap-2 text-destructive"
                (click)="deleteOrganization($event)">
                <app-icon name="delete" [size]="14" class="text-destructive"></app-icon>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class OrganizationCardComponent {
  @Input() organization!: OrganizationListItem;
  @Output() cardClick = new EventEmitter<OrganizationListItem>();
  @Output() view = new EventEmitter<OrganizationListItem>();
  @Output() edit = new EventEmitter<OrganizationListItem>();
  @Output() delete = new EventEmitter<OrganizationListItem>();

  showMenu = false;

  onCardClick(): void {
    this.cardClick.emit(this.organization);
  }

  viewDetails(event: MouseEvent): void {
    event.stopPropagation();
    this.showMenu = false;
    this.view.emit(this.organization);
  }

  editOrganization(event: MouseEvent): void {
    event.stopPropagation();
    this.showMenu = false;
    this.edit.emit(this.organization);
  }

  deleteOrganization(event: MouseEvent): void {
    event.stopPropagation();
    this.showMenu = false;
    this.delete.emit(this.organization);
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.showMenu = !this.showMenu;
  }

  getStatusClasses(): string {
    switch (this.organization.status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-yellow-100 text-yellow-800';
      case 'suspended':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  getStatusLabel(): string {
    switch (this.organization.status) {
      case 'active':
        return 'Active';
      case 'inactive':
        return 'Inactive';
      case 'suspended':
        return 'Suspended';
      case 'pending':
        return 'Pending';
      default:
        return this.organization.status;
    }
  }
}