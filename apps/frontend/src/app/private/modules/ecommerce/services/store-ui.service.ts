import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class StoreUiService {
    private open_auth_modal_subject = new Subject<'login' | 'register'>();
    openAuthModal$ = this.open_auth_modal_subject.asObservable();

    openLoginModal(): void {
        this.open_auth_modal_subject.next('login');
    }

    openRegisterModal(): void {
        this.open_auth_modal_subject.next('register');
    }
}
