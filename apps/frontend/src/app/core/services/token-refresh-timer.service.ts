import { Injectable, inject, OnDestroy } from '@angular/core';
import { Subscription, timer, EMPTY } from 'rxjs';
import { tap, catchError, take } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { Store } from '@ngrx/store';
import * as AuthActions from '../store/auth/auth.actions';

/**
 * Service that handles proactive token refresh before expiration.
 * This prevents users from being logged out unexpectedly when their access token expires.
 *
 * The timer refreshes tokens either:
 * - 5 minutes before expiration, OR
 * - At 80% of the token lifetime (whichever is smaller)
 */
@Injectable({ providedIn: 'root' })
export class TokenRefreshTimerService implements OnDestroy {
  private timerSubscription?: Subscription;
  private isRefreshing = false;

  private authService = inject(AuthService);
  private store = inject(Store);

  /**
   * Starts the proactive refresh timer based on token expiration time.
   * @param expiresInMs - Token expiration time in milliseconds
   */
  startTimer(expiresInMs: number): void {
    this.stopTimer();

    if (!expiresInMs || expiresInMs <= 0) {
      console.warn('[TokenRefreshTimer] Invalid expiration time, skipping timer setup');
      return;
    }

    // Calculate when to refresh:
    // - 5 minutes (300000ms) before expiration, OR
    // - At 80% of the token lifetime
    // Use whichever results in an earlier refresh
    const fiveMinutesMs = 5 * 60 * 1000;
    const eightyPercentTime = expiresInMs * 0.8;
    const refreshAt = Math.min(expiresInMs - fiveMinutesMs, eightyPercentTime);

    // Ensure we have a positive refresh time (at least 30 seconds)
    const minRefreshTime = 30 * 1000;
    const finalRefreshTime = Math.max(refreshAt, minRefreshTime);

    // Don't set timer if token expires in less than minimum time
    if (expiresInMs < minRefreshTime) {
      console.warn('[TokenRefreshTimer] Token expiring too soon, triggering immediate refresh');
      this.proactiveRefresh();
      return;
    }

    console.log(
      `[TokenRefreshTimer] Starting timer. Token expires in ${Math.round(expiresInMs / 1000)}s, ` +
        `will refresh in ${Math.round(finalRefreshTime / 1000)}s`,
    );

    this.timerSubscription = timer(finalRefreshTime).subscribe(() => {
      this.proactiveRefresh();
    });
  }

  /**
   * Performs the proactive token refresh.
   * On success, updates tokens in the store and restarts the timer.
   * On failure, logs a warning - the auth interceptor will handle 401s.
   */
  private proactiveRefresh(): void {
    if (this.isRefreshing) {
      console.log('[TokenRefreshTimer] Refresh already in progress, skipping');
      return;
    }

    this.isRefreshing = true;
    console.log('[TokenRefreshTimer] Performing proactive token refresh');

    this.authService
      .refreshToken()
      .pipe(
        take(1),
        tap((response) => {
          this.isRefreshing = false;

          // Extract tokens from response (handle both direct and wrapped response)
          const accessToken = response.data?.access_token || response.access_token;
          const refreshToken = response.data?.refresh_token || response.refresh_token;
          const expiresIn = response.data?.expires_in || response.expires_in;

          if (accessToken) {
            // Dispatch action to update tokens in the store
            this.store.dispatch(
              AuthActions.refreshTokenSuccess({
                tokens: {
                  access_token: accessToken,
                  refresh_token: refreshToken,
                },
              }),
            );

            // Restart timer with new expiration
            if (expiresIn && expiresIn > 0) {
              this.startTimer(expiresIn);
            }

            console.log('[TokenRefreshTimer] Token refreshed successfully');
          } else {
            console.warn('[TokenRefreshTimer] Invalid response, no access token received');
          }
        }),
        catchError((error) => {
          this.isRefreshing = false;
          // Log warning but don't force logout - let the auth interceptor handle 401s
          console.warn('[TokenRefreshTimer] Proactive refresh failed, will retry on 401:', error);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  /**
   * Stops the current refresh timer.
   * Should be called on logout or when the component is destroyed.
   */
  stopTimer(): void {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
      this.timerSubscription = undefined;
      console.log('[TokenRefreshTimer] Timer stopped');
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }
}
