import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

export interface WalletInfo {
  wallet_id: number;
  balance: number;
  held_balance: number;
  available: number;
  is_active: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PosWalletService {
  private readonly apiUrl = `${environment.apiUrl}/store/wallets`;

  constructor(private http: HttpClient) {}

  /**
   * Get wallet info for a customer. Returns null if customer has no wallet.
   * The backend auto-creates a wallet if one doesn't exist (getOrCreateWallet).
   */
  getCustomerWallet(customerId: number): Observable<WalletInfo | null> {
    return this.http.get<any>(`${this.apiUrl}/${customerId}`).pipe(
      map((response) => {
        const data = response.data || response;
        // Backend `WalletService.getBalance` returns { wallet_id, balance, held_balance, available }.
        // Guard on `wallet_id` (NOT `id`) — the field is `wallet_id` in the response shape.
        if (!data || !data.wallet_id) return null;
        return {
          wallet_id: data.wallet_id,
          balance: Number(data.balance || 0),
          held_balance: Number(data.held_balance || 0),
          available: Number(data.balance || 0) - Number(data.held_balance || 0),
          // Backend doesn't currently expose `is_active`; default to true so a missing
          // field doesn't silently disable an otherwise usable wallet.
          is_active: data.is_active !== false,
        };
      }),
      catchError(() => of(null)),
    );
  }
}
