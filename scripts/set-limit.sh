#!/bin/sh
# Changes an account's daily search limit.
# Usage: scripts/set-limit.sh <id> <daily_limit|unlimited>
set -e
[ -n "$1" ] && [ -n "$2" ] || { echo "사용법: $0 <아이디> <일일한도|unlimited>" >&2; exit 1; }
cd "$(dirname "$0")/.."
exec bun scripts/users.ts limit "$@"
