import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Coordina interacciones de UI globales del layout store-ecommerce.
 *
 * Nota Zoneless/Signals: `open_auth_modal_subject` es un Subject con payload
 * ('login' | 'register') que opera como event bus (pub/sub) — caso legitimo
 * segun el skill `vendix-zoneless-signals` (no es estado UI). Se conserva
 * intencionalmente como Subject, no se migra a signal.
 */
@Injectable({
    providedIn: 'root',
})
export class StoreUiService {
    private readonly open_auth_modal_subject = new Subject<'login' | 'register'>();
    readonly openAuthModal$ = this.open_auth_modal_subject.asObservable();

    openLoginModal(): void {
        this.open_auth_modal_subject.next('login');
    }

    openRegisterModal(): void {
        this.open_auth_modal_subject.next('register');
    }
}
