import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { Store } from '../models/business.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class StoreService {
  private apiUrl = environment.apiUrl;

  private currentStore = new BehaviorSubject<Store | null>(null);
  public currentStore$ = this.currentStore.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Get store by subdomain or custom domain
   */
  getStoreByDomain(domain: string): Observable<Store> {
    return this.http.get<Store>(`${this.apiUrl}/api/public/domains/resolve/${domain}`);
  }

  /**
   * Get store by slug
   */
  getStoreBySlug(slug: string): Observable<Store> {
    return this.http.get<Store>(`${this.apiUrl}/api/stores/by-slug/${slug}`);
  }
  /**
   * Set current store
   */
  setCurrentStore(store: Store): void {
    this.currentStore.next(store);
    localStorage.setItem('vendix_current_store', JSON.stringify(store));
  }

  /**
   * Get current store
   */
  getCurrentStore(): Store | null {
    return this.currentStore.value;
  }

  /**
   * Load stored store from localStorage
   */
  loadStoredStore(): Store | null {
    const stored = localStorage.getItem('vendix_current_store');
    if (stored) {
      try {
        const store = JSON.parse(stored) as Store;
        this.currentStore.next(store);
        return store;
      } catch (error) {
        console.error('Error loading stored store:', error);
        localStorage.removeItem('vendix_current_store');
      }
    }
    return null;
  }

  /**
   * Clear current store
   */
  clearCurrentStore(): void {
    this.currentStore.next(null);
    localStorage.removeItem('vendix_current_store');
  }
}
