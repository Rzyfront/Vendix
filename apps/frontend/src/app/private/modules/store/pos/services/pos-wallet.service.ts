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
        if (!data || !data.id) return null;
        return {
          wallet_id: data.id,
          balance: Number(data.balance || 0),
          held_balance: Number(data.held_balance || 0),
          available: Number(data.balance || 0) - Number(data.held_balance || 0),
          is_active: data.is_active !== false,
        };
      }),
      catchError(() => of(null)),
    );
  }
}
