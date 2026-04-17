import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';

export interface TourStep {
  id: string;
  title: string;
  description: string;
  action?: string;
  // Target selector (fallback if device-specific target not provided)
  target?: string;
  // Device-specific target selectors (takes precedence over `target`)
  targetMobile?: string;
  targetDesktop?: string;
  // Target for click detection only (no spotlight shown)
  autoAdvanceTarget?: string;
  // Device-specific click detection targets
  autoAdvanceTargetMobile?: string;
  autoAdvanceTargetDesktop?: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  beforeShow?: () => Promise<void> | void;
  afterShow?: () => Promise<void> | void;
  beforeNext?: () => Promise<boolean> | boolean;
}

export interface TourConfig {
  id: string;
  name: string;
  steps: TourStep[];
  showProgress?: boolean;
  showSkipButton?: boolean;
}

export interface TourState {
  isActive: boolean;
  currentTourId: string | null;
  currentStepIndex: number;
  completedTours: string[];
  skippedTours: string[];
}

// Interface for tour state stored in user_settings
export interface UserToursState {
  completedTours: string[];
  skippedTours: string[];
}

@Injectable({
  providedIn: 'root',
})
export class TourService {
  private authFacade = inject(AuthFacade);

  // Active tour state (not persisted - only for current session)
  private activeTourState: TourState = {
    isActive: false,
    currentTourId: null,
    currentStepIndex: 0,
    completedTours: [],
    skippedTours: [],
  };

  readonly state = signal<TourState>(this.activeTourState);
  public state$ = toObservable(this.state);

  constructor() {}

  /**
   * Get the tour state from user_settings
   */
  private getUserToursState(): UserToursState {
    const userSettings = this.authFacade.getUserSettings();
    const toursState = userSettings?.config?.tours as UserToursState;

    return {
      completedTours: toursState?.completedTours || [],
      skippedTours: toursState?.skippedTours || [],
    };
  }

  /**
   * Save tour state to user_settings
   */
  private saveUserToursState(state: UserToursState): void {
    const userSettings = this.authFacade.getUserSettings();

    // Create a completely new mutable object (deep clone)
    const updatedSettings: any = userSettings
      ? JSON.parse(JSON.stringify(userSettings))
      : { id: 0, user_id: 0, app_type: '', config: { panel_ui: {} } };

    // Ensure config exists
    if (!updatedSettings.config) {
      updatedSettings.config = { panel_ui: {} };
    }

    // Update tours state
    updatedSettings.config.tours = state;

    // Save via AuthFacade
    this.authFacade.updateUserSettings(updatedSettings);
  }

  /**
   * Check if a tour has been completed
   */
  isTourCompleted(tourId: string): boolean {
    const { completedTours } = this.getUserToursState();
    return completedTours.includes(tourId);
  }

  /**
   * Check if a tour has been skipped
   */
  isTourSkipped(tourId: string): boolean {
    const { skippedTours } = this.getUserToursState();
    return skippedTours.includes(tourId);
  }

  /**
   * Check if a tour can be shown (not completed or skipped)
   */
  canShowTour(tourId: string): boolean {
    return !this.isTourCompleted(tourId) && !this.isTourSkipped(tourId);
  }

  /**
   * Mark a tour as completed
   */
  completeTour(tourId: string): void {
    const currentState = this.getUserToursState();

    // Create a new mutable object
    const toursState: UserToursState = {
      completedTours: currentState.completedTours.includes(tourId)
        ? currentState.completedTours
        : [...currentState.completedTours, tourId],
      skippedTours: currentState.skippedTours.filter((id) => id !== tourId),
    };

    // Save to user_settings
    this.saveUserToursState(toursState);

    // Update active tour state
    if (this.activeTourState.currentTourId === tourId) {
      this.activeTourState.isActive = false;
      this.activeTourState.currentTourId = null;
      this.activeTourState.currentStepIndex = 0;
    }

    this.activeTourState.completedTours = toursState.completedTours;
    this.activeTourState.skippedTours = toursState.skippedTours;
    this.notifyStateChange();
  }

  /**
   * Mark a tour as skipped
   */
  skipTour(tourId: string): void {
    const currentState = this.getUserToursState();

    // Create a new mutable object
    const toursState: UserToursState = {
      completedTours: currentState.completedTours,
      skippedTours: currentState.skippedTours.includes(tourId)
        ? currentState.skippedTours
        : [...currentState.skippedTours, tourId],
    };

    // Save to user_settings
    this.saveUserToursState(toursState);

    // Update active tour state
    if (this.activeTourState.currentTourId === tourId) {
      this.activeTourState.isActive = false;
      this.activeTourState.currentTourId = null;
      this.activeTourState.currentStepIndex = 0;
    }

    this.activeTourState.completedTours = toursState.completedTours;
    this.activeTourState.skippedTours = toursState.skippedTours;
    this.notifyStateChange();
  }

  /**
   * Reset tour status (allow it to be shown again)
   */
  resetTour(tourId: string): void {
    const currentState = this.getUserToursState();

    // Create a new mutable object
    const toursState: UserToursState = {
      completedTours: currentState.completedTours.filter((id) => id !== tourId),
      skippedTours: currentState.skippedTours.filter((id) => id !== tourId),
    };

    // Save to user_settings
    this.saveUserToursState(toursState);

    // Update active tour state
    this.activeTourState.completedTours = toursState.completedTours;
    this.activeTourState.skippedTours = toursState.skippedTours;
    this.notifyStateChange();
  }

  /**
   * Reset all tours (for testing purposes)
   */
  resetAllTours(): void {
    const toursState: UserToursState = {
      completedTours: [],
      skippedTours: [],
    };

    // Save to user_settings
    this.saveUserToursState(toursState);

    // Update active tour state
    this.activeTourState.completedTours = [];
    this.activeTourState.skippedTours = [];
    this.activeTourState.isActive = false;
    this.activeTourState.currentTourId = null;
    this.activeTourState.currentStepIndex = 0;

    this.notifyStateChange();
  }

  /**
   * Start a tour programmatically
   */
  startTour(tourId: string): void {
    if (!this.canShowTour(tourId)) {
      return;
    }

    this.activeTourState.isActive = true;
    this.activeTourState.currentTourId = tourId;
    this.activeTourState.currentStepIndex = 0;

    const toursState = this.getUserToursState();
    this.activeTourState.completedTours = toursState.completedTours;
    this.activeTourState.skippedTours = toursState.skippedTours;

    this.notifyStateChange();
  }

  /**
   * End the current tour
   */
  endTour(): void {
    this.activeTourState.isActive = false;
    this.activeTourState.currentTourId = null;
    this.activeTourState.currentStepIndex = 0;

    this.notifyStateChange();
  }

  /**
   * Get the current active tour ID
   */
  getCurrentTourId(): string | null {
    return this.activeTourState.currentTourId;
  }

  /**
   * Check if any tour is currently active
   */
  isAnyTourActive(): boolean {
    return this.activeTourState.isActive;
  }

  /**
   * Notify subscribers of state change
   */
  private notifyStateChange(): void {
    this.state.set({ ...this.activeTourState });
  }
}
