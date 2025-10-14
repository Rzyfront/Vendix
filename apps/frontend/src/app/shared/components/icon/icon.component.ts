import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * IconComponent
 * - Renders basic SVG icons by name: <app-icon name="cart" [size]="16" class="text-gray-600" />
 * - Simplified version without external dependencies
 */

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      [attr.viewBox]="'0 0 24 24'"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      [attr.width]="size"
      [attr.height]="size"
      [attr.stroke]="color || 'currentColor'"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.class]="cls"
      aria-hidden="true"
    >
      <ng-container [ngSwitch]="name">
        <!-- Basic UI icons -->
        <path *ngSwitchCase="'chevron-down'" d="m6 9 6 6 6-6"/>
        <path *ngSwitchCase="'chevron-up'" d="m18 15-6-6-6 6"/>
        <path *ngSwitchCase="'chevron-left'" d="m15 18-6-6 6-6"/>
        <path *ngSwitchCase="'chevron-right'" d="m9 18 6-6-6-6"/>
        <path *ngSwitchCase="'plus'" d="M5 12h14m-7-7v14"/>
        <path *ngSwitchCase="'close'" d="M18 6 6 18M6 6l12 12"/>
        <path *ngSwitchCase="'check'" d="M20 6 9 17l-5-5"/>
        <path *ngSwitchCase="'search'" d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z"/>
        <path *ngSwitchCase="'edit'" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path *ngSwitchCase="'delete'" d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <path *ngSwitchCase="'info'" d="M12 16v-4m0-4h.01M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z"/>
        <path *ngSwitchCase="'warning'" d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4m0 4h.01"/>
        <path *ngSwitchCase="'user'" d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>
        <path *ngSwitchCase="'lock'" d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/>
        <path *ngSwitchCase="'home'" d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <path *ngSwitchCase="'settings'" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle *ngSwitchCase="'settings'" cx="12" cy="12" r="3"/>
        
        <!-- Commerce icons -->
        <path *ngSwitchCase="'cart'" d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0-2.5 1.5M7 13v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"/>
        <path *ngSwitchCase="'store'" d="M3 3h18v2H3zm0 4h18v10H3zm0 4h18M3 3v18"/>
        <path *ngSwitchCase="'package'" d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
        <path *ngSwitchCase="'tag'" d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01"/>
        
        <!-- Default icon for unknown names -->
        <path *ngSwitchDefault d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
      </ng-container>
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  @Input({ required: true }) name!: string;
  @Input() size: number | string = 16;
  @Input() color?: string;
  @Input('class') cls = '';
}
