#!/usr/bin/env bash
# Prüft Migration + Zeilenschutz gegen ein lokales PostgreSQL (ohne Supabase): ./supabase/tests/run-local.sh
# Voraussetzung: PostgreSQL-Server-Binaries (z. B. /usr/lib/postgresql/16/bin). Die Datei stub.sql bildet Supabase-Rollen und auth.uid() nach.
set -euo pipefail
PGB="${PGB:-/usr/lib/postgresql/16/bin}"; D="$(mktemp -d)"; HERE="$(cd "$(dirname "$0")" && pwd)"
chmod 755 "$D"; cp "$HERE/stub.sql" "$HERE/rls.sql" "$HERE/../migrations/"*.sql "$D/"; chmod 644 "$D"/*.sql
RUN=""; [ "$(id -u)" = 0 ] && { chown -R postgres "$D"; RUN="runuser -u postgres --"; }
$RUN "$PGB/initdb" -D "$D/data" -A trust >/dev/null && $RUN "$PGB/pg_ctl" -D "$D/data" -o "-p 5599 -k $D" -l "$D/log" start >/dev/null; sleep 2
trap '$RUN "$PGB/pg_ctl" -D "$D/data" stop >/dev/null' EXIT
$RUN "$PGB/createdb" -h "$D" -p 5599 tt
Q="$RUN psql -h $D -p 5599 -d tt -X -q"
$Q -f "$D/stub.sql"; $Q -v ON_ERROR_STOP=1 -f "$D"/2*_init.sql; $Q -f "$D/rls.sql"
