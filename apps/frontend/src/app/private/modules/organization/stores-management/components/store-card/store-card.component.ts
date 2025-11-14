import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreListItem } from '../../interfaces/store.interface';

@Component({
  selector: 'app-store-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './store-card.component.html',
  styleUrls: ['./store-card.component.scss']
})
export class StoreCardComponent {
  @Input() store: StoreListItem | null = null;
  @Input() isSelected: boolean = false;
  @Output() select = new EventEmitter<StoreListItem>();
  @Output() edit = new EventEmitter<StoreListItem>();
  @Output() delete = new EventEmitter<StoreListItem>();
  @Output() toggleStatus = new EventEmitter<StoreListItem>();

  onSelect(): void {
    if (this.store) {
      this.select.emit(this.store);
    }
  }

  onEdit(event: Event): void {
    event.stopPropagation();
    if (this.store) {
      this.edit.emit(this.store);
    }
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    if (this.store) {
      this.delete.emit(this.store);
    }
  }

  onToggleStatus(event: Event): void {
    event.stopPropagation();
    if (this.store) {
      this.toggleStatus.emit(this.store);
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'active':
        return 'text-green-600 bg-green-100';
      case 'inactive':
        return 'text-gray-600 bg-gray-100';
      case 'maintenance':
        return 'text-yellow-600 bg-yellow-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'active':
        return 'check-circle';
      case 'inactive':
        return 'pause-circle';
      case 'maintenance':
        return 'tool';
      default:
        return 'question-mark-circle';
    }
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }
}