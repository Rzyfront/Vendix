---
name: agent-teams
description: >
  Orchestrates subordinate agents for complex plans and user-requested agent teams.
  Trigger: Use only for complex plans, broad multi-domain work, or when the user explicitly requests agent teams, parallel agents, or delegated sub-agents.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Complex plans requiring delegated agent work"
    - "User requests agent teams, subordinate agents, parallel agents, or background agents"
---

# Agent Teams

## Purpose

Use this skill to make the main agent act as an orchestrator. The orchestrator divides a complex objective into smaller bounded tasks, delegates those tasks to subordinate agents, supervises their outputs, and produces a final integrated summary.

## When To Use

- The plan is complex enough to benefit from multiple specialized investigations or implementation tracks.
- The task spans multiple domains, layers, modules, or independent workstreams.
- The user explicitly asks for agent teams, subordinate agents, parallel agents, background agents, or delegated work.

Do not use this skill for simple edits, narrow bug fixes, routine file reads, or tasks a single agent can complete efficiently.

## Orchestrator Responsibilities

The main agent remains responsible for the final outcome:

- Understand the global objective and approved plan.
- Identify which sub-tasks can be delegated safely.
- Choose the right available tool for subordinate/background agents.
- Provide each agent with a complete, bounded prompt.
- Keep each agent scoped to a small task and clear deliverable.
- Coordinate dependencies between agents.
- Review and reconcile all results.
- Produce the final summary and verification status.

Subordinate agents do not own the final decision. They provide research, implementation, review, or verification outputs for the orchestrator to integrate.

## Delegation Workflow

1. Confirm the task qualifies for agent-team work.
2. Read the approved plan or create one through `how-to-plan` before execution.
3. Split the objective into small units with clear boundaries.
4. Decide which units can run in parallel and which depend on earlier results.
5. Launch independent agents in parallel when tooling supports it.
6. Launch dependent agents sequentially, passing prior results as context.
7. Review each agent output for correctness, conflicts, scope drift, and missing verification.
8. Integrate the accepted outputs into one coherent result.
9. Summarize what each agent did, what changed, what remains risky, and how it was verified.

## Work Unit Requirements

Each delegated unit must include:

- Objective: the exact sub-task the agent must complete.
- Scope: files, domains, or questions the agent may touch.
- Skills: skills the agent must load before acting.
- Dependencies: previous results or blockers required before starting.
- Deliverable: the concrete output expected from the agent.
- Verification: how the orchestrator will judge completion.

## Agent Prompt Template

```text
GLOBAL OBJECTIVE:
[Overall approved objective]

YOUR TASK:
[Small bounded task]

SCOPE:
[Allowed files, domains, or questions]

REQUIRED SKILLS:
[Skills to load before acting]

DEPENDENCIES:
[Inputs from prior agents, if any]

DELIVERABLE:
[Expected final response or code outcome]

CONSTRAINTS:
- Stay inside scope.
- Report blockers instead of guessing.
- Return concise findings, changes, risks, and verification notes.
```

## Coordination Rules

- Parallelize only independent units.
- Serialize units that depend on schema, API contracts, business decisions, or prior edits.
- Do not let agents modify overlapping files unless the orchestrator explicitly handles conflict resolution.
- Do not delegate vague tasks; each agent must have a narrow outcome.
- Do not accept an agent output blindly; the orchestrator must review it.
- If agents disagree, the orchestrator resolves the decision using the approved plan, loaded skills, and user requirements.

## Final Summary

After the team finishes, report:

- Agents or work units executed.
- Key outputs accepted from each unit.
- Conflicts or blockers found.
- Final integrated result.
- Verification performed or verification blockers.
- Remaining risks or follow-up recommendations.

## Related Skills

- `how-to-plan` - Required before complex agent-team execution
- `how-to-dev` - Development execution rules after planning
- `buildcheck-dev` - Verification after code changes
