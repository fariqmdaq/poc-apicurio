# Apicurio + RabbitMQ POC

POC for Apicurio Integration with RabbitMQ, demonstrating schema registry, validation compatibility.

## Tech requirements
- Bun v1.3+
- RabbitMQ
- Apicurio Registry

## Running Apicurio on Local

```
docker run -it -p 8080:8080 apicurio/apicurio-registry:3.1.2
```

```
docker run -it -p 8888:8080 apicurio/apicurio-registry-ui:3.1.2
```


## End to End Demo
End to End script that registers v1, starts subscriber, publish v1, register v2, publish v2, publish v1 to prove compabitibility
```bash
bun run demo:e2e
```

## Run locally
1) `bun install`  
2) Register v1 schema.  
3) Start subscriber: `bun run dev:subscriber`  
4) Start publisher HTTP server: `bun run dev:publisher`  
5) Publish sample payloads: `curl -X POST http://localhost:3000/publish/v1`

## Register schema
- Compatibility Check: `bun run register:schema --file=schemas/user-created.v1.json --artifactId=user-created --dry-run`
- Register v1 schema: `bun run register:schema --file=schemas/user-created.v1.json --artifactId=user-created`
- Register v2 schema (adds optional `email`): `bun run register:schema --file=schemas/user-created.v2.json --artifactId=user-created`

## Check Schema Compatibility
- Create new version or update current schema on `schemas/`
- Commit the changes
- run `bun run ci:check-schemas`

## Generate types
Pull schemas from Apicurio and generate `types/generated/*.d.ts`:
```bash
bun run codegen
```

## Architecture
```mermaid
flowchart LR
  subgraph ControlPlane[Control Plane]
    Dev[Schemas in Git] --> CI["check-schemas<br/>(dry-run)"]
    CI -->|compatibility + register| Apicurio[(Apicurio Registry)]
    Dev -->|codegen| Types[types/generated/*.d.ts]
  end

  subgraph DataPlane[Data Plane]
    Pub[Publisher HTTP service] -->|JSON + x-schema-id| Rabbit[(RabbitMQ topic exchange)]
    Rabbit --> Sub[Subscriber]
  end

  Apicurio <--> Pub
  Apicurio <--> Sub
```

## Schema Update & Compatibility Flow

```mermaid
sequenceDiagram
  participant Dev
  participant CI as CI/check-schemas
  participant Registry as Apicurio Registry
  participant Pub as Publisher
  participant Sub as Subscriber

  Note over Dev,Sub: Initial version (v1)
  Dev->>Registry: Register schema v1 (user-created.v1)
  Pub->>Registry: getGlobalId(branch=latest=1)
  Pub->>Sub: Publish v1 payload (x-schema-id=1)
  Sub->>Registry: getSchemaByGlobalId(1) on first message
  Sub->>Sub: Validate + ack

  Note over Dev,Sub: Add compatible v2
  Dev->>CI: Propose schema v2 (adds optional email)
  CI->>Registry: compatibility check
  alt Compatible
    CI->>Registry: Register schema v2 -> new globalId
    Pub-->>Pub: Restart/refresh cache, resolve latest id
    Pub->>Sub: Publish v2 payload (x-schema-id=2)
    Sub->>Registry: Fetch schema for v2
    Sub->>Sub: Validate + ack
    Pub->>Sub: Publish v1 payload after v2 rollout (x-schema-id=1)
    Sub->>Registry: Fetch schema for v1
    Sub->>Sub: Validate against v1 + ack
  else Breaking
    CI-->>Dev: Reject change, adjust schema
  end
```
