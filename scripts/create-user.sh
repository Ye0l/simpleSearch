#!/bin/sh
# Creates an account without a password; the user sets it on first login.
# Usage: scripts/create-user.sh <id> [daily_limit|unlimited]   (default limit: 100 searches/day)
set -e
[ -n "$1" ] || { echo "사용법: $0 <아이디> [일일한도=100|unlimited]" >&2; exit 1; }
cd "$(dirname "$0")/.."
exec bun scripts/users.ts create "$@"
