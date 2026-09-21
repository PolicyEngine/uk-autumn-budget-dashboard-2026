.PHONY: dev api frontend install format test build deploy

# Run both frontend and backend for local development
dev:
	@echo "Starting backend (Docker) and frontend (npm)..."
	docker compose up -d
	npm run dev

# Run just the API in Docker
api:
	docker compose up

# Run just the frontend
frontend:
	npm run dev

# Install dependencies
install:
	uv sync
	npm install

# Format code
format:
	uv run ruff format src/ tests/
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
