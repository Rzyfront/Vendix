/**
 * @deprecated This module is obsolete as of the granular caching refactor.
 * State hydration is now handled directly by functions in `persistence.ts`.
 * Meta-reducers for persistence are no longer used.
 * This file is kept temporarily to resolve build errors and can be safely deleted soon.
 */

// Exporting empty objects to satisfy any remaining imports without causing errors.
export const STORE_PERSISTENCE_PROVIDER = {};
export const createTenantMetaReducers = () => {};
export const createAuthMetaReducers = () => {};