# B.1 â Static availability review

- `AvailabilityService.getAvailableSlots` resolves variant `service_duration_minutes` and `buffer_minutes`, falling back to the product values and then the existing defaults.
- Station availability intersects active provider schedules, station schedules, store business hours, local station/provider exceptions, active station/provider allocations and legacy bookings. A provider allocation is checked across all compatible stations, so it cannot appear free at another station for the same interval.
- Stations without an active schedule block for a weekday yield no slots. A station exception overlapping the candidate UTC interval also removes the slot.
- Date-only input is validated and ranges over 62 days are rejected. SQL indexes cover `(store_id, station_id, start_at)` and `(store_id, provider_id, start_at)` on allocations.
- Candidate wall-clock times are converted through the store's IANA timezone to UTC. No volume, DST, midnight-boundary or live database test was run; those remain D.1 work.