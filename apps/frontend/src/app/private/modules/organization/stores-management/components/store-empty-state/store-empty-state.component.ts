import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-store-empty-state',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './store-empty-state.component.html',
  styleUrls: ['./store-empty-state.component.scss']
})
export class StoreEmptyStateComponent {
  @Output() createStore = new EventEmitter<void>();

  onCreateStore(): void {
    this.createStore.emit();
  }
}