import { Injectable } from '@angular/core';
import { Observable, of, BehaviorSubject, fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';

export interface OfflineData {
  products: any[];
  customers: any[];
  orders: any[];
  settings: any;
  lastSync: Date;
}

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'product' | 'customer' | 'order';
  data: any;
  timestamp: Date;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
  retryCount: number;
}

export interface OfflineStatus {
  isOnline: boolean;
  lastSync: Date | null;
  pendingOperations: number;
  storageUsed: number;
  storageQuota: number;
}

@Injectable({
  providedIn: 'root',
})
export class PosOfflineService {
  private readonly STORAGE_KEY = 'pos_offline_data';
  private readonly SYNC_QUEUE_KEY = 'pos_sync_queue';
  private readonly SETTINGS_KEY = 'pos_offline_settings';

  private isOnlineSubject = new BehaviorSubject<boolean>(navigator.onLine);
  private syncQueueSubject = new BehaviorSubject<SyncOperation[]>([]);

  public isOnline$ = this.isOnlineSubject.asObservable();
  public syncQueue$ = this.syncQueueSubject.asObservable();

  constructor() {
    this.initializeOfflineMode();
    this.setupNetworkListeners();
  }

  private initializeOfflineMode(): void {
    if (this.isLocalStorageAvailable()) {
      this.loadSyncQueue();
    }
  }

  private setupNetworkListeners(): void {
    fromEvent(window, 'online').subscribe(() => {
      this.isOnlineSubject.next(true);
      this.attemptSync();
    });

    fromEvent(window, 'offline').subscribe(() => {
      this.isOnlineSubject.next(false);
    });
  }

  getOfflineStatus(): Observable<OfflineStatus> {
    return of(this.calculateOfflineStatus());
  }

  private calculateOfflineStatus(): OfflineStatus {
    const syncQueue = this.getSyncQueue();
    const storageUsed = this.getStorageUsage();
    const storageQuota = this.getStorageQuota();

    return {
      isOnline: navigator.onLine,
      lastSync: this.getLastSyncTime(),
      pendingOperations: syncQueue.filter((op) => op.status === 'pending')
        .length,
      storageUsed,
      storageQuota,
    };
  }

  saveOfflineData(data: Partial<OfflineData>): Observable<boolean> {
    return of(data).pipe(
      map(() => {
        if (!this.isLocalStorageAvailable()) {
          console.warn('LocalStorage no disponible');
          return false;
        }

        try {
          const currentData = this.getOfflineData();
          const updatedData = { ...currentData, ...data, lastSync: new Date() };
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedData));
          return true;
        } catch (error) {
          console.error('Error guardando datos offline:', error);
          return false;
        }
      }),
    );
  }

  getOfflineData(): OfflineData {
    if (!this.isLocalStorageAvailable()) {
      return this.getDefaultOfflineData();
    }

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : this.getDefaultOfflineData();
    } catch (error) {
      console.error('Error cargando datos offline:', error);
      return this.getDefaultOfflineData();
    }
  }

  private getDefaultOfflineData(): OfflineData {
    return {
      products: [],
      customers: [],
      orders: [],
      settings: {},
      lastSync: new Date(),
    };
  }

  addToSyncQueue(
    operation: Omit<
      SyncOperation,
      'id' | 'timestamp' | 'status' | 'retryCount'
    >,
  ): Observable<string> {
    return of(operation).pipe(
      map(() => {
        const syncOperation: SyncOperation = {
          ...operation,
          id: this.generateOperationId(),
          timestamp: new Date(),
          status: 'pending',
          retryCount: 0,
        };

        const queue = this.getSyncQueue();
        queue.push(syncOperation);
        this.saveSyncQueue(queue);

        return syncOperation.id;
      }),
    );
  }

  private getSyncQueue(): SyncOperation[] {
    if (!this.isLocalStorageAvailable()) {
      return [];
    }

    try {
      const stored = localStorage.getItem(this.SYNC_QUEUE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error cargando cola de sincronización:', error);
      return [];
    }
  }

  private saveSyncQueue(queue: SyncOperation[]): void {
    if (this.isLocalStorageAvailable()) {
      try {
        localStorage.setItem(this.SYNC_QUEUE_KEY, JSON.stringify(queue));
        this.syncQueueSubject.next(queue);
      } catch (error) {
        console.error('Error guardando cola de sincronización:', error);
      }
    }
  }

  private loadSyncQueue(): void {
    const queue = this.getSyncQueue();
    this.syncQueueSubject.next(queue);
  }

  attemptSync(): Observable<boolean> {
    if (!navigator.onLine) {
      return of(false);
    }

    return of(true).pipe(
      map(() => {
        const queue = this.getSyncQueue();
        const pendingOperations = queue.filter((op) => op.status === 'pending');

        if (pendingOperations.length === 0) {
          return true;
        }

        this.processSyncQueue(pendingOperations);
        return true;
      }),
    );
  }

  private processSyncQueue(operations: SyncOperation[]): void {
    operations.forEach((operation) => {
      this.syncOperation(operation);
    });
  }

  private async syncOperation(operation: SyncOperation): Promise<void> {
    try {
      operation.status = 'syncing';
      this.updateSyncQueue();

      await this.performSync(operation);

      operation.status = 'completed';
      this.updateSyncQueue();
    } catch (error) {
      console.error(`Error sincronizando operación ${operation.id}:`, error);

      operation.retryCount++;
      if (operation.retryCount >= 3) {
        operation.status = 'failed';
      } else {
        operation.status = 'pending';
      }

      this.updateSyncQueue();
    }
  }

  private async performSync(operation: SyncOperation): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(
        () => {
          if (Math.random() > 0.1) {
            resolve();
          } else {
            reject(new Error('Error de sincronización simulado'));
          }
        },
        1000 + Math.random() * 2000,
      );
    });
  }

  private updateSyncQueue(): void {
    const queue = this.getSyncQueue();
    this.saveSyncQueue(queue);
  }

  clearSyncQueue(): Observable<boolean> {
    return of(true).pipe(
      map(() => {
        if (this.isLocalStorageAvailable()) {
          localStorage.removeItem(this.SYNC_QUEUE_KEY);
          this.syncQueueSubject.next([]);
        }
        return true;
      }),
    );
  }

  retryFailedOperations(): Observable<boolean> {
    return of(true).pipe(
      map(() => {
        const queue = this.getSyncQueue();
        const failedOperations = queue.filter((op) => op.status === 'failed');

        failedOperations.forEach((operation) => {
          operation.status = 'pending';
          operation.retryCount = 0;
        });

        this.saveSyncQueue(queue);
        this.attemptSync();

        return true;
      }),
    );
  }

  private getLastSyncTime(): Date | null {
    const data = this.getOfflineData();
    return data.lastSync || null;
  }

  private getStorageUsage(): number {
    if (!this.isLocalStorageAvailable()) {
      return 0;
    }

    let total = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length + key.length;
      }
    }
    return total;
  }

  private getStorageQuota(): number {
    return 5 * 1024 * 1024;
  }

  private isLocalStorageAvailable(): boolean {
    try {
      const test = '__localStorage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  private generateOperationId(): string {
    return 'sync_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
  }

  clearOfflineData(): Observable<boolean> {
    return of(true).pipe(
      map(() => {
        if (this.isLocalStorageAvailable()) {
          localStorage.removeItem(this.STORAGE_KEY);
          localStorage.removeItem(this.SYNC_QUEUE_KEY);
          localStorage.removeItem(this.SETTINGS_KEY);
          this.syncQueueSubject.next([]);
        }
        return true;
      }),
    );
  }

  exportOfflineData(): Observable<string | null> {
    return of(this.getOfflineData()).pipe(
      map((data) => {
        try {
          return JSON.stringify(data, null, 2);
        } catch (error) {
          console.error('Error exportando datos offline:', error);
          return null;
        }
      }),
    );
  }

  importOfflineData(jsonData: string): Observable<boolean> {
    return of(jsonData).pipe(
      map((data) => {
        try {
          const parsedData = JSON.parse(data);
          const result = this.saveOfflineData(parsedData);
          return result instanceof Observable ? false : result;
        } catch (error) {
          console.error('Error importando datos offline:', error);
          return false;
        }
      }),
    );
  }

  getOfflineSettings(): Observable<any> {
    return of(this.getSettings());
  }

  private getSettings(): any {
    if (!this.isLocalStorageAvailable()) {
      return {};
    }

    try {
      const stored = localStorage.getItem(this.SETTINGS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Error cargando configuración offline:', error);
      return {};
    }
  }

  saveOfflineSettings(settings: any): Observable<boolean> {
    return of(settings).pipe(
      map(() => {
        if (this.isLocalStorageAvailable()) {
          try {
            localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
            return true;
          } catch (error) {
            console.error('Error guardando configuración offline:', error);
            return false;
          }
        }
        return false;
      }),
    );
  }
}
