.PHONY: dev api frontend install format test build deploy

# Run both frontend and backend for local development
dev:
	@echo "Starting backend (Docker) and frontend (bun)..."
	docker compose up -d
	bun run dev

# Run just the API in Docker
api:
	docker compose up

# Run just the frontend
frontend:
	bun run dev

# Install dependencies
install:
	uv sync --locked --extra dev
	bun install --frozen-lockfile

# Format code
format:
	uv run black src/ tests/
	uv run ruff check --fix src/ tests/

# Run tests
test:
	uv run pytest

# Build Docker image
build:
	docker build -t uk-budget-api-2026 .

# Stop Docker services
stop:
	docker compose down
