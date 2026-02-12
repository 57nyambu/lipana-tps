# SPDX-License-Identifier: Apache-2.0
FROM python:3.12-slim

LABEL maintainer="lipana-tps"
LABEL description="Lipana TPS — Tazama Transaction Processing Service"
LABEL version="1.0.0"
LABEL url="https://tazama.lipana.co"

WORKDIR /opt/lipana-tps

# OS deps for psycopg2
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code, templates, and static assets
COPY app/ app/

# Non-root user
RUN useradd -r -s /usr/sbin/nologin lipana && chown -R lipana:lipana /opt/lipana-tps
USER lipana

EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8100/health || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
