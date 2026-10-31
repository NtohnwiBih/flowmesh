.PHONY: up down logs smoke migrate-new test test-engine test-api test-web \
        run-engine run-worker run-api run-web install-web check-web dump-catalog \
		seed-4d

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

# ---- tests ----------------------------------------------------------------
test: test-engine test-api test-web

test-engine:
	cd engine && go test ./...

test-api:
	cd api && .venv/bin/pytest -q

test-web:
	cd web && npm test

# Everything CI runs for the web app: lint, types, tests, production build.
check-web:
	cd web && npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run build

# ---- run the stack (one terminal each) ------------------------------------------
run-engine:
	set -a && . ./.env && set +a && cd engine && go run ./cmd/engine

run-worker:
	set -a && . ./.env && set +a && cd engine && go run ./cmd/worker

run-api:
	set -a && . ./.env && set +a && cd api && .venv/bin/uvicorn app.main:app --reload --port 8080

run-web:
	cd web && npm run dev

install-web:
	cd web && npm ci

dump-catalog:
	cd api && .venv/bin/python scripts/dump_catalog.py

seed-4d:
	bash scripts/seed-4d.sh