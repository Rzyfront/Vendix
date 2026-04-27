import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api';
import type { AxiosRequestConfig } from 'axios';

interface UseApiOptions {
  queryKey?: string[];
  enabled?: boolean;
}

export function useApiQuery<TData = unknown>(
  endpoint: string,
  options: UseApiOptions<TData> = {}
) {
  const { queryKey = [endpoint], enabled = true } = options;
  return useQuery<TData>({
    queryKey,
    queryFn: () => apiClient.get<TData>(endpoint).then((res) => res.data),
    enabled,
  });
}

export function useApiMutation<TData = unknown, TVariables = unknown>(
  endpoint: string,
  method: 'post' | 'put' | 'patch' | 'delete' = 'post',
  options: UseApiOptions<TData> = {}
) {
  const { queryKey = [endpoint] } = options;
  const queryClient = useQueryClient();
  return useMutation<TData, TError, TVariables>({
    mutationFn: (data) => {
      const config: AxiosRequestConfig = {};
      if (method === 'delete') {
        return apiClient.delete<TData>(endpoint, config);
      }
      return apiClient.request<TData>({
        url: endpoint,
        method,
        data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
