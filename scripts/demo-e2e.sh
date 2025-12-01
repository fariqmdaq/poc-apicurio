#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-demo-$(date +%s)-$RANDOM}"
ARTIFACT_ID="${ARTIFACT_ID:-user-created-${RUN_ID}}"
RABBITMQ_EXCHANGE="${RABBITMQ_EXCHANGE:-event-exchange}"
RABBITMQ_QUEUE="${RABBITMQ_QUEUE:-event-queue}"
PUBLISHER_PORT_V1="${PUBLISHER_PORT_V1:-3000}"
PUBLISHER_PORT_V2="${PUBLISHER_PORT_V2:-3001}"

export ARTIFACT_ID
export RABBITMQ_EXCHANGE
export RABBITMQ_QUEUE

echo "Using ARTIFACT_ID=${ARTIFACT_ID}, EXCHANGE=${RABBITMQ_EXCHANGE}, QUEUE=${RABBITMQ_QUEUE}"
echo "Publisher v1 port=${PUBLISHER_PORT_V1}, publisher v2 port=${PUBLISHER_PORT_V2}"

echo "[1/7] Register schema v1 for ${ARTIFACT_ID}"
bun run register:schema --file="schemas/user-created.v1.json" --artifactId="${ARTIFACT_ID}"

echo "[2/7] Start subscriber in background"
bun run dev:subscriber &
SUB_PID=$!

echo "[3/7] Start publisher in background"
PUBLISHER_PORT="${PUBLISHER_PORT_V1}" bun run dev:publisher &
PUB_PID=$!

sleep 2

echo "[4/7] Publish v1 via HTTP"
curl -X POST "http://localhost:${PUBLISHER_PORT_V1}/publish/v1"

sleep 2

echo "[5/7] Register schema v2"
bun run register:schema --file="schemas/user-created.v2.json" --artifactId="${ARTIFACT_ID}"

sleep 3

echo "[6/7] Start publisher v2 in background"
PUBLISHER_PORT="${PUBLISHER_PORT_V2}" bun run dev:publisher &
PUB_PID_V2=$!

sleep 3

echo "[7/7] Publish v2 via HTTP"
curl -X POST "http://localhost:${PUBLISHER_PORT_V2}/publish/v2"

echo "[7/7] Publish v1 via HTTP"
curl -X POST "http://localhost:${PUBLISHER_PORT_V1}/publish/v1"

sleep 5

echo "Stopping subscriber and publisher..."
kill -INT "$SUB_PID"
kill -INT "$PUB_PID"
kill -INT "$PUB_PID_V2"
