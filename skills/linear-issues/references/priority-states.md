# Priority and State Enums

## Priority

| Value | Meaning                |
| ----- | ---------------------- |
| 0     | No priority            |
| 1     | Urgent                 |
| 2     | High                   |
| 3     | Medium                 |
| 4     | Low                    |

Map user-friendly language:

- "urgente" / "critical" / "P0" → 1
- "alta" / "high" / "P1" → 2
- "media" / "medium" / "P2" → 3
- "baja" / "low" / "P3" → 4
- "sin prioridad" / unspecified → 0

### Escalation rule: a `Devuelto` ticket is re-prioritized

When QA rejects a ticket in production and it goes back to `Todo` with the
`Devuelto` label (step 9 in `states.md`), its priority is raised to **Alta (2)**
— **unless it is already Urgent (1)**, in which case it stays Urgent.

```js
priority = current === 1 ? 1 : 2   // never demote an urgent ticket
```

**Why:** a ticket that reached production and failed already consumed a full
dev + review + release cycle. It jumps the queue over work that has not been
attempted yet. The Urgent carve-out exists because `2` would be a *demotion*
for a ticket already flagged as critical.

## State types

Linear states have a `type` field in addition to `name`. The type is what you
filter on for "active" or "backlog":

| Type         | Typical names                          |
| ------------ | -------------------------------------- |
| `backlog`    | Backlog                                |
| `unstarted`  | Todo, Planned                          |
| `started`    | In Progress, Code Review, In Review    |
| `completed`  | Done, Shipped                          |
| `canceled`   | Cancelled, Won't Do                    |

Workflow templates differ per team. When resolving a state by name, fetch the
team's full state list once and cache it, instead of guessing. Use:

```graphql
query TeamStates($id: String!) {
  team(id: $id) {
    states(first: 50) {
      nodes { id name type position }
    }
  }
}
```

The order Linear returns is not guaranteed to be workflow order; sort by
`position` ascending when displaying.
