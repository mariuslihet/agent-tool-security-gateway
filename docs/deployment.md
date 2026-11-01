# Deployment and operations

## Local use

`npm run init` writes a fresh `.env` exclusively and refuses to overwrite one. Four independent random values protect storage, agent access, operator access and read-only viewer access. The viewer credential is optional for existing installations. Use a private directory and OS ACLs; POSIX mode bits passed by Node do not replace Windows ACL configuration.

`npm start` binds loopback by default. The HTTP server uses bearer authentication, strict roles, bounded bodies, request/header timeouts, no CORS wildcard and a restrictive dashboard CSP. Keep it local unless a TLS endpoint and authenticated access boundary have been configured.

## Container

```sh
docker compose up --build
```

Create `.env` first with Node. The Compose example reads it at runtime, mounts only persistent state, drops Linux capabilities, uses a read-only root filesystem, limits memory/PIDs/CPU and publishes the service on host loopback. Its internal network disables ordinary Internet egress. Configure a dedicated network egress proxy/firewall before installing a real outbound adapter; do not broadly enable network access to satisfy one tool.

The base image tracks Node's 24.x line. For production, pin an independently verified image digest in your deployment and update through security review. Docker was not assumed available during local verification; run the container smoke test in your deployment environment.

## Protect the enforcement boundary

Run the agent and gateway with different credentials/OS identities. Only the gateway may access protected resources. Mount documents and tool artifacts read-only. Keep the master key, policy and tool configuration inaccessible to the agent. Do not grant a competing shell, browser or generic HTTP tool that can reach the same protected resources outside the gateway.

Capabilities are scoped to tasks; creating a root session must remain a trusted runtime decision. Use separate authenticated profiles for separate users/tenants. Add enterprise authentication in front of the reference API and map verified claims to configured profiles; never trust client-supplied principal headers without verifying their issuer and audience.

## Audit verification and backups

```sh
node --env-file=.env src/cli.js verify-audit
```

This prints chain validity, event count and final signed checkpoint. Store checkpoints in a separate controlled system. A valid local chain alone cannot detect deletion of its latest valid records or rollback to an older complete database.

Back up the SQLite database and its WAL consistently, or use SQLite's backup facilities while the service is running. Keep encrypted backups and the master key separately protected. The service refuses a different master key. In-place key rotation and re-encryption are not automated; plan a controlled migration rather than replacing the key and attempting to reopen the old database.

## Failure handling

1. **Uncertain execution:** Do not retry with a new ID. Inspect the target service's transaction/idempotency record, revoke the session/task tree, and record the operator's reconciliation externally before starting a newly authorized task.
2. **Audit verification failure:** Stop execution and investigate. Do not delete audit records or regenerate the key to silence the failure.
3. **Notification outage:** Pending operations remain pending. Use the local queue or restore the notifier. Notification acknowledgements never authorize execution.
4. **Compromised token:** Revoke the principal/session in the operator API and replace the corresponding configured HTTP credential. Restart the reference host to load new credentials.
5. **Policy or profile change:** Existing sessions intentionally fail with `CONFIGURATION_CHANGED`. Review pending work and create fresh task sessions under the new configuration.

## Scale and retention

SQLite is intended for a single host with shared local durable storage. Multi-process reservation is tested; cross-host network-filesystem durability and distributed leader election are not implemented. Do not place SQLite on a network filesystem as a substitute for a distributed state store.

The reference service retains sessions, request results and audit records. Apply deployment-specific retention and archival under operator control; do not prune active idempotency records or approval bindings. Cursor pagination and bounded JSONL export are available; continuous export and a distributed metrics backend remain extension areas. Full-chain verification runs at startup and on explicit request; normal refresh checks the tail and uses indexed tenant statistics. Plan full-verification cost and backup/checkpoint schedules for large logs.
