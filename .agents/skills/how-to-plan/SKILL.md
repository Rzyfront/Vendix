---
name: how-to-plan
description: >
  Defines the Vendix planning protocol before development.
  Trigger: When creating implementation plans, analyzing non-trivial changes, decomposing work, or preparing multi-agent development.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating implementation plans or decomposing non-trivial work"
    - "Planning structural changes, multi-file changes, broad refactors, or new features"
---

# How To Plan

## Purpose

Use this skill to create implementation plans before development. A valid plan explains what will be done, why it will be done, which skills govern each step, and which business decisions apply.

## Core Rules

- Analyze every non-trivial plan with multiple agents before finalizing it.
- Compare viable approaches and choose one deliberately.
- Every plan step must reference the skills that govern it, or explicitly mark `Knowledge gap` when no skill exists.
- No plan step may be left without a skill reference or a `Knowledge gap` marker.
- Every plan step must include the business rule, product behavior, or technical policy decision behind the work.
- Do not leave ambiguous implementation intent; state the expected outcome and rationale for each step.
- Present the plan for human approval before development unless the human explicitly asked to execute an already-approved plan.

## Planning Workflow

1. Understand the objective, constraints, and expected outcome.
2. Use multiple agents to inspect the relevant domains and possible approaches.
3. Map all affected layers, files, data flows, permissions, UI states, and side effects.
4. Load and assign the relevant skills to each planned step.
5. Compare approaches and record the selected approach with the reason it was chosen.
6. Create a step-by-step plan where every step has skills, decisions, rationale, and verification.
7. Identify knowledge gaps and propose the missing skill or skill update.
8. Ask for approval before execution when the plan is new or changed.

## Required Plan Format

Each plan must use this structure:

```markdown
## Objective
[Clear outcome expected by the human]

## Approach Chosen
[Selected approach and why it is preferred over alternatives]

## Alternatives Considered
- [Alternative]: [why it was not chosen]

## Steps
1. [Step name]
   Skills: [skill-1], [skill-2]
   Business decision: [rule, product behavior, or technical policy being applied]
   Why: [reason this step exists]
   Output: [expected concrete result]
   Verification: [how this step will be checked]

## Knowledge Gaps
- [Gap]: [missing skill or skill update proposed]
```

## Multi-Agent Analysis

Use multiple agents for non-trivial plans:

| Perspective | Purpose |
| --- | --- |
| Domain analysis | Identify business rules, permissions, tenant scope, and data ownership |
| Implementation analysis | Identify files, dependencies, risks, and sequence |
| Verification analysis | Identify logs, tests, build checks, and edge cases |
| UX/API analysis | Identify user-facing behavior, contracts, states, and errors |

For broad work, use `agent-teams` to delegate investigation or implementation planning. If agent tooling is unavailable, document the limitation and perform separate named analysis passes instead of pretending multi-agent review happened.

## Step Requirements

Every step must include:

- Skills: concrete skill names that govern the step.
- Business decision: the rule or product behavior being enforced.
- Why: the reason for the step and why it belongs in the sequence.
- Output: the concrete artifact or behavior expected.
- Verification: the check that proves the step is complete.

If any of these are unknown, do not hide the uncertainty. Ask a question or mark it as a knowledge gap.

## Knowledge Gaps

A knowledge gap exists when a planned step requires a repeatable pattern that is not covered by an existing skill.

When a gap appears:

1. Mark the step as `Knowledge gap` instead of inventing rules.
2. Describe the missing pattern and why it matters.
3. Propose the new skill name or the existing skill to update.
4. Ask the human whether to create or update the skill.

## Relationship With Development

After the plan is approved, execution follows `how-to-dev`. The developer must follow the plan as written, load the referenced skills, preserve the recorded business decisions, and avoid replanning unless the human requests it.

## Related Skills

- `how-to-dev` - Development execution after planning
- `agent-teams` - Agent orchestration for broad or multi-domain work
- `skill-creator` - Creating skills for knowledge gaps
- `skill-sync` - Synchronizing skill metadata after changes
