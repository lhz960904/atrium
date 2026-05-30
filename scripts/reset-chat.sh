#!/usr/bin/env bash
# Reset only the chat data (threads / messages / artifacts) in the dev DB,
# leaving providers (your API keys), app settings, and migration history
# intact. Use after a message-shape change so you don't re-enter keys.
#
# Quit the app first (WAL writers must be closed).
set -euo pipefail

DB="$HOME/Library/Application Support/Atrium/atrium.db"

if [ ! -f "$DB" ]; then
  echo "No DB at $DB — nothing to reset."
  exit 0
fi

sqlite3 "$DB" <<'SQL'
DELETE FROM artifacts;
DELETE FROM messages;
DELETE FROM threads;
SQL

echo "Cleared threads / messages / artifacts. Providers + settings kept."
