/**
 * Thin wrapper around the shared `UserSelectComponent` (`app-user-select`).
 *
 * The picker was generalized in plan §B.3: the new shared component lives at
 * `apps/frontend/src/app/shared/components/user-select/` and exposes a
 * `scope: 'org' | 'global'` input. The org consumer (store-create-modal,
 * settings forms, etc.) historically used the org-only path, so we keep this
 * barrel as a stable import surface (`import { UserSelectComponent } from
 * '../user-select/user-select.component'`) and forward everything to the
 * shared class. The shared component already defaults to `scope: 'org'`,
 * which is the behaviour every existing consumer relies on.
 *
 * Do NOT add org-only fields here — extend the shared component instead so
 * the global super-admin variant keeps parity.
 */

export { UserSelectComponent } from '../../../../../../shared/components/user-select/user-select.component';