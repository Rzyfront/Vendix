import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ProfileModalComponent } from '../profile-modal/profile-modal.component';
import { SettingsModalComponent } from '../settings-modal/settings-modal.component';
import { UserUiService } from '../../services/user-ui.service';

@Component({
  selector: 'app-global-user-modals',
  standalone: true,
  imports: [ProfileModalComponent, SettingsModalComponent],
  template: `
    <app-profile-modal
      [isOpen]="isProfileOpen() || false"
      (isOpenChange)="onProfileClose($event)"
    ></app-profile-modal>

    <app-settings-modal
      [isOpen]="isSettingsOpen() || false"
      (isOpenChange)="onSettingsClose($event)"
    ></app-settings-modal>
  `,
})
export class GlobalUserModalsComponent {
  userUiService = inject(UserUiService);

  // Signal-based properties
  readonly isProfileOpen = toSignal(this.userUiService.isProfileOpen$, {
    initialValue: false,
  });
  readonly isSettingsOpen = toSignal(this.userUiService.isSettingsOpen$, {
    initialValue: false,
  });

  constructor() {}

  onProfileClose(isOpen: boolean) {
    if (!isOpen) {
      this.userUiService.closeProfile();
    }
  }

  onSettingsClose(isOpen: boolean) {
    if (!isOpen) {
      this.userUiService.closeSettings();
    }
  }
}
