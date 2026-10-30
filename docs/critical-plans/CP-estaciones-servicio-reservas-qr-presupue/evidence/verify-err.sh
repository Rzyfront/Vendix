#!/usr/bin/env bash
set -euo pipefail

CONTRACT="${1:-}"
if [ -z "$CONTRACT" ]; then
  echo "Usage: $0 ERR-XX" >&2
  exit 1
fi

ERROR_CODES_FILE="apps/backend/src/common/errors/error-codes.ts"

case "$CONTRACT" in
  ERR-01) grep -q "STATION_001:" "$ERROR_CODES_FILE" && echo "ERR-01: STATION_001 defined" ;;
  ERR-02) grep -q "STATION_002:" "$ERROR_CODES_FILE" && echo "ERR-02: STATION_002 defined" ;;
  ERR-03) grep -q "STATION_003:" "$ERROR_CODES_FILE" && echo "ERR-03: STATION_003 defined" ;;
  ERR-04) grep -q "STATION_004:" "$ERROR_CODES_FILE" && echo "ERR-04: STATION_004 defined" ;;
  ERR-05) grep -q "STATION_005:" "$ERROR_CODES_FILE" && echo "ERR-05: STATION_005 defined" ;;
  ERR-06) grep -q "STATION_006:" "$ERROR_CODES_FILE" && echo "ERR-06: STATION_006 defined" ;;
  ERR-07) grep -q "STATION_007:" "$ERROR_CODES_FILE" && echo "ERR-07: STATION_007 defined" ;;
  ERR-08) grep -q "SERVICE_BUDGET_001:" "$ERROR_CODES_FILE" && echo "ERR-08: SERVICE_BUDGET_001 defined" ;;
  ERR-09) grep -q "SERVICE_BUDGET_002:" "$ERROR_CODES_FILE" && echo "ERR-09: SERVICE_BUDGET_002 defined" ;;
  ERR-10) grep -q "SERVICE_BUDGET_003:" "$ERROR_CODES_FILE" && echo "ERR-10: SERVICE_BUDGET_003 defined" ;;
  ERR-11) grep -q "SERVICE_BUDGET_004:" "$ERROR_CODES_FILE" && echo "ERR-11: SERVICE_BUDGET_004 defined" ;;
  ERR-12) grep -q "SERVICE_QR_001:" "$ERROR_CODES_FILE" && echo "ERR-12: SERVICE_QR_001 defined" ;;
  ERR-13) grep -q "SERVICE_CONTACT_001:" "$ERROR_CODES_FILE" && echo "ERR-13: SERVICE_CONTACT_001 defined" ;;
  ERR-14) grep -q "SERVICE_CONTACT_002:" "$ERROR_CODES_FILE" && echo "ERR-14: SERVICE_CONTACT_002 defined" ;;
  ERR-15) grep -q "SERVICE_BOOKING_001:" "$ERROR_CODES_FILE" && echo "ERR-15: SERVICE_BOOKING_001 defined" ;;
  ERR-16) grep -q "SERVICE_QR_002:" "$ERROR_CODES_FILE" && echo "ERR-16: SERVICE_QR_002 defined" ;;
  ERR-17) grep -q "STATION_008:" "$ERROR_CODES_FILE" && echo "ERR-17: STATION_008 defined" ;;
  ERR-18) grep -q "STATION_009:" "$ERROR_CODES_FILE" && echo "ERR-18: STATION_009 defined" ;;
  ERR-19) grep -q "SYS_UNAUTHORIZED_001:\|SYS_FORBIDDEN" "$ERROR_CODES_FILE" && echo "ERR-19: Permission error code defined" ;;
  ERR-20) grep -q "STATION_011:" "$ERROR_CODES_FILE" && echo "ERR-20: STATION_011 defined" ;;
  ERR-21) grep -q "STATION_012:" "$ERROR_CODES_FILE" && echo "ERR-21: STATION_012 defined" ;;
  *)
    echo "Unknown ERR contract $CONTRACT" >&2
    exit 2
    ;;
esac
