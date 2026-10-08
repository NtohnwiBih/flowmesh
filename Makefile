.PHONY: up down logs smoke migrate-new test run-engine run-worker run-api

up:
	docker compose up -d postgres redis minio
	docker compose run --rm migrate

down:
	docker compose down

logs:
	docker compose logs -f

smoke:
	set -a && . ./.env && set +a && cd engine && go run ./cmd/smoke

migrate-new:
	migrate create -ext sql -dir db/migrations -seq $(name)

test:
	cd engine && go test ./...

run-engine:
	set -a && . ./.env && set +a && cd engine && go run ./cmd/engine

run-worker:
	set -a && . ./.env && set +a && cd engine && go run ./cmd/worker

run-api:
	set -a && . ./.env && set +a && cd api && .venv/bin/uvicorn app.main:app --reload