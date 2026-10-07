.PHONY: up down logs smoke migrate-new

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