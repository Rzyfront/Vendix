# A.3 â Permission matrix (static review)

| Resource/action | API surface | Permission | State |
|---|---|---|---|
| Station read | List/detail/schedules/exceptions | `store:reservations:read` | Implemented, store scoped |
| Station create | `POST /store/service-stations` | `store:reservations:create` | Implemented |
| Station update/configure | `PATCH` and service/provider/schedule/exception writes | `store:reservations:update` | Implemented, store scoped |
| Station deactivate | `DELETE /store/service-stations/:id` | `store:reservations:delete` | Implemented as soft deactivation |
| Session read | List/detail/events | `store:reservations:read` | Implemented, store scoped |
| Session create | `POST /store/service-sessions` | `store:reservations:create` | Implemented |
| Session transition/extend/reissue link | `PATCH` and access-link reissue | `store:reservations:update` | Implemented, store scoped |
| Proposal read | `GET /store/service-sessions/:id/proposals` | `store:reservations:read` | Implemented |
| Proposal create/apply | No staff endpoint | â | Pending B.4 quote and transactional apply; approval is consent only (F-017) |
| Customer proposal decision | OTP challenge/decision endpoints | Session capability token + one-time email OTP | Implemented; runtime verification pending |
| Contact customer | No dedicated contact endpoint | â | Pending a defined channel/workflow; do not imply contact was sent |

`store:reservations:create`, `read`, `update`, and `delete` already exist in the permission seed. Owner/admin receive the full non-superadmin permission set; manager and supervisor receive reservation create/read/update; employee receives read/create only. No permission row or seed assignment was added by this change. This is a source review only; request-level authorization still needs D.1 verification.