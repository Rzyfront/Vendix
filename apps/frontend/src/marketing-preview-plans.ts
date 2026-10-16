import type { PublicPlansResponse } from './app/public/pricing/services/public-plans.service';

/** Resolve before bootstrap: a failed API must reject the build, not invoke the landing fallback. */
export async function loadMarketingPreviewPlans(
  apiUrl: string,
  request: typeof fetch = fetch,
): Promise<PublicPlansResponse> {
  const response = await request(`${apiUrl}/public/plans`, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Marketing preview: public plans request failed');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' ||
      !('success' in payload) || payload.success !== true ||
      !('data' in payload) || !Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error('Marketing preview: public plans response is empty or invalid');
  }
  // Every record must be an object before the real component normalizes its public fields.
  if (payload.data.some((plan: unknown) => !plan || typeof plan !== 'object' || Array.isArray(plan))) {
    throw new Error('Marketing preview: invalid public plan record');
  }
  return payload as PublicPlansResponse;
}
