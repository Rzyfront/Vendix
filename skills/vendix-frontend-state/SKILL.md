---
name: vendix-frontend-state
description: >
  Vendix frontend state patterns: NgRx facades with signal parallels, toSignal with
  initialValue, local signal state, takeUntilDestroyed, and pragmatic service-level cache/state.
  Trigger: When managing state.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "Managing State"
---

# Vendix Frontend State

## Source of Truth

- NgRx facades under `apps/frontend/src/app/core/store/**`
- Local services under feature modules
- `vendix-zoneless-signals` for critical Angular 20 rules

## Current Pattern

Vendix uses a hybrid state model:

- NgRx for global/shared state.
- Facades exposing observables and signal parallels via `toSignal(..., { initialValue })`.
- Local `signal()` state for component/service UI state.
- RxJS for HTTP/effects/async flows.

Legacy `BehaviorSubject + destroy$ + ngOnDestroy` service templates are not the primary pattern anymore.

## Rules

- Prefer facade signals for synchronous component reads.
- When bridging observables to signals, always provide `initialValue` where required.
- Use `takeUntilDestroyed()` in components/directives instead of ad-hoc `destroy$` subjects when subscribing imperatively.
- Keep HTTP side effects and store dispatches in facades/services, not templates.
- Use ToastService for user feedback, but do not couple every service method to a mandatory toast pattern.

## Mutations From Modals In NgRx-Backed Modules

If a module owns `state/actions/*.actions.ts`, **every** mutation goes through an
action. Calling the HTTP service from a component skips `action → effect → refresh`:
the POST succeeds but list and stats stay stale (QUI-554, store-users create modal).

### Contract

| Concern | Owner |
|---|---|
| Firing the mutation | The component, via `store.dispatch(createX({...}))` |
| HTTP call, success/error toast | The effect (`createX$`) |
| Reloading list + stats after **any** mutation | **One** effect (`mutationSuccess$`), never a component |
| Closing the modal | The component, on `ofType(createXSuccess)` |
| Keeping the form on failure | The component, by **not** listening to `createXFailure` |

```ts
// modal — dispatch, then wait for the outcome
private store = inject(Store);
private actions$ = inject(Actions);
readonly isSaving = this.store.selectSignal(selectEntitySaving);

constructor() {
  this.actions$
    .pipe(ofType(EntityActions.createEntitySuccess), takeUntilDestroyed(this.destroyRef))
    .subscribe(() => { this.resetForm(); this.isOpen.set(false); this.created.emit(); });
}

onSubmit(): void {
  if (this.form.invalid || this.isSaving()) return;
  this.store.dispatch(EntityActions.createEntity({ entity: this.form.value }));
}
```

```ts
// effects — the single refresh point
mutationSuccess$ = createEffect(() =>
  this.actions$.pipe(
    ofType(createEntitySuccess, updateEntitySuccess, deleteEntitySuccess),
    switchMap(() => [loadEntities(), loadStats()]),
  ),
);
```

### Rules

- **Never** dispatch `loadX`/`loadStats` from a component after a mutation. One refresh owner: the effect.
- **Never** close the modal in the same tick as the dispatch. Fire-and-forget destroys everything typed when the backend answers 400 (duplicate email, validation).
- Mutation progress is its own state flag (`entity_saving`), separate from the list-loading flag. Reusing `entities_loading` makes a save swap the table for the list spinner.
- Toast lives in the effect only. A toast in the component **and** in the effect double-fires.
- An `output()` declared but never emitted hides a missing refresh: emit it or delete it.
- Never declare `output()` named like a `model()`'s implicit `xChange` (see `vendix-frontend-modal`); close with `isOpen.set(false)`.

### Guard

`scripts/state-refresh-audit.sh` (CI job `state-refresh-audit`) fails when a
`*.component.ts` inside an NgRx-backed module calls
`this.<x>Service.create|update|delete<Xxx>(...)` and subscribes. It only fails on
files changed in the PR and reports pre-existing debt as a warning; `--all` runs
strict over the whole tree. Regression coverage lives in
`store-users.effects.spec.ts` and `store-user-create-modal.component.spec.ts`
(the modal spec asserts **zero** HTTP traffic via `HttpTestingController`).

## Related Skills

- `vendix-zoneless-signals`
- `vendix-frontend`
- `vendix-error-handling`
