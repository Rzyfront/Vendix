# vendix-frontend-cache

Frontend caching pattern for stats/dashboard endpoints using RxJS `shareReplay` with TTL.

## Trigger

When implementing or modifying stats/dashboard endpoints in Angular services to reduce HTTP requests during navigation.

## Context

Stats and dashboard endpoints are frequently called when users navigate between modules. Without caching, every navigation triggers new HTTP requests even when data hasn't changed.

**Key insight:** In Angular with lazy loading and standalone components, service instances are recreated on navigation. Instance variables don't persist - use **static global cache**.

## Pattern

### Static Global Cache (for simple endpoints)

```typescript
import { tap, shareReplay } from 'rxjs/operators';

// Static cache outside class (persists across instances)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let statsCache: CacheEntry<Observable<ApiResponse<Stats>>> | null = null;

@Injectable({ providedIn: 'root' })
export class MyService {
  private readonly CACHE_TTL = 30000; // 30 seconds

  getStats(): Observable<ApiResponse<Stats>> {
    const now = Date.now();

    // Return cached if valid
    if (statsCache && (now - statsCache.lastFetch) < this.CACHE_TTL) {
      return statsCache.observable;
    }

    // Create new observable with cache
    const observable$ = this.http.get<ApiResponse<Stats>>(`${this.apiUrl}/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => {
          if (statsCache) {
            statsCache.lastFetch = Date.now();
          }
        }),
      );

    statsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  invalidateCache(): void {
    statsCache = null;
  }
}
```

### Map-Based Cache (for endpoints with entity IDs)

```typescript
// Map-based cache for multiple entities
const storeStatsCache = new Map<number, CacheEntry<Observable<StoreStats>>>();

getStats(storeId: number): Observable<StoreStats> {
  const now = Date.now();
  const cached = storeStatsCache.get(storeId);

  if (cached && (now - cached.lastFetch) < this.CACHE_TTL) {
    return cached.observable;
  }

  const observable$ = this.http.get<StoreStats>(`${this.apiUrl}/store/${storeId}/stats`)
    .pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        const entry = storeStatsCache.get(storeId);
        if (entry) {
          entry.lastFetch = Date.now();
        }
      }),
    );

  storeStatsCache.set(storeId, {
    observable: observable$,
    lastFetch: now,
  });

  return observable$;
}

invalidateCache(storeId?: number): void {
  if (storeId) {
    storeStatsCache.delete(storeId);
  } else {
    storeStatsCache.clear();
  }
}
```

### Conditional Caching (with parameters)

```typescript
getStats(fromDate?: string, toDate?: string): Observable<Stats> {
  // Bypass cache with date parameters
  if (fromDate || toDate) {
    const params: any = {};
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;

    return this.http.get<Stats>(`${this.apiUrl}/stats`, { params });
  }

  // Use cache without parameters
  const now = Date.now();
  if (statsCache && (now - statsCache.lastFetch) < this.CACHE_TTL) {
    return statsCache.observable;
  }

  const observable$ = this.http.get<Stats>(`${this.apiUrl}/stats`)
    .pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        if (statsCache) {
          statsCache.lastFetch = Date.now();
        }
      }),
    );

  statsCache = { observable: observable$, lastFetch: now };
  return observable$;
}
```

## Key Points

### When to use cache:
- Dashboard general stats
- List of entities without filters
- Reference data (roles, currencies, etc.)

### When NOT to use cache:
- Entity-specific endpoints by ID (use Map instead)
- With date/filters parameters (bypass cache)
- Real-time data (logs, health metrics)
- Paginated lists

### Critical Settings:
- `refCount: false` - Keeps observable alive even without subscribers
- `bufferSize: 1` - Replay last value to new subscribers
- `CACHE_TTL = 30000` - 30 second expiration
- Static variables outside class - Persists across service instances

## Implemented Services

### Super-Admin (17 endpoints)
- Dashboard Service (6): getDashboardStats, getOrganizationsStats, getUsersStats, getStoresStats, getDomainsStats, getRolesStats
- Domains Service: getDomainStatsList
- Organizations Service: getOrganizationStatsList
- Stores Service: getStoreStatsList
- Users Service: getUsersStats (conditional)
- Roles Service: getRolesStats
- Audit Service: getAuditStats (conditional)
- Currencies Service: getCurrencyStats
- Shipping Service: getMethodStats, getZoneStats
- Payment Methods Service: getPaymentMethodsStats
- Templates Service: getTemplateStats
- Legal Documents Service: getAcceptanceStats (Map-based)

### Organization Module (4 endpoints)
- Dashboard Service: getDashboardStats (Map-based by orgId-period)
- Users Service: getUsersStats
- Audit Service: getAuditStats
- Stores Service: getOrganizationStoreStats

### Store Module (8 endpoints)
- Dashboard Service: getDashboardStats, getProductsStats (both Map-based)
- Orders Service: getOrderStats
- Products Service: getProductStats (Map-based)
- Inventory Service: getInventoryStats
- Customers Service: getStats (Map-based)
- Expenses Service: getExpensesSummary (conditional)

## Cache Invalidation

Call `invalidateCache()` after:
- Creating a new entity
- Editing an entity
- Deleting an entity

Example:
```typescript
createItem(data: CreateDto): Observable<Item> {
  return this.http.post<Item>(this.apiUrl, data).pipe(
    tap(() => this.invalidateCache())
  );
}
```
