---
name: agent-teams
description: >
  Agent team orchestration for complex and composite tasks.
  Trigger: Complex multi-domain tasks, full end-to-end feature development,
  broad refactors, or when the user requests agent teams.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: workflow
  auto_invoke:
    - "Complex tasks spanning multiple domains or layers (backend + frontend + DB)"
    - "Full end-to-end feature development"
    - "Broad refactors touching multiple modules"
    - "User requests agent teams, team of agents, or parallel work"
    - "agent team, team of agents, parallel agents, split task, divide task"
---

## When to Use

- Tasks involving **multiple domains** (backend + frontend + database + tests)
- Full **end-to-end** features requiring coordinated changes across multiple layers
- Broad refactors touching **3+ files** in different areas of the monorepo
- When the user **explicitly requests** an agent team
- When Claude **detects** that the task is too complex for sequential execution and would benefit from parallelization

## When NOT to Use

- Simple changes in 1-2 files within the same domain
- Targeted bug fixes with limited scope
- Research or code reading tasks
- Changes with strict sequential dependencies where no parallelism is possible

---

## Agent Teams Protocol (3 Phases)

### PHASE 1: Context and Scope Analysis

**BEFORE invoking any agent**, the orchestrator (main Claude) MUST:

1. **Understand the full objective** — Read the user's request and understand the expected final outcome.
2. **Map the scope** — Identify all domains, layers, and files that will be affected.
3. **Invoke `how-to-dev`** — Follow the standard development flow to analyze required skills.
4. **Identify dependencies** — Determine which parts can run in parallel and which have sequential dependencies.

```
Analysis example:
┌─────────────────────────────────────────────┐
│ OBJECTIVE: Create "Reports" module          │
│                                             │
│ SCOPE:                                      │
│  ├── DB: New table + migration              │
│  ├── Backend: Domain + API endpoints        │
│  ├── Frontend: Angular module + routing     │
│  └── Tests: Bruno API tests                 │
│                                             │
│ DEPENDENCIES:                               │
│  DB → Backend → Frontend (sequential)       │
│  Tests can run after Backend                │
│                                             │
│ REQUIRED SKILLS PER STAGE:                  │
│  ├── DB: vendix-prisma-schema,              │
│  │       vendix-prisma-migrations           │
│  ├── Backend: vendix-backend-domain,        │
│  │            vendix-backend-api            │
│  ├── Frontend: vendix-frontend-module,      │
│  │             vendix-frontend-routing      │
│  └── Tests: vendix-bruno-test               │
└─────────────────────────────────────────────┘
```

### PHASE 2: Architectural Decomposition

Split the task into **independent work units** that can be assigned to agents:

| Criterion | Description |
|-----------|-------------|
| **Independence** | Each unit must be executable without blocking another (or have clear dependencies) |
| **Completeness** | Each unit must produce a verifiable functional result |
| **Limited scope** | Each agent must have a clear and bounded objective |
| **Mapped skills** | Each unit MUST have its skills referenced before assignment |

#### Work Unit Structure

```
UNIT: [Descriptive name]
├── Objective: [What this agent must achieve]
├── Files: [Files to read/create/modify]
├── Skills: [Skills the agent MUST invoke]
├── Dependencies: [Which other units it depends on]
├── Deliverable: [What result it produces]
└── Verification: [How to validate it completed correctly]
```

### PHASE 3: Agent Team Invocation

#### Invocation Rules

1. **ALWAYS** include in each agent's prompt:
   - The instruction to invoke `how-to-dev` as the first step
   - The specific skills it must consult
   - The shared context of the global objective
   - Its specific objective and expected deliverable

2. **Independent agents → Launch in parallel** using multiple `Agent` tool calls in a single message.

3. **Dependent agents → Launch sequentially**, passing the previous agent's result as context.

4. **Each agent is autonomous** but aware of the global objective.

#### Agent Prompt Template

```
GLOBAL CONTEXT:
[Description of the user's complete objective]

YOUR SPECIFIC OBJECTIVE:
[Concrete objective for this agent]

MANDATORY INSTRUCTIONS:
1. FIRST invoke the `how-to-dev` skill to follow the standard development flow.
2. Consult the following skills BEFORE writing code:
   - [skill-1]
   - [skill-2]
   - [skill-n]
3. Your deliverable is: [clear description of the output]
4. Files you must read/modify: [file list]
5. DO NOT modify files outside your assigned scope.

VERIFICATION:
- [Completion criterion 1]
- [Completion criterion 2]
```

---

## Agent Coordination

### Communication Model

Agents do not communicate directly with each other. The **orchestrator** (main Claude) acts as the coordinator:

```
┌──────────────────────────────────────────┐
│           ORCHESTRATOR (Claude)          │
│                                          │
│  1. Analyze → 2. Divide → 3. Assign     │
│                                          │
│         ┌──────┬──────┬──────┐           │
│         │      │      │      │           │
│         ▼      ▼      ▼      ▼           │
│      Agent   Agent  Agent  Agent         │
│       (DB)  (Back) (Front) (Test)        │
│         │      │      │      │           │
│         ▼      ▼      ▼      ▼           │
│      Combined results → Synthesis        │
│                                          │
│  4. Validate → 5. Integrate → 6. Report │
└──────────────────────────────────────────┘
```

### Execution Flow

```
1. PARALLEL (no dependencies):
   ├── Agent A (backend research)   ─┐
   ├── Agent B (frontend research)  ─┤── Launch together
   └── Agent C (schema analysis)    ─┘

2. SEQUENTIAL (with dependencies):
   Agent D (DB migration)
     → result → Agent E (backend endpoints)
       → result → Agent F (frontend module)

3. MIXED (most common):
   Round 1 (parallel): Research + Analysis
   Round 2 (sequential): DB migration
   Round 3 (parallel): Backend + Frontend (using DB result)
   Round 4 (parallel): Tests + Verification
```

### Result Synthesis

After all agents complete their work, the orchestrator MUST:

1. **Collect** results from each agent
2. **Verify coherence** between changes from different agents
3. **Resolve conflicts** if two agents touched overlapping areas
4. **Present to user** a structured summary of the work done
5. **Verify the build** by invoking `buildcheck-dev` if code was written

---

## Full Example: End-to-End Feature

### User request:
> "Create a complete Expenses module with CRUD, API, and frontend module"

### Phase 1 — Analysis:

```
OBJECTIVE: Complete Expenses CRUD module
SCOPE: DB + Backend + Frontend + Tests
DEPENDENCIES: DB → Backend → Frontend (partially parallel)
```

### Phase 2 — Decomposition:

| Agent | Type | Objective | Skills | Dependency |
|-------|------|-----------|--------|------------|
| Agent-Schema | general-purpose | Create Prisma model + migration | vendix-prisma-schema, vendix-prisma-migrations | None |
| Agent-Backend | general-purpose | Create domain + service + controller | vendix-backend-domain, vendix-backend-api, vendix-prisma-scopes | Agent-Schema |
| Agent-Frontend | general-purpose | Create Angular module with routing | vendix-frontend-module, vendix-frontend-standard-module, vendix-frontend-routing | Agent-Backend (to know the API) |
| Agent-Tests | general-purpose | Create Bruno tests for endpoints | vendix-bruno-test | Agent-Backend |

### Phase 3 — Execution:

```
Round 1: Agent-Schema (solo, sequential — must complete first)
Round 2: Agent-Backend + Agent-Research-Frontend (parallel)
Round 3: Agent-Frontend + Agent-Tests (parallel, post-backend)
Round 4: Verification with buildcheck-dev
```

---

## Agent Configuration

### Available Agent Types

| Type | Use | Tools |
|------|-----|-------|
| `general-purpose` | Code development, multi-step tasks | All |
| `Explore` | Code research, pattern discovery | Read-only |
| `Plan` | Implementation plan design | Read-only |

### Isolation Rules

| Scenario | Isolation |
|----------|-----------|
| Agents modifying different files | `isolation: "worktree"` recommended |
| Agents only researching | No isolation needed |
| Agents depending on previous changes | No isolation (they need to see the changes) |

---

## Mandatory Rules

1. **NEVER** launch agents without completing Phase 1 (analysis) and Phase 2 (decomposition)
2. **ALWAYS** include `how-to-dev` in each agent's instructions
3. **ALWAYS** map skills per agent BEFORE launching them
4. **NEVER** let an agent modify files outside its assigned scope
5. **ALWAYS** verify the build after all agents finish
6. **ALWAYS** present the user a work summary before executing
7. **ALWAYS** ask user confirmation before launching the team if the task involves significant changes
8. **NEVER** use agent teams for tasks that a single agent can solve efficiently

## Commands

```bash
# Verify build after agent team
docker logs --tail 40 vendix_backend
docker logs --tail 40 vendix_frontend

# Sync skills
./skills/setup.sh --sync
```
