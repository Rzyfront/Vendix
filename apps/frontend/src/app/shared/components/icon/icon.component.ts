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
      [style.animation]="spin ? 'spin 1s linear infinite' : 'none'"
    ></i-lucide>
  `,
  styles: [`
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size: number | string = 16;
  @Input() color?: string;
  @Input('class') cls = '';
  @Input() spin: boolean = false;

  get iconData() {
    return ICON_REGISTRY[this.name] || ICON_REGISTRY['default'];
  }
}
