---
name: vendix-business-analysis
description: >
  Business discovery for Vendix changes that directly affect the app's economic activity.
  Trigger: When the user explicitly requests business analysis, or when a change requires decisive business rules about the app's direct economic activity before how-to-plan.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "User explicitly requests business analysis"
    - "Business analysis for changes that directly affect the app economic activity"
    - "Decisive business-rule analysis before planning revenue, billing, subscriptions, pricing, commissions, checkout, inventory, accounting, or payments changes"
---

# Vendix Business Analysis

## Purpose

Use this skill before `how-to-plan` only when the user explicitly requests business analysis or when a new implementation, functional correction, or product behavior change directly affects Vendix's economic activity. The goal is to turn an economically relevant request into confirmed rules, actors, cases, risks, open questions, and acceptance criteria.

This skill does not create technical plans, choose files, write code, or prescribe implementation steps. Its output is a business brief that `how-to-plan` can consume later.

## Core Rules

- Do not plan or implement until the minimum business behavior is clear.
- Do not auto-invoke this skill for ordinary implementation work; use it only for direct economic impact or explicit user request.
- If it is ambiguous whether this skill applies, ask the user whether to run a business-logic analysis; proceed only after explicit acceptance.
- Separate confirmed decisions, assumptions, and open questions.
- Ask only questions that can change economic behavior, revenue, billing, pricing, commissions, checkout, inventory value, accounting, subscriptions, payments, financial reports, audits, or legal/commercial obligations.
- Do not over-interview the human; ask 3-7 critical questions per round unless the human explicitly requests a full workshop.
- If the user already stated a rule, record it as confirmed instead of asking again.
- If several valid interpretations exist, present concrete options and explain their business impact.
- Mark decisions that can affect production data, permissions, money, stock, accounting, legal compliance, or auditability as `Critical decision`.
- End with a concise business brief and a candidate skill map for the later plan.

## When To Use

Use this skill for:

- User requests that explicitly ask for business analysis, discovery, business interview, use-case standardization, or acceptance criteria.
- Changes that directly affect revenue, billing, subscriptions, pricing, plan limits, commissions, payouts, checkout, payments, refunds, invoices, taxes, inventory valuation, accounting, financial reports, or commercial obligations.
- Functional bug fixes where the expected behavior can change money flow, entitlement, customer purchase behavior, stock availability, accounting entries, or billing state.
- Requests that require decisive product/business rules for economic cases, variants, exceptions, approvals, or acceptance criteria.

Do not use this skill for:

- Typos, formatting, lint fixes, or mechanical renames.
- Purely technical refactors with no product behavior change.
- Generic features, UI changes, CRUD modules, routing, validation, or API work that does not directly affect economic activity.
- Already-approved plans where the user explicitly says to execute.

## Business Discovery Workflow

1. Confirm why the request qualifies: explicit user request or direct impact on Vendix economic activity.
2. Classify the request as feature, bugfix, economic rule change, checkout/payment flow, subscription/billing behavior, pricing/commission logic, inventory/accounting impact, report, automation, or data correction.
3. Identify the affected Vendix domain, app environment, tenant scope, actors, entities, and likely specialized skills.
4. Extract the business intent: the economic problem, the user, the moment when it applies, and the expected business outcome.
5. Record explicit business rules already provided by the human.
6. Detect ambiguity that blocks correct planning or can alter economic behavior.
7. Ask a focused interview round with only the highest-impact questions.
8. Explore primary flows, alternate flows, blocked states, exceptions, and existing-data behavior.
9. Convert confirmed behavior into business acceptance criteria.
10. Produce a `Business Analysis Brief` and hand it off to `how-to-plan`.

## Interview Question Bank

Use these question types selectively. Do not ask every question in every analysis.

| Area | Questions To Consider |
| --- | --- |
| Actor | Who performs the action? Who approves it? Who sees the result? |
| Scope | Does it apply by organization, store, customer, user, role, plan, domain, or app environment? |
| Trigger | What event starts the flow? Is it manual, automatic, scheduled, or external? |
| State | In which statuses is the action allowed, blocked, reversible, or final? |
| Permissions | Which roles can create, view, edit, approve, cancel, retry, export, or delete? |
| Data | Which fields are required, optional, calculated, inherited, immutable, or auditable? |
| Rules | What validations, limits, priorities, defaults, exceptions, or conflict rules apply? |
| Variants | What changes by plan, tenant, app type, country, currency, product type, or customer type? |
| Impact | Does it affect billing, invoices, commissions, taxes, stock, accounting, reports, notifications, or audits? |
| UX/API | What should users or API consumers see on success, failure, empty state, blocked state, or partial completion? |
| Existing Data | What happens to records already created before the change? |
| Failure | What should happen if an external provider, payment, email, queue, or background job fails? |
| Acceptance | How will the business know the behavior is correct? |

## Decision Rules

| Situation | Action |
| --- | --- |
| The request does not directly affect economic activity and the user did not explicitly request business analysis | Do not use this skill; continue with the relevant domain or planning skill. |
| It is ambiguous whether the request directly affects economic activity | Offer to run a business-logic analysis and wait for explicit user acceptance. If the user declines or ignores the offer, do not use this skill. |
| The request lacks actors, scope, or expected outcome | Ask a short clarification round before planning. |
| The request has enough confirmed behavior for planning | Produce the brief and invoke `how-to-plan`. |
| A decision affects data, money, permissions, stock, accounting, compliance, or auditability | Mark it as `Critical decision` and ask explicitly. |
| A question has several valid answers | Present options with business impact instead of asking an open-ended question. |
| The analysis discovers an undocumented repeatable pattern | Mark a knowledge gap and suggest a new or updated skill. |
| The user rejects further questions but asks to proceed | Record assumptions clearly and pass them to `how-to-plan` as risks. |

## Required Output Format

```markdown
## Business Analysis Brief

### Request
[Short summary of the business need]

### Change Type
[Feature | Bugfix | Improvement | Rule change | Integration | Report | Data correction | Other]

### Domain And Actors
- Domain:
- Apps affected:
- Tenant scope:
- Actors:
- Entities:

### Confirmed Decisions
- [Rule or behavior confirmed by the human]

### Assumptions
- [Assumption that still needs confirmation]

### Open Questions
- [Critical question that blocks or changes scope]

### Business Rules
- [Functional rule, policy, validation, or exception]

### Use Cases And Variants
- Primary flow: [Main success path]
- Alternate flow: [Valid variant]
- Blocked flow: [When the flow must not continue]
- Existing-data behavior: [How historical records behave]

### Edge Cases
- [Boundary, failure, concurrency, permission, subscription, data, or provider case]

### Acceptance Criteria
- [Business-verifiable result]

### Risks / Critical Decisions
- [Data, permission, money, stock, accounting, compliance, or audit risk]

### Candidate Skills For Planning
- `how-to-plan`
- `[domain-specific skills detected during analysis]`

### Handoff To how-to-plan
[Concise behavior summary and decisions the plan must preserve]
```

## Related Skills

- `how-to-plan` - Converts the business brief into an approved implementation plan.
- `how-to-dev` - Executes the approved plan after business analysis and planning are complete.
- `agent-teams` - Adds parallel perspectives when discovery spans several domains or risk areas.
- `vendix-core` - Maps Vendix apps, boundaries, and likely specialized skills.
- `skill-creator` - Creates or updates skills when analysis exposes a repeatable knowledge gap.
