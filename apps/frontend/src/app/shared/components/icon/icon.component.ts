import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ICON_REGISTRY, IconName } from './icons.registry';

/**
 * IconComponent
 * - Renders basic SVG icons by name: <app-icon name="cart" [size]="16" class="text-gray-600" />
 * - Simplified version without external dependencies
 */

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <i-lucide
      [img]="iconData"
      [size]="size"
      [color]="color"
      [class]="cls"
    ></i-lucide>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size: number | string = 16;
  @Input() color?: string;
  @Input('class') cls = '';

  get iconData() {
    return ICON_REGISTRY[this.name] || ICON_REGISTRY['default'];
  }
}
