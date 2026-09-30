# ADR 0001: feature-owned server and outbound runners

Status: engineering design draft. Vite + Fastify was confirmed on 2026-09-30. Implementation evidence is pending.

## Decision

Use a TypeScript workspace with a React/Vite dashboard, a Fastify server, separate Linux runners, PostgreSQL, and artifact storage. Vite builds static frontend assets. Fastify serves those assets and the API as one hosted deployment.

Feature modules own their operations, SQL, and tests. Shared packages contain genuine cross-process contracts rather than a universal domain/service/repository framework.

Separate immutable execution inputs from mutable runtime ownership. Store accepted outcomes transactionally and keep artifact bytes outside database rows.

## Why

Both browsers and runners use the API. An explicit HTTP boundary keeps UI rendering independent of work delivery and makes runner requests testable without the dashboard.

A single TypeScript toolchain reduces duplicated schemas and tooling. Feature ownership limits the files an agent needs to inspect for a behavior change. PostgreSQL keeps related ownership and publication conditions inside one transaction.

## Alternatives

| Alternative | Tradeoff |
| --- | --- |
| Next.js alone | Integrated UI and route conventions; viable, but the current dashboard does not need server rendering and the explicit API boundary is preferred |
| Static viewer importing run bundles | Small initial deployment, but shared evaluation state and duplicate/recovery handling require extra reconciliation |
| Durable workflow engine | Provides scheduling/history, but introduces another persistence model and operational dependency |
| Local database with synchronization | Supports offline ownership, but adds conflict resolution and synchronization behavior |

## Consequences

Development and integration tests require PostgreSQL. Runners own durable report spools and subprocess lifetime.

Polling works without inbound laptop connectivity but adds delivery latency. Idempotent acceptance does not guarantee exactly-once external execution.

Keep hosting and module boundaries small. Revisit the decision when implementation evidence demonstrates a concrete constraint; update the affected contract and tests with the change.
