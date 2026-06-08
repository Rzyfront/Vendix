# States — Vendix on Quickss

These seven states are the **complete** set. Workflow order is by `position`.

| Position | Name        | Type        | ID                                       |
| -------- | ----------- | ----------- | ---------------------------------------- |
| 0        | Backlog     | `backlog`   | `4b74cd22-2daa-4220-bccc-002a6b4121de`   |
| 1        | Todo        | `unstarted` | `1c3e8e81-3fa4-46fa-9674-0d46e6bb003f`   |
| 2        | In Progress | `started`   | `e24cd9a7-66db-4e49-93cb-d3f1c99df2f7`   |
| 1002     | In Review   | `started`   | `d123e233-1f17-422e-b7c0-06f463e798df`   |
| 3        | Done        | `completed` | `30f4c5c5-e1de-43a7-b00e-b737fc6e73a4`   |
| 4        | Canceled    | `canceled`  | `6081e147-8c02-4531-9437-e9d6115559fd`   |
| 5        | Duplicate   | `duplicate` | `226e301e-6078-4ebd-81b2-d0177d2683ac`   |

Defaults:

- New issues land in `Todo` (`1c3e8e81-3fa4-46fa-9674-0d46e6bb003f`) unless
  the user specifies otherwise
- "Open" / "active" issues = everything except `Done`, `Canceled`, `Duplicate`
  (filter by `state.type neq "completed"` and exclude the canceled and
  duplicate types in code if needed)

Note on `In Review`: its position (1002) is a Linear quirk — workflow order
is still Backlog → Todo → In Progress → In Review → Done, but the
underlying `position` numbers are not strictly sequential.
