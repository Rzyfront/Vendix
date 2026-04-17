
import { Component, input } from '@angular/core';
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
  imports: [LucideAngularModule],
  template: `
    <i-lucide
      [img]="iconData"
      [size]="size()"
      [color]="color()"
      [class]="cls()"
      [style.animation]="spin() ? 'spin 1s linear infinite' : 'none'"
    ></i-lucide>
  `,
  styles: [
    `
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number | string>(16);
  readonly color = input<string>();
  readonly cls = input('', { alias: "class" });
  readonly spin = input<boolean>(false);

  get iconData() {
    return ICON_REGISTRY[this.name()] || ICON_REGISTRY['default'];
  }
}
