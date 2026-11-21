import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { StoreMemoryList } from './store-memory.interface';
import { StoreMemoryComponent } from './store-memory.component';
import { StoreMemoryService } from './store-memory.service';

const EMPTY: StoreMemoryList = {
  items: [],
  limits: { max_entries: 40, max_chars: 2000, used_entries: 0, used_chars: 0 },
};

function render(roles: { owner?: boolean; admin?: boolean; names?: string[] }) {
  const api = { list: jasmine.createSpy('list').and.returnValue(of(EMPTY)) };
  TestBed.configureTestingModule({
    imports: [StoreMemoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: StoreMemoryService, useValue: api },
      {
        provide: AuthFacade,
        useValue: {
          isOwner: () => !!roles.owner,
          isAdmin: () => !!roles.admin,
          hasAnyRole: (wanted: string[]) =>
            (roles.names ?? []).some((name) => wanted.includes(name)),
        },
      },
      { provide: StoreSettingsFacade, useValue: { settings: signal(null) } },
      { provide: ToastService, useValue: { error: () => undefined, success: () => undefined } },
    ],
  });
  const fixture = TestBed.createComponent(StoreMemoryComponent);
  fixture.detectChanges();
  return { api, root: fixture.nativeElement as HTMLElement };
}

describe('StoreMemoryComponent role gate (H5)', () => {
  it('a cashier sees no memory block and the API is never called', () => {
    const { api, root } = render({ names: ['cashier'] });
    expect(root.textContent).not.toContain('Memoria de la tienda');
    expect(root.querySelector('section')).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('an owner sees the block and its count is loaded', () => {
    const { api, root } = render({ owner: true });
    expect(root.textContent).toContain('Memoria de la tienda');
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('an admin role name accepted by the page guard also sees the block', () => {
    const { root } = render({ names: ['admin'] });
    expect(root.textContent).toContain('Memoria de la tienda');
  });
});
