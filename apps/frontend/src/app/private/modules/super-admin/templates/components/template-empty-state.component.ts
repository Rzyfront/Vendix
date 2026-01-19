import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-template-empty-state',
  standalone: true,
  imports: [CommonModule, IconComponent, ButtonComponent],
  template: `
    <div class="text-center py-12">
      <div class="flex justify-center">
        <app-icon name="file-text" [size]="64" class="text-text-secondary opacity-50"></app-icon>
      </div>
      <h3 class="mt-4 text-lg font-semibold text-text-primary">{{ title }}</h3>
      <p class="mt-2 text-text-secondary">{{ description }}</p>
      <app-button
        variant="primary"
        (clicked)="actionClick.emit()"
        class="mt-6"
      >
        <app-icon name="plus" [size]="16" slot="icon"></app-icon>
        Create First Template
      </app-button>
    </div>
  `,
})
export class TemplateEmptyStateComponent {
  @Input() title = 'No templates found';
  @Input() description = 'Get started by creating your first template.';

  @Output() actionClick = new EventEmitter<void>();
}
