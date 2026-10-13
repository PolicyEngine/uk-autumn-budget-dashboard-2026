FROM python:3.13-slim

WORKDIR /app

# Install git (required for policyengine-uk git dependency)
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy everything needed for install
COPY pyproject.toml uv.lock ./
COPY src/ ./src/

# Install dependencies and the package
RUN uv sync --frozen --no-dev

# Build identity reported by /api/version for deployed-route checks
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}

# Cloud Run uses PORT env var
ENV PORT=8080

EXPOSE 8080

# Run with uvicorn
CMD ["uv", "run", "uvicorn", "uk_budget_data.api:app", "--host", "0.0.0.0", "--port", "8080"]
