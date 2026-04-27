import { create } from 'zustand';

interface SubscriptionState {
  isActive: boolean;
  planName: string | null;
  features: Record<string, boolean>;
  setSubscription: (data: {
    isActive: boolean;
    planName: string | null;
    features: Record<string, boolean>;
  }) => void;
}

export const useConfigStore = create<SubscriptionState>((set) => ({
  isActive: false,
  planName: null,
  features: {},
  setSubscription: ({ isActive, planName, features }) =>
    set({ isActive, planName, features }),
}));
