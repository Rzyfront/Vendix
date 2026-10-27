---
name: vendix-business-analysis
description: >
  Business discovery for Vendix changes that directly affect the app's economic activity. Trigger: the
  user explicitly requests business analysis, or a change needs decisive business rules before
  how-to-plan.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "User explicitly requests business analysis"
    - "Business analysis for changes that directly affect the app economic activity"
    - "Decisive business-rule analysis before planning revenue, billing, subscriptions, pricing, commissions, checkout, inventory, accounting, or payments changes"
---

# Vendix Business Analysis

Turns an economically relevant request into confirmed rules, actors, cases, risks, open questions and acceptance criteria. Output is a business brief that `how-to-plan` consumes; this skill never chooses files, writes code or prescribes implementation.

## When to use

- Explicit request for business analysis, discovery, use-case standardization or acceptance criteria.
- Changes or functional fixes that directly affect revenue, billing, subscriptions, pricing, plan limits, commissions, payouts, checkout, payments, refunds, invoices, taxes, inventory valuation, accounting, financial reports or commercial obligations.

Not for: typos/lint/renames, pure refactors, generic CRUD/UI/routing/validation without economic effect, or approved plans the user said to execute. If applicability is ambiguous, offer the analysis and proceed only on explicit acceptance.

## Rules

- Do not plan or implement until the minimum business behavior is clear.
- Separate confirmed decisions, assumptions and open questions. A rule the user already stated is confirmed; don't ask again.
- Ask 3–7 high-impact questions per round, only those that can change money, entitlement, stock, accounting, billing, legal or audit behavior. Offer concrete options with business impact instead of open questions.
- Mark anything affecting production data, permissions, money, stock, accounting, compliance or auditability as `Critical decision` and ask explicitly.
- If the user refuses more questions, record assumptions and pass them to the plan as risks.
- An undocumented repeatable pattern → note the knowledge gap and suggest a skill.

## Workflow

1. Confirm why it qualifies (explicit request or direct economic impact).
2. Classify: feature, bugfix, economic rule change, checkout/payment, subscription/billing, pricing/commission, inventory/accounting, report, automation, data correction.
3. Identify domain, app environment, tenant scope, actors, entities and likely domain skills (`vendix-core` maps them).
4. Extract intent (problem, user, moment, expected outcome) and explicit rules.
5. Interview one focused round; explore primary, alternate and blocked flows, exceptions and existing-data behavior.
6. Convert confirmed behavior into acceptance criteria and produce the `Business Analysis Brief`; hand off to `how-to-plan`.

Question bank by area and the mandatory brief template: `references/question-bank-and-template.md` (leer bajo demanda).

## Related Skills

`how-to-plan` (turns the brief into the ODD feature doc), `vendix-core` (apps and domain skills).
