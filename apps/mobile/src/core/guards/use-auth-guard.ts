import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/auth.store';

export function useAuthGuard(redirectTo = '/(auth)/login') {
  const { isAuthenticated, isLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(redirectTo);
    }
  }, [isAuthenticated, isLoading, redirectTo, router]);
}
