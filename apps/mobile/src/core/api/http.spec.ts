/**
 * Unit tests for the http.ts API helpers, focused on the unwrap() contract
 * that prevents the `recent.map is not a function` style crash when the
 * backend returns a `{ success: false, ... }` envelope with no `data` key.
 *
 * Behavior contract being tested:
 *   - { success: true, data: T }            -> returns T
 *   - { success: false, message }           -> throws ApiError with `message`
 *   - { success: false, error }             -> throws ApiError with `error`
 *   - { success: false }                    -> throws ApiError with 'Request failed'
 *   - bare payload (no envelope)            -> returns as-is
 *   - { success: true } (no data)           -> returns the envelope (legacy)
 *   - apiDelete with null body              -> returns undefined (legacy)
 */

/// <reference types="jest" />

jest.mock('./client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import apiClient from './client';
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './http';
import { ApiError } from './errors';

const mockedApi = apiClient as jest.Mocked<typeof apiClient>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('apiGet', () => {
  it('returns the data payload on success envelope', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: [{ id: 1 }, { id: 2 }] },
    } as any);

    const result = await apiGet<Array<{ id: number }>>('/orders/recent');

    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(mockedApi.get).toHaveBeenCalledWith('/orders/recent');
  });

  it('throws ApiError with backend message when success is false', async () => {
    // This is the regression: previously apiGet returned the envelope as if it
    // were T, then the caller did `recent.map(...)` on `{ success:false, ... }`
    // and crashed with "recent.map is not a function".
    mockedApi.get.mockResolvedValue({
      data: { success: false, message: 'Forbidden' },
    } as any);

    await expect(apiGet('/orders/recent')).rejects.toThrow(ApiError);
    await expect(apiGet('/orders/recent')).rejects.toThrow('Forbidden');
  });

  it('falls back to `error` field when message is missing', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: false, error: 'INTERNAL_ERROR' },
    } as any);

    await expect(apiGet('/orders/recent')).rejects.toThrow('INTERNAL_ERROR');
  });

  it('uses default message when both message and error are missing', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: false },
    } as any);

    await expect(apiGet('/orders/recent')).rejects.toThrow('Request failed');
  });

  it('returns bare payload when there is no envelope', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [{ id: 1 }],
    } as any);

    const result = await apiGet<Array<{ id: number }>>('/orders/recent');

    expect(result).toEqual([{ id: 1 }]);
  });

  it('attaches the original body to ApiError for downstream inspection', async () => {
    const envelope = { success: false, message: 'Forbidden', statusCode: 403 };
    mockedApi.get.mockResolvedValueOnce({ data: envelope } as any);

    try {
      await apiGet('/orders/recent');
      fail('expected apiGet to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.message).toBe('Forbidden');
      expect(apiErr.body).toEqual(envelope);
      expect(apiErr.statusCode).toBe(403);
    }
  });

  it('appends query params when provided', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: [] },
    } as any);

    await apiGet('/orders', { page: 2, pageSize: 10, status: 'open' });

    expect(mockedApi.get).toHaveBeenCalledWith('/orders?page=2&pageSize=10&status=open');
  });

  it('drops empty/undefined params from the query string', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: [] },
    } as any);

    await apiGet('/orders', { page: 1, search: '', sortBy: undefined });

    expect(mockedApi.get).toHaveBeenCalledWith('/orders?page=1');
  });
});

describe('apiPost', () => {
  it('returns the data payload on success envelope', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 'new-1' } },
    } as any);

    const result = await apiPost<{ id: string }>('/users', { name: 'Alice' });

    expect(result).toEqual({ id: 'new-1' });
    expect(mockedApi.post).toHaveBeenCalledWith('/users', { name: 'Alice' });
  });

  it('throws ApiError when success is false', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { success: false, message: 'Email already taken' },
    } as any);

    await expect(apiPost('/users', { email: 'dup@example.com' })).rejects.toThrow(
      'Email already taken',
    );
  });
});

describe('apiPut', () => {
  it('returns the data payload on success envelope', async () => {
    mockedApi.put.mockResolvedValueOnce({
      data: { success: true, data: { id: '1', name: 'Updated' } },
    } as any);

    const result = await apiPut<{ id: string; name: string }>('/users/1', {
      name: 'Updated',
    });

    expect(result).toEqual({ id: '1', name: 'Updated' });
  });

  it('throws ApiError when success is false', async () => {
    mockedApi.put.mockResolvedValueOnce({
      data: { success: false, message: 'Validation failed' },
    } as any);

    await expect(apiPut('/users/1', {})).rejects.toThrow('Validation failed');
  });
});

describe('apiPatch', () => {
  it('returns the data payload on success envelope', async () => {
    mockedApi.patch.mockResolvedValueOnce({
      data: { success: true, data: { id: '1', active: false } },
    } as any);

    const result = await apiPatch<{ id: string; active: boolean }>('/users/1', {
      active: false,
    });

    expect(result).toEqual({ id: '1', active: false });
  });

  it('throws ApiError when success is false', async () => {
    mockedApi.patch.mockResolvedValueOnce({
      data: { success: false, message: 'Cannot deactivate last admin' },
    } as any);

    await expect(apiPatch('/users/1', { active: false })).rejects.toThrow(
      'Cannot deactivate last admin',
    );
  });
});

describe('apiDelete', () => {
  it('returns undefined for empty/null body (legacy semantics)', async () => {
    mockedApi.delete.mockResolvedValueOnce({ data: null } as any);

    const result = await apiDelete('/users/1');

    expect(result).toBeUndefined();
  });

  it('returns the data payload when the envelope has data', async () => {
    mockedApi.delete.mockResolvedValueOnce({
      data: { success: true, data: { deleted: true } },
    } as any);

    const result = await apiDelete<{ deleted: boolean }>('/users/1');

    expect(result).toEqual({ deleted: true });
  });

  it('throws ApiError when success is false', async () => {
    mockedApi.delete.mockResolvedValueOnce({
      data: { success: false, message: 'Cannot delete user with active orders' },
    } as any);

    await expect(apiDelete('/users/1')).rejects.toThrow(
      'Cannot delete user with active orders',
    );
  });
});
