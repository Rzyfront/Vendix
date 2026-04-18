#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "=== ZONELESS AUDIT ==="

FACADE_TOSIGNAL=$(grep -rEn "toSignal\(\s*this\.\w+\$\s*\)" apps/frontend/src/app --include="*.facade.ts" | grep -v "\.spec\.ts" | wc -l)
echo "Facades toSignal sin initialValue: $FACADE_TOSIGNAL"

COMP_TOSIGNAL=$(grep -rEn "toSignal\(\s*this\.\w+\$\s*\)" apps/frontend/src/app --include="*.component.ts" | grep -v "\.spec\.ts" | wc -l)
echo "Componentes toSignal sin initialValue: $COMP_TOSIGNAL"

CONSTRUCTOR_ASYNC=$(grep -rln "constructor\s*(" apps/frontend/src/app --include="*.component.ts" | xargs grep -lnE "\.dispatch\(|load\w*\(|getCurrent\w*\(" 2>/dev/null | wc -l)
echo "Constructor con dispatch/load: $CONSTRUCTOR_ASYNC"

SUBSCRIBE_LEAKS=$(grep -rln "\.subscribe(" apps/frontend/src/app --include="*.component.ts" | xargs grep -L "takeUntilDestroyed\|takeUntil\(destroy" 2>/dev/null | wc -l)
echo "Subscribe sin takeUntilDestroyed: $SUBSCRIBE_LEAKS"

LEGACY_INPUT=$(grep -rln "@Input\|@Output\|EventEmitter\|NgZone\|markForCheck\|detectChanges" apps/frontend/src/app --include="*.ts" | grep -v app.config.ts | wc -l)
echo "Legacy patterns: $LEGACY_INPUT"

ASYNC_PIPE=$(grep -rlE "\| async" apps/frontend/src/app --include="*.html" | wc -l)
echo "Async pipe: $ASYNC_PIPE"

NGIF_NGFOR=$(grep -rlE "\*ngIf|\*ngFor" apps/frontend/src/app --include="*.html" --include="*.ts" | wc -l)
echo "*ngIf/*ngFor: $NGIF_NGFOR"

SIGNAL_NO_CALL=$(grep -rnE "(!|if\s*\(|while\s*\()this\.(disabled|loading|readonly|isOpen|saving|submitted|required)\s*(\)|&&|\|\||\s*$)" apps/frontend/src/app --include="*.ts" | grep -vE "this\.\w+\(" | wc -l)
echo "Signal sin invocar: $SIGNAL_NO_CALL"

BEHAVIOR_SUBJECT=$(grep -rl "BehaviorSubject\|new Subject<" apps/frontend/src/app --include="*.component.ts" | wc -l)
echo "BehaviorSubject en componentes: $BEHAVIOR_SUBJECT"

DEFER_VIEWPORT=$(grep -rlE "@defer\s*\(on\s+viewport\)" apps/frontend/src/app --include="*.html" | wc -l)
echo "@defer on viewport: $DEFER_VIEWPORT"

echo ""
TOTAL=$((FACADE_TOSIGNAL + COMP_TOSIGNAL + CONSTRUCTOR_ASYNC + SUBSCRIBE_LEAKS + LEGACY_INPUT + ASYNC_PIPE + NGIF_NGFOR + SIGNAL_NO_CALL + BEHAVIOR_SUBJECT + DEFER_VIEWPORT))
echo "Total issues: $TOTAL"

if [ $TOTAL -gt 0 ]; then
  echo "FAIL"
  exit 1
fi
echo "PASS"
exit 0