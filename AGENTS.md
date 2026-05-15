# Vendix AI Agent Skills System

> **Single Source of Truth** - This file is the master for all AI assistants.
> Run `./skills/setup.sh --sync` to synchronize skills to provider-specific locations.

This repository provides AI agent skills for working with Vendix.
Skills provide on-demand context and patterns for this codebase.

### Auto-invoke Skills

When performing these actions, ALWAYS invoke the corresponding skill FIRST:

| Action | Skill |
|--------|-------|
| -- | `agent-teams` |
| -- | `buildcheck-dev` |
| -- | `git-workflow` |
| -- | `how-to-dev` |
| -- | `how-to-plan` |
| -- | `vendix-ai-agent-tools` |
| -- | `vendix-ai-chat` |
| -- | `vendix-ai-embeddings-rag` |
| -- | `vendix-ai-engine` |
| -- | `vendix-ai-platform-core` |
| -- | `vendix-ai-queue` |
| -- | `vendix-ai-streaming` |
| -- | `vendix-angular-forms` |
| -- | `vendix-app-architecture` |
| -- | `vendix-auto-entries` |
| -- | `vendix-backend-auth` |
| -- | `vendix-business-analysis` |
| -- | `vendix-core` |
| -- | `vendix-currency-formatting` |
| -- | `vendix-customer-auth` |
| -- | `vendix-date-timezone` |
| -- | `vendix-frontend` |
| -- | `vendix-frontend-routing` |
| -- | `vendix-inventory-stock` |
| -- | `vendix-mcp-server` |
| -- | `vendix-monorepo-workspaces` |
| -- | `vendix-multi-tenant-context` |
| -- | `vendix-naming-conventions` |
| -- | `vendix-notifications-system` |
| -- | `vendix-panel-ui` |
| -- | `vendix-permissions` |
| -- | `vendix-prisma-scopes` |
| -- | `vendix-redis-quota` |
| -- | `vendix-saas-billing` |
| -- | `vendix-settings-system` |
| -- | `vendix-subscription-gate` |
| -- | `vendix-zoneless-signals` |
| Accruing partner commissions or running partner payout batches | `vendix-saas-billing` |
| Adding MCP resources or tools | `vendix-mcp-server` |
| Adding a monthly or daily Redis quota counter | `vendix-redis-quota` |
| Adding a new AI provider | `vendix-ai-platform-core` |
| Adding backend permissions | `vendix-permissions` |
| Adding chat features | `vendix-ai-chat` |
| Adding feature gates or paywalls backed by subscription state | `vendix-subscription-gate` |
| Adding frontend routes | `vendix-frontend-routing` |
| Adding modules or submodules to the sidebar | `vendix-panel-ui` |
| Adding money inputs to forms | `vendix-currency-formatting` |
| Adding new AI applications | `vendix-ai-engine` |
| Adding new DateTime fields to Prisma schema | `vendix-date-timezone` |
| Adding new automatic journal entries | `vendix-auto-entries` |
| Adding new entity types to embeddings | `vendix-ai-embeddings-rag` |
| Adding new mapping keys to accounting | `vendix-auto-entries` |
| Adding new menu items to admin layouts | `vendix-panel-ui` |
| Adding new models to domain scopes | `vendix-prisma-scopes` |
| Adding new payment processors, modifying payment gateway logic, working with payment webhooks | `vendix-payment-processors` |
| Adding new settings sections to stores or organizations | `vendix-settings-system` |
| Adding or modifying notification types | `vendix-notifications-system` |
| Adding tool-use to AI features | `vendix-ai-agent-tools` |
| Adding/removing workspaces | `vendix-monorepo-workspaces` |
| After creating/modifying a skill | `skill-sync` |
| Allocating invoice numbers with advisory locks | `vendix-saas-billing` |
| Applying @RequireAIFeature decorator + AiAccessGuard to controllers | `vendix-subscription-gate` |
| Applying @SkipSubscriptionGate to bypass StoreOperationsGuard on a handler/controller | `vendix-subscription-gate` |
| Auditing Zoneless compliance (zoneless-audit.sh) or enforcing CI grep rules | `vendix-zoneless-signals` |
| Binding form controls in Angular templates | `vendix-angular-forms` |
| Business analysis for changes that directly affect the app economic activity | `vendix-business-analysis` |
| Caching frontend HTTP/dashboard/report data | `vendix-frontend-cache` |
| Changing COGS, CPP, FIFO, inventory_cost_layers, or inventory valuation snapshots | `vendix-inventory-valuation` |
| Changing fiscal scope behavior | `vendix-fiscal-scope` |
| Changing onboarding account_type behavior | `vendix-operating-scope` |
| Checking Docker development logs after code changes | `buildcheck-dev` |
| Checking production resource locations, IPs, distributions, buckets, ECR, RDS, Route53, or Secrets Manager metadata | `vendix-cloud-operations` |
| Choosing between viable architectural approaches | `how-to-plan` |
| Code changes, feature work, fixes, refactors, or development execution | `how-to-dev` |
| Complex plans requiring delegated agent work | `agent-teams` |
| Computing partner margin, fixed surcharge, or effective price | `vendix-saas-billing` |
| Configuring AI providers or applications | `vendix-ai-engine` |
| Configuring AI providers or applications | `vendix-ai-platform-core` |
| Configuring AI rate limiting | `vendix-ai-platform-core` |
| Configuring CI/CD | `vendix-monorepo-workspaces` |
| Configuring MCP authentication | `vendix-mcp-server` |
| Configuring middleware | `vendix-backend-middleware` |
| Configuring panel_ui visibility | `vendix-panel-ui` |
| Consulting or updating keys/README.md production runbook | `vendix-cloud-operations` |
| Creating AI queue processors | `vendix-ai-queue` |
| Creating AI-powered features | `vendix-ai-engine` |
| Creating API endpoints | `vendix-backend-api` |
| Creating API tests (Bruno) | `vendix-bruno-test` |
| Creating Angular Forms | `vendix-angular-forms` |
| Creating Angular components | `vendix-frontend-component` |
| Creating Dockerfiles | `vendix-monorepo-workspaces` |
| Creating Frontend Modules | `vendix-frontend-module` |
| Creating SaaS subscription invoices or rev-share splits | `vendix-saas-billing` |
| Creating Seeds | `vendix-prisma-seed` |
| Creating a new skill | `skill-creator` |
| Creating auth modal components | `vendix-customer-auth` |
| Creating date inputs in forms | `vendix-date-timezone` |
| Creating files, classes, interfaces, enums, or routes | `vendix-naming-conventions` |
| Creating implementation plans or decomposing non-trivial work | `how-to-plan` |
| Creating lazy-loaded frontend routes | `vendix-frontend-routing` |
| Creating migrations, editing migration SQL, deploying migrations to production, recovering from P3009, failed migration recovery, ALTER TYPE ADD VALUE, checksum mismatch, modified migration after apply | `vendix-prisma-migrations` |
| Creating new AI tools | `vendix-ai-agent-tools` |
| Creating or editing product variants | `vendix-product-variants` |
| Creating or editing service variants | `vendix-product-variants` |
| Creating or modifying guided tours in frontend | `vendix-tour` |
| Creating or modifying modals in frontend | `vendix-frontend-modal` |
| Creating or refactoring standard admin modules (stats + table) | `vendix-frontend-standard-module` |
| Creating streaming UI components | `vendix-ai-streaming` |
| Customer registration flow | `vendix-customer-auth` |
| Debugging AI job failures | `vendix-ai-queue` |
| Debugging AI request failures | `vendix-ai-platform-core` |
| Debugging Forbidden errors in Prisma queries | `vendix-prisma-scopes` |
| Debugging Prisma WhereUnique/AND errors in scoped queries | `vendix-prisma-scopes` |
| Debugging agent loop issues | `vendix-ai-agent-tools` |
| Debugging embedding generation | `vendix-ai-embeddings-rag` |
| Debugging free-plan invoices, pending credits, or proration flows | `vendix-saas-billing` |
| Debugging missing accounting entries | `vendix-auto-entries` |
| Debugging over-quota bypass or double-count on provider retries | `vendix-redis-quota` |
| Debugging stale templates, missing re-renders, or change detection issues | `vendix-zoneless-signals` |
| Deciding which Vendix skill owns a pattern | `vendix-core` |
| Decisive business-rule analysis before planning revenue, billing, subscriptions, pricing, commissions, checkout, inventory, accounting, or payments changes | `vendix-business-analysis` |
| Declaring MCP servers, CLI commands, or web research alongside skills in a plan | `how-to-plan` |
| Designing UI screens, mobile-first layouts, accessibility review, landing pages, UX patterns | `vendix-ui-ux` |
| Discovering reusable assets before proposing new code | `how-to-plan` |
| Displaying data lists, implementing responsive tables, creating mobile card views | `vendix-frontend-data-display` |
| Displaying or formatting dates in frontend | `vendix-date-timezone` |
| Displaying or formatting money/currency values | `vendix-currency-formatting` |
| Distinguishing panel_ui visibility from backend authorization | `vendix-permissions` |
| EC2 maintenance, deployment disk issues, or Docker layer/pull failures | `vendix-ec2-maintenance` |
| Editing @Permissions decorators | `vendix-permissions` |
| Editing Schema | `vendix-prisma-schema` |
| Editing files in apps/backend/, creating modules, or working with Prisma | `vendix-backend` |
| Editing or creating any Angular component under apps/frontend (Zoneless patterns apply) | `vendix-zoneless-signals` |
| Editing or creating frontend web code | `vendix-frontend` |
| Exposing Vendix data to AI clients | `vendix-mcp-server` |
| Fixing Forbidden/403 errors in scoped services | `vendix-multi-tenant-context` |
| Fixing bugs where variants are hidden or blocked because stock_quantity is zero | `vendix-product-variants` |
| Fixing currency display issues or hardcoded $ symbols | `vendix-currency-formatting` |
| Fixing date display off-by-one bugs | `vendix-date-timezone` |
| Fixing signal-used-without-invoking bugs (!this.flag vs !this.flag()) | `vendix-zoneless-signals` |
| Formatting chart axis labels with dates | `vendix-date-timezone` |
| General Development | `how-to-dev` |
| Handling Errors | `vendix-error-handling` |
| Handling store context | `vendix-multi-tenant-context` |
| Implementing AI streaming | `vendix-ai-streaming` |
| Implementing ControlValueAccessor (CVA) in custom form components | `vendix-zoneless-signals` |
| Implementing ControlValueAccessor in frontend components | `vendix-angular-forms` |
| Implementing authentication | `vendix-backend-auth` |
| Implementing customer auth in e-commerce | `vendix-customer-auth` |
| Implementing ecommerce checkout | `vendix-ecommerce-checkout` |
| Implementing feature caps with auto-reset at period rollover | `vendix-redis-quota` |
| Implementing historical inventory valuation | `vendix-inventory-valuation` |
| Implementing multi-tenant logic | `vendix-multi-tenant-context` |
| Implementing semantic search | `vendix-ai-embeddings-rag` |
| Implementing stats cards or dashboard metrics with mobile scroll | `vendix-frontend-stats-cards` |
| Implementing sticky headers or refactoring module headers | `vendix-frontend-sticky-header` |
| Installing dependencies | `vendix-monorepo-workspaces` |
| Integrating AI Engine into a domain | `vendix-ai-engine` |
| Invalidating the sub:features:{storeId} Redis cache | `vendix-subscription-gate` |
| Managing Routes | `vendix-frontend-routing` |
| Managing State | `vendix-frontend-state` |
| Mapping store_subscription_state_enum to allow/warn/block | `vendix-subscription-gate` |
| Migrating legacy Angular patterns (BehaviorSubject, take(1).subscribe) to Signals | `vendix-zoneless-signals` |
| Modifying StockLevelManager service | `vendix-inventory-stock` |
| Modifying auto-entry event handlers | `vendix-auto-entries` |
| Modifying package.json | `vendix-monorepo-workspaces` |
| Modifying store_settings or organization_settings | `vendix-settings-system` |
| Modifying the AI chat widget | `vendix-ai-chat` |
| Parsing date strings from query parameters | `vendix-date-timezone` |
| Period-keyed counters YYYYMM / YYYYMMDD | `vendix-redis-quota` |
| Picking concrete verification mechanisms (Bruno, curl, build, audit, log inspection) per step | `how-to-plan` |
| Planning structural changes, multi-file changes, broad refactors, or new features | `how-to-plan` |
| Printing documents with date fields | `vendix-date-timezone` |
| Protecting backend endpoints with auth, roles, or permissions | `vendix-backend-auth` |
| Protecting store write operations behind a subscription | `vendix-subscription-gate` |
| Querying by date ranges in backend | `vendix-date-timezone` |
| Rate-limiting by calendar period (not sliding window) | `vendix-redis-quota` |
| Regenerate AGENTS.md Auto-invoke tables (sync.sh) | `skill-sync` |
| Reserving or releasing stock | `vendix-inventory-stock` |
| Resolving a knowledge gap by creating or updating a skill | `skill-creator` |
| Reusing INCR+EXPIRE pattern outside AI (uploads, emails, exports) | `vendix-redis-quota` |
| Reviewing or replacing NgZone, markForCheck, detectChanges, @Input, @Output, EventEmitter | `vendix-zoneless-signals` |
| Running the Plan Validation Checklist before requesting approval | `how-to-plan` |
| Scoping inventory, suppliers, purchases, accounting, reports, or transfers by store vs organization | `vendix-operating-scope` |
| Selecting the correct skills for each plan step using the Skill Selection Matrix | `how-to-plan` |
| Styling AI interaction buttons or loading states | `vendix-ai-engine` |
| Styling and Theming | `vendix-frontend-theme` |
| Transitioning products between simple and variant modes | `vendix-inventory-stock` |
| Troubleshoot why a skill is missing from AGENTS.md auto-invoke | `skill-sync` |
| Understanding AI cost tracking | `vendix-ai-platform-core` |
| Understanding Public/Private Apps and Domains | `vendix-app-architecture` |
| Understanding Vendix app environments or mobile boundary | `vendix-app-architecture` |
| Understanding Vendix architecture | `vendix-core` |
| Understanding frontend web architecture | `vendix-frontend` |
| Understanding settings inheritance and defaults | `vendix-settings-system` |
| Updating notification subscriptions or notification preferences | `vendix-notifications-system` |
| Updating skill guidance or documenting repeatable AI patterns | `skill-creator` |
| Uploading files, handling S3 URLs, or saving image URLs to database | `vendix-s3-storage` |
| User explicitly requests business analysis | `vendix-business-analysis` |
| User requests agent teams, subordinate agents, parallel agents, or background agents | `agent-teams` |
| Using AWS CLI to inspect or administer Vendix cloud resources | `vendix-cloud-operations` |
| Using SSH to inspect Vendix production infrastructure | `vendix-cloud-operations` |
| Using input(), output(), model(), signal(), computed(), effect(), or toSignal() | `vendix-zoneless-signals` |
| Using toSignal() in facades — validating initialValue presence | `vendix-zoneless-signals` |
| Validating variant availability in ecommerce, POS, cart, checkout, reservations, or catalog | `vendix-product-variants` |
| Verifying Build | `buildcheck-dev` |
| Verifying plan completeness before approval | `how-to-plan` |
| When adding icons to components, buttons, menus, or using <app-icon> | `vendix-frontend-icons` |
| When editing product schemas, pricing logic, or advanced product forms | `vendix-product-pricing` |
| When editing schema.prisma, creating migrations, or using Prisma client | `vendix-prisma` |
| When working with pricing that includes taxes/fees, creating UI components for pricing, or implementing price calculations | `vendix-calculated-pricing` |
| Wiring the subscription-paywall HTTP interceptor on the frontend | `vendix-subscription-gate` |
| Working across apps or shared libraries | `vendix-core` |
| Working on backend domains | `vendix-backend-domain` |
| Working on frontend domains | `vendix-frontend-domain` |
| Working on notifications dropdown or bell badge UI | `vendix-notifications-system` |
| Working with @defer, @if, @for control flow blocks in templates | `vendix-zoneless-signals` |
| Working with AI agent or tool-use | `vendix-ai-engine` |
| Working with AI async processing | `vendix-ai-queue` |
| Working with AI chat NgRx state | `vendix-ai-chat` |
| Working with AI chat conversations | `vendix-ai-chat` |
| Working with AI conversations | `vendix-ai-engine` |
| Working with AI embeddings or RAG | `vendix-ai-embeddings-rag` |
| Working with AI embeddings or RAG | `vendix-ai-engine` |
| Working with AI logging and observability | `vendix-ai-platform-core` |
| Working with AI streaming | `vendix-ai-engine` |
| Working with AI streaming | `vendix-ai-streaming` |
| Working with AIAgentService | `vendix-ai-agent-tools` |
| Working with AIChatService | `vendix-ai-chat` |
| Working with AIEngineService core methods | `vendix-ai-platform-core` |
| Working with AIStreamController | `vendix-ai-streaming` |
| Working with AIToolRegistry | `vendix-ai-agent-tools` |
| Working with AccountingEventsListener or AutoEntryService | `vendix-auto-entries` |
| Working with BullMQ for AI | `vendix-ai-queue` |
| Working with CurrencyPipe or CurrencyFormatService | `vendix-currency-formatting` |
| Working with DIAN NIT ownership | `vendix-fiscal-scope` |
| Working with EventSource for AI | `vendix-ai-streaming` |
| Working with MCP server | `vendix-ai-engine` |
| Working with MCP server | `vendix-mcp-server` |
| Working with McpController | `vendix-mcp-server` |
| Working with MenuFilterService or menu filtering | `vendix-panel-ui` |
| Working with Prisma scoped services | `vendix-prisma-scopes` |
| Working with RAG pipeline | `vendix-ai-embeddings-rag` |
| Working with SSE endpoints for AI | `vendix-ai-streaming` |
| Working with SubscriptionAccessService or SubscriptionResolverService | `vendix-subscription-gate` |
| Working with SubscriptionBillingService or SubscriptionPaymentService | `vendix-saas-billing` |
| Working with backend auth guards or decorators | `vendix-backend-auth` |
| Working with country, timezone, department, or city selectors in frontend | `vendix-frontend-country-api` |
| Working with date.util.ts utilities | `vendix-date-timezone` |
| Working with default_templates | `vendix-settings-system` |
| Working with embeddings or pgvector | `vendix-ai-embeddings-rag` |
| Working with fiscal accounting entities | `vendix-fiscal-scope` |
| Working with fiscal reports by NIT | `vendix-fiscal-scope` |
| Working with fiscal scope migrations | `vendix-fiscal-scope` |
| Working with intercompany stock-transfer entries | `vendix-fiscal-scope` |
| Working with inventory transactions or movements | `vendix-inventory-stock` |
| Working with inventory valuation | `vendix-inventory-valuation` |
| Working with journal entries, mapping keys, PUC accounts, payroll provisions, parafiscales, or debit/credit logic | `vendix-accounting-rules` |
| Working with notifications SSE or Web Push | `vendix-notifications-system` |
| Working with organization operating scope STORE vs ORGANIZATION | `vendix-operating-scope` |
| Working with organizations.fiscal_scope | `vendix-fiscal-scope` |
| Working with permissions-roles seed | `vendix-permissions` |
| Working with products that have variants but do not track stock | `vendix-product-variants` |
| Working with service variants, booking duration, buffer, preparation time, or product_variant_id on bookings | `vendix-product-variants` |
| Working with stock levels, inventory adjustments, or stock transfers | `vendix-inventory-stock` |
| Working with toLocaleDateString or DatePipe | `vendix-date-timezone` |
| Writing Code (Naming) | `vendix-naming-conventions` |
| Writing Validation Logic | `vendix-validation` |
| changes with database migrations | `git-workflow` |
| git commit, git push, create PR, create branch | `git-workflow` |
| resolve merge conflicts | `git-workflow` |

---

## 🗣️ Language & Communication

**CRITICAL PROTOCOL:** The model must **ALWAYS** detect the language used by the user and respond in the same language.

- **User speaks English** → Respond in English.
- **User speaks Spanish** → Respond in Spanish.
- **User speaks French** → Respond in French.
- _(Adapt to any language used by the user)_

## 🚀 Quick Start

### How Skills Work

1. **Auto-detection:** AI detects context and loads appropriate skills
2. **Composition:** Multiple skills can be active simultaneously
3. **Priority:** CORE skills have absolute priority and must ALWAYS be respected

## 🚨 CORE SKILLS - Always Active

**These skills contain the MOST CRITICAL rules that must ALWAYS be respected:**

| Skill                             | Trigger                       | Priority     | Description                                                                 |
| --------------------------------- | ----------------------------- | ------------ | --------------------------------------------------------------------------- |
| **`how-to-dev`**                  | **ALWAYS**                    | **CRITICAL** | Mandatory ultra-obligatory dev flow                                         |
| **`Vendix-core`**                  | **ALWAYS**                    | **CRITICAL** | Core patterns and conventions                                               |
| **`git-workflow`**                | **ALWAYS**                    | **CRITICAL** | Git commit, PR, branching and conflict rules                                |
| **`vendix-zoneless-signals`**     | **ANY FRONTEND FILE**         | **CRITICAL** | Zoneless + Signals (Angular 20) — violaciones producen bugs silenciosos     |
| **`knowledge-gap`**               | **UNKNOWN PATTERN**           | **HIGH**     | Protocol for new/undefined patterns                                         |

**⚠️ IMPORTANT:** NEVER compromise these rules. They are the foundation of the project.

## 🧬 Protocol for New Patterns (MANDATORY)

**IF** you develop a new feature, architecture, or pattern that is **NOT** covered by existing skills or documentation:

1. **IDENTIFY:** Recognize that you are introducing a new standard or pattern.
2. **PROPOSE:** You **MUST** ask the user if they wish to create a new skill for this pattern.
3. **STANDARDIZE:** If agreed, suggest the structure for the new skill (Description, Trigger, Code Examples).

> **AI Instruction:** _"I notice we are implementing a new pattern for [Concept]. Should we create a skill for this to maintain future consistency?"_ (Translate this question to the user's language).

## 🔧 Architecture & Patterns

### Repository-Specific Skills

| Skill                    | Description                                             | Location (Source)                                                                |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Vendix-core`            | Core patterns and conventions                           | [skills/Vendix-core/SKILL.md](skills/Vendix-core/SKILL.md)                       |
| `vendix-product-pricing` | Advanced product pricing logic and rentability patterns | [skills/vendix-product-pricing/SKILL.md](skills/vendix-product-pricing/SKILL.md) |
| `agent-teams`            | Agent team orchestration for complex composite tasks    | [skills/agent-teams/SKILL.md](skills/agent-teams/SKILL.md)                       |
| `vendix-saas-billing`    | SaaS platform billing with partner rev-share split      | [skills/vendix-saas-billing/SKILL.md](skills/vendix-saas-billing/SKILL.md)       |
| `vendix-subscription-gate` | Feature gating by store subscription state (AI + modules) | [skills/vendix-subscription-gate/SKILL.md](skills/vendix-subscription-gate/SKILL.md) |
| `vendix-redis-quota`     | Periodic quota counter with Redis INCR + EXPIRE         | [skills/vendix-redis-quota/SKILL.md](skills/vendix-redis-quota/SKILL.md)         |

## ⚙️ Configuration & Sync

Each AI provider requires specific configuration paths. Run `./skills/setup.sh` to sync to these locations:

| Provider           | Config File                       | Skill Location                     |
| ------------------ | --------------------------------- | ---------------------------------- |
| **OpenCode**       | `opencode.json`                   | `.opencode/skills/<name>/SKILL.md` |
| **Claude Code**    | `CLAUDE.md`                       | `.claude/skills/<name>/SKILL.md`   |
| **Gemini**         | `GEMINI.md`                       | `.agent/skills/<name>/SKILL.md`    |
| **GitHub Copilot** | `.github/copilot-instructions.md` | N/A (Embedded in instructions)     |

## 🎯 Auto-Invoke Rules

### Development Workflow

**ALWAYS invoke skills in this order:**

1. **CORE Skills** (Always Active)
   - Check `Vendix-core` for fundamental rules

2. **Context-Specific Skills**
   - Check available skills in `skills/` (or provider-specific folders)

## 🔄 Sync & Setup

### Sync Skills to AI Tools

```bash
./skills/setup.sh --sync
```

### Regenerate Config Files

```bash
./skills/setup.sh --all        # All formats
./skills/setup.sh --claude     # Claude Code only
./skills/setup.sh --copilot    # GitHub Copilot only
./skills/setup.sh --gemini     # Gemini only
./skills/setup.sh --opencode   # OpenCode only
```
