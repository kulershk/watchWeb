#!/bin/bash
docker compose --env-file docker/prod/.env -f docker/prod/docker-compose.yml up -d --build
