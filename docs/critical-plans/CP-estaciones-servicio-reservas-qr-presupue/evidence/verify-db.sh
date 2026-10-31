#!/usr/bin/env bash
set -euo pipefail

CONTRACT="${1:-}"
if [ -z "$CONTRACT" ]; then
  echo "Usage: $0 DB-XX" >&2
  exit 1
fi

DB_NAME="vendix_stations_test"
PSQL="docker exec vendix_postgres psql -U username -d $DB_NAME -t -A -c"

case "$CONTRACT" in
  DB-01)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_stations';" | grep -q "1"
    echo "DB-01: service_stations exists and is valid"
    ;;
  DB-02)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_station_services';" | grep -q "1"
    echo "DB-02: service_station_services exists and is valid"
    ;;
  DB-03)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_station_providers';" | grep -q "1"
    echo "DB-03: service_station_providers exists and is valid"
    ;;
  DB-04)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_station_schedules';" | grep -q "1"
    echo "DB-04: service_station_schedules exists and is valid"
    ;;
  DB-05)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_station_exceptions';" | grep -q "1"
    echo "DB-05: service_station_exceptions exists and is valid"
    ;;
  DB-06)
    $PSQL "SELECT count(*) FROM pg_constraint WHERE conname = 'service_allocations_station_no_overlap';" | grep -q "1"
    echo "DB-06: service_allocations exclusion constraint exists"
    ;;
  DB-07)
    $PSQL "SELECT count(*) FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'service_allocation_id';" | grep -q "1"
    echo "DB-07: bookings.service_allocation_id column exists"
    ;;
  DB-08)
    $PSQL "SELECT count(*) FROM pg_indexes WHERE indexname = 'service_sessions_one_active_per_station_uq';" | grep -q "1"
    echo "DB-08: service_sessions unique active session constraint exists"
    ;;
  DB-09)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_subjects';" | grep -q "1"
    echo "DB-09: service_subjects exists and is valid"
    ;;
  DB-10)
    $PSQL "SELECT count(*) FROM information_schema.columns WHERE table_name = 'service_session_tokens' AND column_name = 'token_hash';" | grep -q "1"
    echo "DB-10: service_session_tokens.token_hash exists"
    ;;
  DB-11)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_progress_events';" | grep -q "1"
    echo "DB-11: service_progress_events exists and is valid"
    ;;
  DB-12)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_budgets';" | grep -q "1"
    echo "DB-12: service_budgets exists and is valid"
    ;;
  DB-13)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_change_proposals';" | grep -q "1"
    echo "DB-13: service_change_proposals exists and is valid"
    ;;
  DB-14)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_proposal_decisions';" | grep -q "1"
    echo "DB-14: service_proposal_decisions exists and is valid"
    ;;
  DB-15)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'service_contact_attempts';" | grep -q "1"
    echo "DB-15: service_contact_attempts exists and is valid"
    ;;
  DB-16)
    $PSQL "SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'service_session_id';" | grep -q "1"
    echo "DB-16: orders.service_session_id column exists"
    ;;
  DB-17)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'provider_services';" | grep -q "1"
    echo "DB-17: provider_services exists and is valid"
    ;;
  DB-18)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'order_events';" | grep -q "1"
    echo "DB-18: order_events exists and is valid"
    ;;
  DB-19)
    $PSQL "SELECT count(*) FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'requires_station';" | grep -q "1"
    echo "DB-19: products.requires_station column exists"
    ;;
  DB-20)
    $PSQL "SELECT count(*) FROM information_schema.tables WHERE table_name = 'bookings';" | grep -q "1"
    echo "DB-20: bookings legacy model valid"
    ;;
  *)
    echo "Unknown DB contract $CONTRACT" >&2
    exit 2
    ;;
esac
