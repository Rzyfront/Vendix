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

## State types

Linear states have a `type` field in addition to `name`. The type is what you
filter on for "active" or "backlog":

| Type         | Typical names                          |
| ------------ | -------------------------------------- |
| `backlog`    | Backlog                                |
| `unstarted`  | Todo, Planned                          |
| `started`    | In Progress, In Review                 |
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
