---
name: vendix-tour
description: >
  Interactive tour system for Vendix frontend: TourService state persistence, responsive
  tour modal, config-based steps, device-specific targets, and first-visit guidance flows.
  Trigger: When creating or modifying guided tours in frontend.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Creating or modifying guided tours in frontend"
---

# Vendix Tour

## Source of Truth

- `apps/frontend/src/app/shared/components/tour/services/tour.service.ts`
- `apps/frontend/src/app/shared/components/tour/tour-modal/tour-modal.component.ts`
- `apps/frontend/src/app/shared/components/tour/configs/*.config.ts`
- `apps/frontend/src/app/shared/components/tour/README.md`

## Current Architecture

- `TourService` stores active session state in a signal and exposes `state$` through `toObservable`.
- Persistent completed/skipped state is stored in `user_settings.config.tours` through `AuthFacade.updateUserSettings(...)`.
- `TourModalComponent` is standalone and uses:
  - `isOpen = model<boolean>(false)`
  - `tourConfig = input<TourConfig>(POS_TOUR_CONFIG)`
  - `completed = output<void>()`
  - `skipped = output<void>()`

## Config Model

Current tour configs use `TourConfig` and `TourStep` from the service, including:

- `target`
- `targetMobile`
- `targetDesktop`
- `autoAdvanceTarget`
- mobile/desktop auto-advance variants
- optional lifecycle hooks: `beforeShow`, `afterShow`, `beforeNext`

## Responsive Behavior

- Mobile tooltip is compact/minimizable.
- Desktop tooltip is larger and shows progress more prominently.
- Spotlight/tooltip positioning adapts to target geometry and device type.
- Device-specific selectors are supported and should be preferred when layout differs materially between mobile and desktop.

## Rules

- Use stable selectors, ideally `data-tour` attributes, for important targets.
- Keep configs in `shared/components/tour/configs/` when reusable across flows.
- Use `TourService.canShowTour(tourId)` before opening a first-visit tour.
- Persist completed/skipped state through the service; do not duplicate local storage logic in feature components.
- Follow zoneless/signal patterns when integrating tour visibility into pages.

## Integration Pattern

- Feature component owns the local open signal/model.
- Tour config is passed into `app-tour-modal`.
- `completed` and `skipped` outputs can close the wrapper state or trigger follow-up UI.

## Related Skills

- `vendix-zoneless-signals`
- `vendix-frontend-component`
- `vendix-ui-ux`
