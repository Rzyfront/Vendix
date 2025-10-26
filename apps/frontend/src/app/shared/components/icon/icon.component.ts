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
        <path *ngSwitchCase="'menu'" d="M3 12h18M3 6h18M3 18h18" />
        <path *ngSwitchCase="'chevron'" d="m6 9 6 6 6-6" />
        <path *ngSwitchCase="'chevron-down'" d="m6 9 6 6 6-6" />
        <path *ngSwitchCase="'chevron-up'" d="m18 15-6-6-6 6" />
        <path *ngSwitchCase="'chevron-left'" d="m15 18-6-6 6-6" />
        <path *ngSwitchCase="'chevron-right'" d="m9 18 6-6-6-6" />
        <path
          *ngSwitchCase="'logout'"
          d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
        />
        <path *ngSwitchCase="'plus'" d="M5 12h14m-7-7v14" />
        <path *ngSwitchCase="'close'" d="M18 6 6 18M6 6l12 12" />
        <path *ngSwitchCase="'check'" d="M20 6 9 17l-5-5" />
        <path
          *ngSwitchCase="'search'"
          d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z"
        />
        <path
          *ngSwitchCase="'edit'"
          d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
        />
        <path
          *ngSwitchCase="'delete'"
          d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        />
        <path
          *ngSwitchCase="'trash-2'"
          d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6"
        />
        <path
          *ngSwitchCase="'info'"
          d="M12 16v-4m0-4h.01M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z"
        />
        <path
          *ngSwitchCase="'warning'"
          d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4m0 4h.01"
        />
        <path
          *ngSwitchCase="'user'"
          d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
        />
        <path
          *ngSwitchCase="'lock'"
          d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"
        />
        <path
          *ngSwitchCase="'home'"
          d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        />
        <path
          *ngSwitchCase="'building'"
          d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"
        />
        <path
          *ngSwitchCase="'users'"
          d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m8-12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7 11v-2a4 4 0 0 0-4-4h-2m-4 0a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
        />
        <path
          *ngSwitchCase="'settings'"
          d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        />
        <circle *ngSwitchCase="'settings'" cx="12" cy="12" r="3" />
        <path
          *ngSwitchCase="'chart-line'"
          d="M3 3v18h18M21 16l-5-5-5 5-4-4-3 3"
        />
        <path
          *ngSwitchCase="'credit-card'"
          d="M3 6h18M3 10h18M3 14h18M5 18h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z"
        />
        <path
          *ngSwitchCase="'headset'"
          d="M22 16a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v6z"
        />

        <path
          *ngSwitchCase="'refresh'"
          d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"
        />
        <path
          *ngSwitchCase="'archive'"
          d="M21 8v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8m5-4h8a2 2 0 0 1 2 2v4H6V4a2 2 0 0 1 2-2z"
        />
        <path
          *ngSwitchCase="'shield'"
          d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        />
        <path
          *ngSwitchCase="'check-circle'"
          d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3"
        />
        <circle *ngSwitchCase="'clock'" cx="12" cy="12" r="9" fill="none" />
        <path
          *ngSwitchCase="'clock'"
          d="M12 6v6l4 2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle
          *ngSwitchCase="'clock'"
          cx="12"
          cy="12"
          r="1"
          fill="currentColor"
        />
        <path
          *ngSwitchCase="'user-x'"
          d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7 1-4 4m0-4 4 4"
        />
        <path
          *ngSwitchCase="'alert-triangle'"
          d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4m0 4h.01"
        />
        <path
          *ngSwitchCase="'mail-check'"
          d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7m5-10 4 4m0 0 4-4m-4 4V3"
        />

        <!-- Additional icons for audit and security -->
        <path
          *ngSwitchCase="'eye'"
          d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
        />
        <path
          *ngSwitchCase="'shield-check'"
          d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4"
        />

        <!-- Filter and control icons -->
        <path *ngSwitchCase="'filter'" d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        <path
          *ngSwitchCase="'sliders'"
          d="M12 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
        />
        <path
          *ngSwitchCase="'sliders-horizontal'"
          d="M2 12h6m2 0h6m2 0h6M6 8v8m4-4v4m4-2v2"
        />
        <path
          *ngSwitchCase="'refresh-ccw'"
          d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"
        />
        <path
          *ngSwitchCase="'rotate-ccw'"
          d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
        />

        <!-- Missing icons for audit stats -->
        <path
          *ngSwitchCase="'plus-circle'"
          d="M12 9v6m-3-3h6m-6 0a9 9 0 1 1 18 0 9 9 0 0 1-18 0z"
        />
        <path
          *ngSwitchCase="'log-in'"
          d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"
        />
        <path
          *ngSwitchCase="'log-out'"
          d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H3"
        />
        <ellipse
          *ngSwitchCase="'database'"
          cx="12"
          cy="5"
          rx="8"
          ry="3"
          fill="none"
        />
        <path
          *ngSwitchCase="'database'"
          d="M4 5v14c0 1.66 4 3 8 3s8-1.34 8-3V5"
          fill="none"
        />
        <ellipse
          *ngSwitchCase="'database'"
          cx="12"
          cy="19"
          rx="8"
          ry="3"
          fill="none"
        />
        <ellipse
          *ngSwitchCase="'database'"
          cx="12"
          cy="12"
          rx="8"
          ry="3"
          fill="none"
          opacity="0.5"
        />

        <!-- Commerce icons -->
        <path
          *ngSwitchCase="'cart'"
          d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0-2.5 1.5M7 13v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"
        />
        <path
          *ngSwitchCase="'store'"
          d="M4 9l8-6.5L20 9v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M10 13h4v6h-4z M7 4.5L12 2l5 2.5"
          stroke-width="1.5"
          fill="none"
        />
        <circle
          *ngSwitchCase="'store'"
          cx="12"
          cy="16"
          r="0.5"
          fill="currentColor"
        />
        <path
          *ngSwitchCase="'package'"
          d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
        />
        <path
          *ngSwitchCase="'tag'"
          d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01"
        />

        <path
          *ngSwitchCase="'link-2'"
          d="M15 12h3M6 12H3m11-7l3 3-3 3M6 5L3 8l3 3"
        />

        <!-- List and document icons -->
        <path
          *ngSwitchCase="'list'"
          d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        />
        <path
          *ngSwitchCase="'file-text'"
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6M16 13H8M16 17H8M10 9H8"
        />

        <!-- Default icon for unknown names -->
        <path
          *ngSwitchDefault
          d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"
        />
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
