import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import type { AxiosRequestConfig } from 'axios';

interface UseApiQueryOptions {
  queryKey?: string[];
  enabled?: boolean;
  staleTime?: number;
}

export function useApiQuery<TData = unknown>(
  endpoint: string,
  options: UseApiQueryOptions = {},
) {
  const { queryKey = [endpoint], enabled = true, staleTime } = options;
  return useQuery<TData>({
    queryKey,
    queryFn: () => apiClient.get<TData>(endpoint).then((res) => res.data),
    enabled,
    staleTime,
  });
}

interface UseApiMutationOptions {
  invalidateKeys?: (string | readonly unknown[])[];
  onSuccess?: (data: unknown) => void;
}

export function useApiMutation<TData = unknown, TVariables = unknown>(
  endpoint: string,
  method: 'post' | 'put' | 'patch' | 'delete' = 'post',
  options: UseApiMutationOptions = {},
) {
  const { invalidateKeys = [[endpoint]], onSuccess } = options;
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TVariables>({
    mutationFn: (data) => {
      if (method === 'delete') {
        return apiClient.delete<TData>(endpoint, { data }).then((r) => r.data);
      }
      return apiClient.request<TData>({ url: endpoint, method, data }).then((r) => r.data);
    },
    onSuccess: (data) => {
      invalidateKeys.forEach((key) => {
        const qk = typeof key === 'string' ? [key] : key;
        queryClient.invalidateQueries({ queryKey: qk as readonly unknown[] });
      });
      onSuccess?.(data);
    },
  });
}
