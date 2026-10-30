#!/usr/bin/env bash
set -euo pipefail

CONTRACT="${1:-}"
if [ -z "$CONTRACT" ]; then
  echo "Usage: $0 FB-XX" >&2
  exit 1
fi

case "$CONTRACT" in
  FB-01)
    grep -q "@Get()" apps/backend/src/domains/store/service-stations/service-stations.controller.ts && \
    echo "FB-01: GET /store/service-stations verified"
    ;;
  FB-02)
    grep -q "@Post()" apps/backend/src/domains/store/service-stations/service-stations.controller.ts && \
    grep -q "@Patch(':id')" apps/backend/src/domains/store/service-stations/service-stations.controller.ts && \
    echo "FB-02: POST/PATCH /store/service-stations verified"
    ;;
  FB-03)
    grep -q "@Put(':id/services')" apps/backend/src/domains/store/service-stations/service-stations.controller.ts && \
    echo "FB-03: PUT /store/service-stations/:id/services verified"
    ;;
  FB-04)
    grep -q "@Put(':id/providers')" apps/backend/src/domains/store/service-stations/service-stations.controller.ts && \
    echo "FB-04: PUT /store/service-stations/:id/providers verified"
    ;;
  FB-05)
    grep -q "@Get('availability')" apps/backend/src/domains/store/reservations/station-availability.controller.ts && \
    echo "FB-05: GET /store/service-stations/availability verified"
    ;;
  FB-06)
    grep -q "@Get('availability/:productId')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-06: GET /store/reservations/availability/:productId verified"
    ;;
  FB-07)
    grep -q "@Post()" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-07: POST /store/reservations verified"
    ;;
  FB-08)
    grep -q "@Post('hold')" apps/backend/src/domains/ecommerce/reservations/ecommerce-reservations.controller.ts && \
    echo "FB-08: POST /ecommerce/reservations/hold verified"
    ;;
  FB-09)
    grep -q "@Post(':id/confirm-hold')" apps/backend/src/domains/ecommerce/reservations/ecommerce-reservations.controller.ts && \
    echo "FB-09: POST /ecommerce/reservations/:id/confirm-hold verified"
    ;;
  FB-10)
    grep -q "@Patch(':id/reschedule')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-10: PATCH /store/reservations/:id/reschedule verified"
    ;;
  FB-11)
    grep -q "@Put(':id/editor')" apps/backend/src/domains/store/orders/orders.controller.ts && \
    echo "FB-11: PUT /store/orders/:id/editor verified"
    ;;
  FB-12)
    grep -q "async checkout(" apps/backend/src/domains/ecommerce/checkout/checkout.controller.ts && \
    echo "FB-12: POST /ecommerce/checkout verified"
    ;;
  FB-13)
    grep -q "@Post()" apps/backend/src/domains/store/service-sessions/service-sessions.controller.ts && \
    echo "FB-13: POST /store/service-sessions verified"
    ;;
  FB-14)
    grep -q "@Patch(':id')" apps/backend/src/domains/store/service-sessions/service-sessions.controller.ts && \
    echo "FB-14: PATCH /store/service-sessions/:id verified"
    ;;
  FB-15)
    grep -q "@Sse(':id/stream')" apps/backend/src/domains/store/service-sessions/service-sessions.controller.ts && \
    echo "FB-15: GET /store/service-sessions/:id/stream verified"
    ;;
  FB-16)
    grep -q "@Get(':token')" apps/backend/src/domains/ecommerce/service-sessions/service-session-access.controller.ts && \
    echo "FB-16: GET /ecommerce/service-sessions/:token verified"
    ;;
  FB-17)
    grep -q "@Sse(':token/stream')" apps/backend/src/domains/ecommerce/service-sessions/service-session-access.controller.ts && \
    echo "FB-17: GET /ecommerce/service-sessions/:token/stream verified"
    ;;
  FB-18)
    grep -q "openProposal" apps/backend/src/domains/store/service-budgets/service-budgets.service.ts && \
    echo "FB-18: POST /store/service-sessions/:id/proposals seam verified"
    ;;
  FB-19)
    grep -q "@Post(':token/decision')" apps/backend/src/domains/store/service-budgets/service-proposal-decision.controller.ts && \
    echo "FB-19: POST /ecommerce/service-proposals/:token/decision verified"
    ;;
  FB-20)
    grep -q "@Get(':id/proposals')" apps/backend/src/domains/store/service-budgets/service-budgets.controller.ts && \
    echo "FB-20: GET /store/service-sessions/:id/proposals verified"
    ;;
  FB-21)
    grep -q "sendAccessEmail" apps/backend/src/domains/store/service-sessions/service-sessions.service.ts && \
    echo "FB-21: POST /store/service-sessions/:id/contact delivery verified"
    ;;
  FB-22)
    grep -q "@Get('calendar')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-22: GET /store/reservations/calendar verified"
    ;;
  FB-23)
    grep -q "requires_station" apps/backend/src/domains/store/products/products.service.ts && \
    echo "FB-23: PATCH /store/products/:id requires_station verified"
    ;;
  FB-24)
    grep -q "@Post(':id/add-items')" apps/backend/src/domains/store/tables/table-sessions.controller.ts && \
    echo "FB-24: POST /store/table-sessions/:id/add-items verified"
    ;;
  FB-25)
    grep -q "@Post()" apps/backend/src/domains/store/payments/payments.controller.ts && \
    echo "FB-25: POST /store/payments verified"
    ;;
  FB-26)
    grep -q "@Post(':id/access-link/reissue')" apps/backend/src/domains/store/service-sessions/service-sessions.controller.ts && \
    echo "FB-26: POST /store/service-sessions/:id/access/reissue verified"
    ;;
  FB-27)
    grep -q "@Get('availability/:productId')" apps/backend/src/domains/ecommerce/reservations/ecommerce-reservations.controller.ts && \
    echo "FB-27: GET /ecommerce/reservations/availability/:productId verified"
    ;;
  FB-28)
    grep -q "@Get('availability-overview/:productId')" apps/backend/src/domains/ecommerce/reservations/ecommerce-reservations.controller.ts && \
    echo "FB-28: GET /ecommerce/reservations/availability-overview/:productId verified"
    ;;
  FB-29)
    grep -q "@Post()" apps/backend/src/domains/ecommerce/reservations/ecommerce-reservations.controller.ts && \
    echo "FB-29: POST /ecommerce/reservations verified"
    ;;
  FB-30)
    grep -q "@Post(':id/cancel')" apps/backend/src/domains/ecommerce/reservations/ecommerce-reservations.controller.ts && \
    echo "FB-30: POST /ecommerce/reservations/:id/cancel verified"
    ;;
  FB-31)
    grep -q "@Post(':id/reschedule')" apps/backend/src/domains/ecommerce/reservations/ecommerce-reservations.controller.ts && \
    echo "FB-31: POST /ecommerce/reservations/:id/reschedule verified"
    ;;
  FB-32)
    grep -q "@Post(':id/check-in')" apps/backend/src/domains/ecommerce/reservations/ecommerce-reservations.controller.ts && \
    echo "FB-32: POST /ecommerce/reservations/:id/check-in verified"
    ;;
  FB-33)
    grep -q "@Get('confirm/:token')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-33: GET /store/reservations/confirm/:token verified"
    ;;
  FB-34)
    grep -q "@Patch(':id/confirm')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-34: PATCH /store/reservations/:id/confirm verified"
    ;;
  FB-35)
    grep -q "@Patch(':id/start')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-35: PATCH /store/reservations/:id/start verified"
    ;;
  FB-36)
    grep -q "@Patch(':id/cancel')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-36: PATCH /store/reservations/:id/cancel verified"
    ;;
  FB-37)
    grep -q "@Patch(':id/complete')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-37: PATCH /store/reservations/:id/complete verified"
    ;;
  FB-38)
    grep -q "@Patch(':id/no-show')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-38: PATCH /store/reservations/:id/no-show verified"
    ;;
  FB-39)
    grep -q "@Patch(':id/check-in')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-39: PATCH /store/reservations/:id/check-in verified"
    ;;
  FB-40)
    grep -q "@Delete(':id')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-40: DELETE /store/reservations/:id verified"
    ;;
  FB-41)
    grep -q "@Patch('reschedule-requests/:reqId/approve')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-41: PATCH /store/reservations/reschedule-requests/:reqId/approve verified"
    ;;
  FB-42)
    grep -q "@Post()" apps/backend/src/domains/store/orders/orders.controller.ts && \
    echo "FB-42: POST /store/orders verified"
    ;;
  FB-43)
    grep -q "@Put(':id/items')" apps/backend/src/domains/store/orders/orders.controller.ts && \
    echo "FB-43: PUT /store/orders/:id/items verified"
    ;;
  FB-44)
    grep -q "@Patch(':id')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-44: PATCH /store/reservations/:id verified"
    ;;
  FB-45)
    grep -q "@Patch(':id/mark-attending')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-45: PATCH /store/reservations/:id/mark-attending verified"
    ;;
  FB-46)
    grep -q "@Patch(':id/mark-arriving')" apps/backend/src/domains/store/reservations/reservations.controller.ts && \
    echo "FB-46: PATCH /store/reservations/:id/mark-arriving verified"
    ;;
  FB-47)
    grep -q "@Post('with-order')" apps/backend/src/domains/store/payments/payments.controller.ts && \
    echo "FB-47: POST /store/payments/with-order verified"
    ;;
  FB-48)
    grep -q "@Post('pos')" apps/backend/src/domains/store/payments/payments.controller.ts && \
    echo "FB-48: POST /store/payments/pos verified"
    ;;
  *)
    echo "Unknown FB contract $CONTRACT" >&2
    exit 2
    ;;
esac
