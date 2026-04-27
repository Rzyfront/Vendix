import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface TenantState {
  organizationId: string | null;
  organizationName: string | null;
  storeId: string | null;
  storeName: string | null;
  setOrganizationId: (id: string | null) => void;
  setOrganizationName: (name: string | null) => void;
  setStoreId: (id: string | null) => void;
  setStoreName: (name: string | null) => void;
  clearTenant: () => void;
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      organizationId: null,
      organizationName: null,
      storeId: null,
      storeName: null,
      setOrganizationId: (id) => set({ organizationId: id }),
      setOrganizationName: (name) => set({ organizationName: name }),
      setStoreId: (id) => set({ storeId: id }),
      setStoreName: (name) => set({ storeName: name }),
      clearTenant: () =>
        set({
          organizationId: null,
          organizationName: null,
          storeId: null,
          storeName: null,
        }),
    }),
    {
      name: 'tenant-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
