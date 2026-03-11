import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class UserUiService {
  private isProfileOpenSubject = new BehaviorSubject<boolean>(false);
  public isProfileOpen$ = this.isProfileOpenSubject.asObservable();

  private isSettingsOpenSubject = new BehaviorSubject<boolean>(false);
  public isSettingsOpen$ = this.isSettingsOpenSubject.asObservable();

  constructor() {}

  openProfile() {
    this.isProfileOpenSubject.next(true);
  }

  closeProfile() {
    this.isProfileOpenSubject.next(false);
  }

  openSettings() {
    this.isSettingsOpenSubject.next(true);
  }

  closeSettings() {
    this.isSettingsOpenSubject.next(false);
  }
}
