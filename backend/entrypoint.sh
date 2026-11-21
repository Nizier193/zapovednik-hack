#!/usr/bin/env sh
set -e

echo "[entrypoint] applying alembic migrations..."
# На первом старте postgres может ещё инициализироваться — пробуем несколько раз.
n=0
until alembic upgrade head; do
  n=$((n + 1))
  if [ "$n" -ge 30 ]; then
    echo "[entrypoint] alembic failed after $n attempts" >&2
    exit 1
  fi
  echo "[entrypoint] postgres not ready yet, retry $n/30 in 2s..."
  sleep 2
done

echo "[entrypoint] starting application..."
exec python -u app/main.py
