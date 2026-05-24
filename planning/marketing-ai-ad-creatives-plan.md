## Context

Vendix already has a STORE_ADMIN marketing area with promotions, coupons, and Social Sales, but it does not have a workspace for AI-generated promotional visuals. The requested module should let a store user list previous flyers/ads, select one or more products and product images, add creative instructions, stream generation progress where possible, persist the final generated image, and expose download/copy/share actions. Current AI Engine support is text/chat-stream oriented, so image generation needs a focused extension that still preserves provider configuration, subscription gating, logging, and S3 storage rules.

## General Objective

Create a STORE_ADMIN marketing submodule named Anuncios for AI-generated promotional visuals that streams image-generation progress and stores completed creative assets per store.

## Specific Objectives

1. Add store-scoped persistence for marketing ad creatives, their selected products, selected product images, generation status, final S3 image key, prompt metadata, AI usage metadata, and failure reason.
2. Extend the AI provider/engine layer with image generation and image stream support instead of bypassing the existing AI Engine.
3. Implement store marketing APIs to create/list/read/delete creatives and stream generation for a draft creative.
4. Store generated final images in S3 using store-scoped marketing paths and return fresh signed URLs on reads.
5. Add the Marketing > Anuncios frontend route, menu visibility keys, list view, creation flow, product/image picker, prompt fields, streaming preview, and completed image actions.
6. Verify Prisma scoping, permissions, streaming behavior, frontend zoneless compliance, and Docker watch-mode logs for affected services.

## Approach Chosen

Use a two-step creative flow: `POST /store/marketing/ad-creatives` creates a draft record with selected products/images and prompt fields, then `GET /store/marketing/ad-creatives/:id/generate-stream?token=...` streams generation over SSE, saves the final image to S3, and updates the record to `completed` or `failed`. This fits the existing EventSource pattern, avoids large prompt/image payloads in query params, keeps generation state recoverable, and lets the frontend show partial images/progress while the final asset is persisted.

## Alternatives Considered

- Direct frontend-to-OpenAI generation: rejected because it would expose provider credentials, bypass AI Engine logging/gating/quota, and skip S3 key persistence.
- Single long-running `POST` without stream: rejected because image generation can be slow and the user explicitly asked for streaming if possible.
- Generic `AIEngineService.runStream()` text stream only: rejected because the current provider interface streams Chat Completions text deltas, while image streaming needs Image API or Responses API image-generation events.
- Queue-only generation with polling: rejected for the first version because it gives weaker UX than SSE partials; it can be added later for background retries or offline generation.

## Critical Files

- `apps/backend/prisma/schema.prisma` — add marketing ad creative models/enums and relations to stores/products/product_images/users.
- `apps/backend/prisma/migrations/20260524000000_add_marketing_ad_creatives/migration.sql` — production-safe SQL migration for the new models, enums, FKs, and indexes.
- `apps/backend/src/prisma/services/store-prisma.service.ts` — register direct and relational scoped models for store-safe access.
- `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts` — add image request, response, and stream chunk contracts.
- `apps/backend/src/ai-engine/providers/openai-compatible.provider.ts` — implement OpenAI-compatible image generation and partial-image streaming.
- `apps/backend/src/ai-engine/ai-engine.service.ts` — add application-aware image generation methods with gate, rate-limit, logging, and quota behavior.
- `apps/backend/src/common/helpers/s3-path.helper.ts` — add marketing ad creative asset path builder.
- `apps/backend/src/common/config/image-presets.ts` — add a marketing creative image preset if slider/flyer dimensions need distinct optimization.
- `apps/backend/src/domains/store/marketing/ad-creatives/ad-creatives.module.ts` — register the backend module.
- `apps/backend/src/domains/store/marketing/ad-creatives/ad-creatives.controller.ts` — expose CRUD and generation stream endpoints.
- `apps/backend/src/domains/store/marketing/ad-creatives/ad-creatives.service.ts` — own draft creation, product/image validation, prompt assembly, streaming orchestration, S3 persistence, and signing.
- `apps/backend/src/domains/store/marketing/ad-creatives/dto/create-ad-creative.dto.ts` — validate selected products, image IDs, creative format, prompt, title, and description.
- `apps/backend/src/domains/store/store.module.ts` — import the new store marketing module.
- `apps/backend/prisma/seeds/permissions-roles.seed.ts` — add `store:marketing_ad_creatives:*` permissions and assign them to appropriate store roles.
- `apps/backend/prisma/seeds/default-templates.seed.ts` — add default `marketing_ad_creatives` panel key for new users.
- `apps/backend/src/common/services/default-panel-ui.service.ts` — add fallback `marketing_ad_creatives` panel visibility.
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` — add marketing ad creative default module visibility.
- `apps/frontend/src/app/routes/private/store_admin.routes.ts` — add lazy route under `/admin/marketing/anuncios`.
- `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts` — add Marketing sidebar child label `Anuncios`.
- `apps/frontend/src/app/core/services/menu-filter.service.ts` — map `Anuncios` to `marketing_ad_creatives`.
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts` — add the new marketing child to module visibility settings.
- `apps/frontend/src/app/core/services/breadcrumb.service.ts` — add breadcrumb metadata for the new route.
- `apps/frontend/src/app/private/modules/organization/users/components/user-config-modal.component.ts` — include the new panel key in user configuration defaults.
- `apps/frontend/src/app/shared/components/icon/icons.registry.ts` — register any missing Lucide icon used by the module.
- `apps/frontend/src/app/private/modules/store/marketing/ad-creatives/ad-creatives.routes.ts` — frontend route provider for the module.
- `apps/frontend/src/app/private/modules/store/marketing/ad-creatives/ad-creatives.component.ts` — list page with stats, search/filter, responsive cards/table, and create entry point.
- `apps/frontend/src/app/private/modules/store/marketing/ad-creatives/components/ad-creative-form-modal.component.ts` — creation form and product/image selector.
- `apps/frontend/src/app/private/modules/store/marketing/ad-creatives/components/ad-creative-generation-modal.component.ts` — streaming preview and completed image actions.
- `apps/frontend/src/app/private/modules/store/marketing/ad-creatives/services/ad-creatives.service.ts` — HTTP/EventSource integration for creatives and image stream events.
- `apps/frontend/src/app/private/modules/store/marketing/ad-creatives/interfaces/ad-creative.interface.ts` — frontend DTOs and stream event types.

## Reusable Assets

- `apps/backend/src/ai-engine/ai-engine.service.ts` — existing application lookup, prompt interpolation, rate-limit, subscription gate, logging, and quota patterns.
- `apps/backend/src/ai-engine/providers/openai-compatible.provider.ts` — current OpenAI SDK setup and provider config resolution to extend for images.
- `apps/backend/src/common/services/s3.service.ts` — base64/buffer image upload, WebP optimization, thumbnail generation, S3 signing, and S3 key safety helpers.
- `apps/backend/src/common/helpers/s3-path.helper.ts` — existing org/store path strategy for product, slider, logo, and other scoped assets.
- `apps/backend/src/domains/store/products/products.service.ts` — product image signing and S3-key handling patterns.
- `apps/backend/src/domains/store/promotions/promotions.controller.ts` — nearby marketing controller permission and response patterns.
- `apps/backend/src/domains/store/coupons/coupons.controller.ts` — nearby marketing CRUD response pattern.
- `apps/backend/src/domains/store/cash-registers/sessions/sessions.service.ts` — existing domain-specific SSE pattern that streams AI chunks and saves final output.
- `apps/frontend/src/app/core/services/ai-stream.service.ts` — current EventSource parsing and cleanup pattern.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-cash-register.service.ts` — module-specific EventSource wrapper pattern.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-ai-summary-modal.component.ts` — frontend loading/streaming/done/error state pattern.
- `apps/frontend/src/app/private/modules/store/marketing/promotions/promotions.component.ts` — nearby marketing module layout with stats and list composition.
- `apps/frontend/src/app/private/modules/store/marketing/coupons/coupons.component.ts` — responsive list/card pattern in the current marketing area.
- `apps/frontend/src/app/shared/components/index.ts` — reusable `StatsComponent`, `CardComponent`, `ResponsiveDataViewComponent`, `InputsearchComponent`, `ModalComponent`, `ButtonComponent`, `IconComponent`, `ImageLightboxComponent`, and form controls.
- `apps/frontend/src/app/private/modules/store/products/services/products.service.ts` — existing product list/detail/image API client used by the image selector.

## Steps

1. Add data model and Prisma scoping
   Skills: vendix-prisma-schema, vendix-prisma-migrations, vendix-prisma-scopes, vendix-s3-storage, vendix-naming-conventions
   Resources: `npm run db:migrate:dev -w apps/backend -- --name add_marketing_ad_creatives`, `npm run prisma:generate -w apps/backend`
   Business decision: Generated marketing visuals are store-owned assets; selected products/images must be tenant-scoped and final images must be persisted as S3 keys, not signed URLs.
   Why: Persistence and tenant scoping must exist before backend services can safely create or stream generated creatives.
   Output: New `marketing_ad_creatives`, `marketing_ad_creative_products`, and `marketing_ad_creative_images` persistence with safe store scoping, indexes, and Prisma client support.
   Verification: Inspect generated SQL at `apps/backend/prisma/migrations/20260524000000_add_marketing_ad_creatives/migration.sql`, run `npm run prisma:generate -w apps/backend`, and verify `StorePrismaService` registers the new models without `withoutScope()` request-handler access.

2. Extend AI Engine for image generation and image streaming
   Skills: vendix-ai-engine, vendix-ai-platform-core, vendix-ai-streaming, vendix-subscription-gate, vendix-redis-quota
   Resources: `https://developers.openai.com/api/docs/guides/image-generation`, `https://developers.openai.com/api/docs/guides/tools-image-generation`, `npm run test -w apps/backend -- --runInBand src/ai-engine/providers/openai-compatible.provider.spec.ts`
   Business decision: The module must use Vendix AI Engine configuration, logging, rate limits, and subscription gating rather than a domain-specific provider client.
   Why: Image generation depends on provider support and must be available before the marketing service can stream real generation events.
   Output: Provider contracts and OpenAI-compatible implementation for image generate/edit and stream chunks, plus `AIEngineService` methods for application-aware image generation.
   Verification: Backend provider tests mock OpenAI image stream events and assert emitted chunk shapes include progress, partial image, completed image, usage, and error paths.

3. Implement store marketing ad creative API and SSE generation flow
   Skills: vendix-backend, vendix-backend-api, vendix-backend-auth, vendix-permissions, vendix-ai-streaming, vendix-s3-storage, vendix-validation
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/store/marketing/ad-creatives/ad-creatives.service.spec.ts`
   Business decision: The frontend creates a draft record first, then starts a token-authenticated SSE stream for generation so EventSource can be used without sending large bodies in query strings.
   Why: This bridges frontend UX with backend-safe persistence, product-image validation, AI streaming, final S3 upload, and failure recovery.
   Output: Store endpoints to list/read/create/delete creatives and `GET /store/marketing/ad-creatives/:id/generate-stream?token=...` emitting progress, partial image, completed, and error events.
   Verification: Service tests cover cross-store product/image rejection, status transitions `draft -> processing -> completed/failed`, S3 key persistence, signed URL read responses, and SSE error completion.

4. Add permissions, panel visibility, and seed/default integration
   Skills: vendix-permissions, vendix-panel-ui, vendix-settings-system, vendix-prisma-seed
   Resources: `npm run db:seed -w apps/backend`
   Business decision: Sidebar visibility remains separate from backend authorization; users may see `Anuncios` only when `panel_ui.marketing_ad_creatives` is enabled and still need API permissions.
   Why: The module must appear consistently in the existing Marketing menu and be protected independently at the API layer.
   Output: `marketing_ad_creatives` panel key, sidebar/menu mapping, settings toggle, default templates, and `store:marketing_ad_creatives:*` permissions assigned to appropriate store roles.
   Verification: Seed dry run in dev with `npm run db:seed -w apps/backend`, then verify a role lacking the new permission receives 403 for `/api/store/marketing/ad-creatives`.

5. Build the Angular marketing ad creatives module
   Skills: vendix-frontend, vendix-frontend-routing, vendix-frontend-component, vendix-frontend-standard-module, vendix-frontend-data-display, vendix-angular-forms, vendix-zoneless-signals, vendix-frontend-icons, vendix-ui-ux
   Resources: `apps/frontend/scripts/zoneless-audit.sh`
   Business decision: STORE_ADMIN users need a mobile-first workspace that lists prior creatives, lets them select products/images, previews generation progress, and exposes final asset actions without a marketing landing page.
   Why: The frontend is the user-facing workflow and depends on backend contracts, route keys, and stream event shapes from earlier steps.
   Output: `/admin/marketing/anuncios` route with stats/list/empty states, create modal or wizard, product image selector, prompt/title/description fields, streaming generation modal, preview, copy/download/share actions, and error/retry states.
   Verification: Run `apps/frontend/scripts/zoneless-audit.sh` and manually verify the route renders on desktop and mobile widths without overlapping text or stale signal state.

6. Integrate and verify development runtime
   Skills: buildcheck-dev, vendix-ai-streaming, vendix-s3-storage
   Resources: `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend`, `docker logs --tail 40 vendix_postgres`, `docker ps`
   Business decision: The feature is complete only when the dev containers compile/run cleanly and the full create-stream-save-preview flow works in the local STORE_ADMIN app.
   Why: This catches TypeScript, Angular template, NestJS runtime, Prisma, and database errors after all cross-layer changes are integrated.
   Output: Verified local implementation with clean affected container logs and a documented manual UI path.
   Verification: Check Docker status with `docker ps`, inspect affected logs with the listed `docker logs --tail 40 ...` commands, and run the manual UI flow: create draft, start stream, see partial/progress state, receive completed image, refresh list, and open saved preview.

## End-to-End Verification

1. API contract check: create a draft via `curl -X POST http://localhost:3000/api/store/marketing/ad-creatives -H 'Authorization: Bearer $STORE_TOKEN' -H 'Content-Type: application/json' --data '{"title":"Promo de prueba","format":"square","product_ids":[1],"product_image_ids":[1],"prompt":"flyer promocional limpio"}'` and confirm a draft ID is returned.
2. Streaming check: open `http://localhost:3000/api/store/marketing/ad-creatives/$ID/generate-stream?token=$STORE_TOKEN` with EventSource from the UI and confirm events progress to `completed` or a controlled `error`.
3. Persistence check: refresh `/admin/marketing/anuncios`, confirm the completed creative appears with a signed preview URL, and confirm the database stores an S3 key rather than a signed URL.
4. Authorization check: repeat the list/create calls with a token missing `store:marketing_ad_creatives:read/create` and confirm 403.
5. Development runtime check: `docker ps`, `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend`, and `docker logs --tail 40 vendix_postgres` show no relevant errors after the implementation.

## Knowledge Gaps

- Vendix currently has AI text/chat streaming skills, but no dedicated skill for AI image generation/editing with persisted visual assets. After implementation stabilizes, propose a new skill such as `vendix-ai-image-generation` covering provider contracts, image stream events, S3 persistence, and frontend preview UX.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
