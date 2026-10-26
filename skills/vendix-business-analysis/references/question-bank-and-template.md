# Business analysis — question bank and brief template

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

