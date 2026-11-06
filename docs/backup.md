# Encrypted backup and recovery

Backups are host-only operations over the entire gateway database, including every tenant. No HTTP or agent tool exposes archive creation or recovery. Use an operator-controlled directory with private permissions; do not place archives in the served `web` folder or commit them to Git.

The database is copied using the official [Node.js SQLite online backup API](https://nodejs.org/download/release/v24.2.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options). It captures committed SQLite/WAL state instead of copying the main file while writes may still be in the WAL. The source can remain open, but large or frequently changing databases may make the snapshot take longer.

## Commands

Provide `GATEWAY_MASTER_KEY` through the existing local environment and `GATEWAY_BACKUP_PASSPHRASE` through a secure terminal/session environment. Do not pass secrets as command-line arguments, paste them into chat, or save them in a checked-in script. The recovery passphrase must contain 16–1024 characters and be retained independently of the database master key.

```powershell
node --env-file=.env src/cli.js backup D:\private-backups\gateway.backup
node --env-file=.env src/cli.js verify-backup D:\private-backups\gateway.backup
node --env-file=.env src/cli.js restore-backup D:\private-backups\gateway.backup D:\recovery\gateway-restored.sqlite
```

Existing files are never overwritten. Restore also refuses a target with pre-existing SQLite `-wal`, `-shm` or `-journal` sidecars. Parent directories must already exist and be controlled by the operator. Symlink/junction parent paths are rejected rather than silently following them to another directory. Keep target paths portable and ordinary; this host command is not available to model output.

## Encryption and verification

- The complete snapshot is encrypted using AES-256-GCM with fresh random salt and nonce. The version/algorithm/KDF header is authenticated as additional data.
- The recovery key is derived with fixed scrypt parameters (`N=32768`, `r=8`, `p=1`, 32-byte key). Archives cannot choose expensive KDF parameters.
- The existing database master key is **not embedded**. Both the recovery passphrase and the original database master key are needed to verify or restore an archive.
- Archive files contain only a strict versioned envelope and ciphertext. The database snapshot is limited to 64 MiB; the encoded archive is limited to 90 MiB. Oversized databases require an operator-managed backup approach beyond this reference implementation.
- Verification authenticates the archive, checks SQLite integrity, validates the complete signed audit chain, opens all encrypted `data` records and checks tenant/key bindings. This detects corruption; it is not a functional recovery test of external services or a guarantee against every malformed application record.
- `verify-backup` uses a private temporary copy, does not create a restored database and does not modify the archive or live store.

Temporary snapshots are created beneath the host's temporary directory and removed in normal success/failure cleanup. That directory must be protected by the host OS. Cleanup is not secure erasure; encrypted disks and appropriate filesystem permissions remain deployment responsibilities.

Successful creation appends `backup.created` to the live signed audit chain under the host `system` scope. It contains the encrypted archive hash, byte count and captured audit checkpoint, without raw paths, credentials or contents. Mandatory audit failure removes the new artifact. Because this event is appended after the snapshot is finalized, that creation event is not itself inside that archive.

## Recovery behavior

Restore writes a **new database** and does not replace or reconfigure the running service. Its audit chain gains `backup.restored`; agent and evaluation runtime leases are cleared so queued/running work is interrupted. Nothing resumes automatically.

Request reservations, pending/decided approvals, sessions, capability grants and task budgets remain as captured. External effects may have occurred after the snapshot. Before pointing a service at a recovered database, stop the old service, reconcile uncertain/previously executed requests, review approval expiry and session configuration, and revoke any stale approvals or sessions as appropriate. A historical restore must not be used to repeat payments, publishes or other external actions.

Keep independent copies of the passphrase and master key, then periodically verify an archive and exercise recovery in an isolated directory. The archive covers database state only: `.env`, reviewed workspace files, saved reports, connector databases/configuration and Ollama models require separate operator backups.

## Host API

```js
await createBackup({ store, output: 'gateway.backup', passphrase });
await restoreBackup({ input: 'gateway.backup', passphrase, masterKey, verifyOnly: true });
await restoreBackup({ input: 'gateway.backup', output: 'restored.sqlite', passphrase, masterKey });
```

Import from `src/backup.js`. The functions return hashes and verification counts, never passphrases or database contents. They fail closed on wrong secrets, invalid envelopes, corrupted snapshots or existing targets.
