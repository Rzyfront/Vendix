import { Injectable, inject } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { SubscriptionFacade } from '../store/subscription';

@Injectable({ providedIn: 'root' })
export class SubscriptionActiveGuard implements CanActivate {
  private facade = inject(SubscriptionFacade);
  private router = inject(Router);

  canActivate(
    _route: ActivatedRouteSnapshot,
    _state: RouterStateSnapshot,
  ): Observable<boolean | UrlTree> {
    return of(true).pipe(
      map(() => {
        const status = this.facade.getStatus();
        if (['blocked', 'cancelled', 'canceled', 'expired'].includes(status)) {
          return this.router.createUrlTree(['/subscription']);
        }
        return true;
      }),
    );
  }
}
