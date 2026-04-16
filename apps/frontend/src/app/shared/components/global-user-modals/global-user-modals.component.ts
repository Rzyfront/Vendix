import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { ProfileModalComponent } from '../profile-modal/profile-modal.component';
import { SettingsModalComponent } from '../settings-modal/settings-modal.component';
import { UserUiService } from '../../services/user-ui.service';

@Component({
  selector: 'app-global-user-modals',
  standalone: true,
  imports: [AsyncPipe, ProfileModalComponent, SettingsModalComponent],
  template: `
    <app-profile-modal
      [isOpen]="(userUiService.isProfileOpen$ | async) || false"
      (isOpenChange)="onProfileClose($event)"
    ></app-profile-modal>

    <app-settings-modal
      [isOpen]="(userUiService.isSettingsOpen$ | async) || false"
      (isOpenChange)="onSettingsClose($event)"
    ></app-settings-modal>
  `,
})
export class GlobalUserModalsComponent {
  userUiService = inject(UserUiService);

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
