/**
 * vendix.workflow/v1 contract barrel.
 *
 * This folder is copied byte for byte into three places (no executable shared
 * package between Nest and Angular). Parity is enforced by
 * apps/backend/src/common/workflows/contract/workflow-contract.parity.spec.ts
 *   - libs/shared-types/workflows/                       (canonical)
 *   - apps/backend/src/common/workflows/contract/
 *   - apps/frontend/src/app/shared/workflows/contract/
 * Edit the canonical copy and `cp` it to the other two.
 */
export * from './workflow-contract';
export * from './workflow-validator';
export * from './workflow-runtime';
