import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

@Injectable({
  providedIn: 'root',
})
export class UserUiService {
  // Signal-first holders of simple UI state.
  readonly isProfileOpen = signal<boolean>(false);
  readonly isSettingsOpen = signal<boolean>(false);

  // Observable parallels for legacy consumers.
  public isProfileOpen$ = toObservable(this.isProfileOpen);
  public isSettingsOpen$ = toObservable(this.isSettingsOpen);

  constructor() {}

  openProfile() {
    this.isProfileOpen.set(true);
  }

  closeProfile() {
    this.isProfileOpen.set(false);
  }

  openSettings() {
    this.isSettingsOpen.set(true);
  }

  closeSettings() {
    this.isSettingsOpen.set(false);
  }
}
