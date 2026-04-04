import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, takeWhile, map, timer, retry, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';

const WOMPI_WIDGET_SCRIPT_URL = 'https://checkout.wompi.co/widget.js';

export enum WompiSubMethod {
  CARD = 'CARD',
  NEQUI = 'NEQUI',
  PSE = 'PSE',
  BANCOLOMBIA_TRANSFER = 'BANCOLOMBIA_TRANSFER',
  BANCOLOMBIA_COLLECT = 'BANCOLOMBIA_COLLECT',
}

export interface WompiSubMethodConfig {
  key: WompiSubMethod;
  label: string;
  icon: string;
  description: string;
  color: string;
  requiresForm: boolean;
}

export interface WompiPaymentStatusUpdate {
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  transactionId?: string;
  message?: string;
}

export interface PseFinancialInstitution {
  financial_institution_code: string;
  financial_institution_name: string;
}

@Injectable({ providedIn: 'root' })
export class WompiService {
  private scriptLoaded = false;
  private scriptLoading: Promise<void> | null = null;
  private readonly apiUrl = environment.apiUrl;

  static readonly SUB_METHODS: WompiSubMethodConfig[] = [
    {
      key: WompiSubMethod.NEQUI,
      label: 'Nequi',
      icon: 'smartphone',
      description: 'Pago desde la app de Nequi',
      color: '#E6007E',
      requiresForm: true,
    },
    {
      key: WompiSubMethod.PSE,
      label: 'PSE',
      icon: 'landmark',
      description: 'Transferencia bancaria',
      color: '#003DA5',
      requiresForm: true,
    },
    {
      key: WompiSubMethod.CARD,
      label: 'Tarjeta',
      icon: 'credit-card',
      description: 'Crédito o débito',
      color: '#1A9C8B',
      requiresForm: false,
    },
    {
      key: WompiSubMethod.BANCOLOMBIA_TRANSFER,
      label: 'Bancolombia',
      icon: 'building-2',
      description: 'Transferencia Bancolombia',
      color: '#FDDA24',
      requiresForm: false,
    },
  ];

  constructor(private readonly http: HttpClient) {}

  isWompiMethod(method: any): boolean {
    const type =
      method?.type ||
      method?.system_payment_method?.type ||
      method?.original?.system_payment_method?.type;
    return type === 'wompi';
  }

  getSubMethods(): WompiSubMethodConfig[] {
    return WompiService.SUB_METHODS;
  }

  getPseFinancialInstitutions(): Observable<PseFinancialInstitution[]> {
    return this.http
      .get<{ data: PseFinancialInstitution[] }>(
        `${this.apiUrl}/store/payments/wompi/financial-institutions`,
      )
      .pipe(map((res) => res.data));
  }

  pollPaymentStatus(
    paymentId: string | number,
  ): Observable<WompiPaymentStatusUpdate> {
    let pollCount = 0;
    const maxPolls = 60; // 5 minutes max

    return timer(0, 3000).pipe(
      takeWhile(() => pollCount < maxPolls),
      switchMap(() => {
        pollCount++;
        return this.http.get<any>(
          `${this.apiUrl}/store/payments/${paymentId}/status`,
        );
      }),
      map((response) => {
        // Response shape: { success, data: { success, data: { status, transactionId, ... } } }
        const inner = response?.data?.data || response?.data || response;
        return {
          status: inner?.status || inner?.state || 'pending',
          transactionId: inner?.transactionId || inner?.transaction_id,
          message: inner?.message,
        };
      }),
      takeWhile(
        (update: WompiPaymentStatusUpdate) =>
          update.status === 'pending',
        true,
      ),
      retry({ count: 3, delay: 2000 }),
    );
  }

  /**
   * Dynamically loads the Wompi WidgetCheckout script.
   * Returns immediately if already loaded; deduplicates concurrent calls.
   */
  loadWidgetScript(): Promise<void> {
    if (this.scriptLoaded) {
      return Promise.resolve();
    }

    if (this.scriptLoading) {
      return this.scriptLoading;
    }

    this.scriptLoading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = WOMPI_WIDGET_SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        this.scriptLoaded = true;
        this.scriptLoading = null;
        resolve();
      };
      script.onerror = () => {
        this.scriptLoading = null;
        reject(new Error('Failed to load Wompi widget script'));
      };
      document.head.appendChild(script);
    });

    return this.scriptLoading;
  }
}
