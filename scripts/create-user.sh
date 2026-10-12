#!/bin/sh
# Creates an account without a password; the user sets it on first login.
# Usage: scripts/create-user.sh <id> [budget]   (budget: 150% of the default, $1 per day, or unlimited; default 100%)
set -e
[ -n "$1" ] || { echo "사용법: $0 <아이디> [한도: 150% | \$1 | unlimited, 기본 100%]" >&2; exit 1; }
cd "$(dirname "$0")/.."
exec bun scripts/users.ts create "$@"
