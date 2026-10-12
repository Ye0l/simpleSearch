#!/bin/sh
# Changes an account's daily usage budget (estimated API cost).
# Usage: scripts/set-limit.sh <id> <budget>   (budget: 150% of the default, $1 per day, or unlimited)
set -e
[ -n "$1" ] && [ -n "$2" ] || { echo "사용법: $0 <아이디> <한도: 150% | \$1 | unlimited>" >&2; exit 1; }
cd "$(dirname "$0")/.."
exec bun scripts/users.ts limit "$@"
