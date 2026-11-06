# Real read-only SQLite connectors

Operators can register fixed SQLite SELECT tools through a local host configuration file. These query an actual database, not demo records. Models receive a named tool and bounded input fields; they never supply SQL, a database filename, connection settings or credentials. This first connector supports local SQLite only, with no network or hosted account dependency.

Set `GATEWAY_CONNECTORS_FILE` to the host JSON configuration and restart. Relative database paths are resolved from that configuration file's directory. A registered query is exposed as `database.<id>`. Choose **Read-only tools** (`readonly`) when starting an agent task; it includes host-granted database reads without report saves, publishing or payments. All host-granted tools also includes connectors; safe/chat/workspace modes do not automatically acquire database permissions. Policy and profile grants still decide access. The host configuration must be reviewed and trusted.

## Try a real query with example data

From the repository, generate a new example directory:

```powershell
node scripts/create-connector-example.js .\connector-example
```

The script creates `inventory.sqlite`, `connector.json` and a fixture README, and fails if that directory already exists. It never reads `.env` or the gateway database. The records are explicitly labeled **example fixture data**: A1 is Paper with stock 24, B2 is Pencil with stock 80, and C3 is Marker with stock 0. Query execution is real SQLite access, while these inventory values are samples.

Set the configuration in your local `.env` and restart the gateway:

```dotenv
GATEWAY_CONNECTORS_FILE=connector-example/connector.json
```

In AI agent, select read-only tool access, enter “Use database.inventory to read SKU A1 and report its name and stock,” then review and start the task. The host grants only the fixed read query. The example deliberately uses `classification: "public"` because every included record is an explicit sample; use the sensitive default for a real data source until its contents have been reviewed.

## Host configuration

```json
{
  "version": 1,
  "connectors": [
    {
      "id": "catalog",
      "path": "data/catalog.sqlite",
      "description": "Find a reviewed catalog item by SKU.",
      "inputSchema": {
        "type": "object",
        "properties": { "sku": { "type": "string", "maxLength": 64 } },
        "required": ["sku"],
        "additionalProperties": false
      },
      "parameterNames": ["sku"],
      "sql": "SELECT title,stock FROM products WHERE sku=?",
      "classification": "sensitive",
      "maxRows": 100,
      "maxBytes": 8192,
      "timeoutMs": 3000
    }
  ]
}
```

The call `database.catalog({"sku":"A1"})` returns `{"text":"[{\"title\":\"Paper\",\"stock\":3}]"}`. Parameters are bound in `parameterNames` order, without interpolating strings into SQL. Every property must be required and listed once. Supported inputs are bounded strings, numbers, integers, booleans (bound as 0/1) and null. String inputs require explicit `maxLength` no greater than 8192.

## Classification and authority

`classification` defaults to `sensitive`. Protected results acquire the sensitive label and are withheld from model context by the existing runtime. The connector can be executed through an authorized gateway tool call, but confidential rows do not become model input merely because the model requested them.

Use `classification: "public"` only for content the host has reviewed as suitable model input, including provenance and prompt-injection concerns. Public designation removes that default output label; inherited session labels, output inspection and all other gateway restrictions continue to apply. Do not designate untrusted scraped content public simply to bypass withheld-data behavior.

Query text, canonical database location, limits and classification contribute to a binding in the tool fingerprint. Configuration changes require a host restart and invalidate capabilities pinned to the old registry. Metadata reports tool name, classification and limits without the database path or SQL. Tool descriptions should avoid embedding private configuration.

## Execution limits and recovery

- Configuration is at most 65,536 bytes and eight connectors. Each query is at most 8192 characters, begins with SELECT and contains no semicolon; WITH at the beginning and multiple statements are deliberately unsupported. Parameters may number up to 100.
- Results are at most 100 rows and 8192 UTF-8 bytes. Stricter positive host limits are allowed. Exceeding a limit fails the complete call; partial results are not delivered.
- Each query runs in a fixed child process with a 32 MB JavaScript heap limit and a host-controlled deadline of at most three seconds, including process startup. Timeouts and cancellation kill the worker. This prevents a slow synchronous SELECT from blocking the gateway event loop.
- SQLite opens read-only, with query-only mode, trusted schema disabled and extension loading disabled. The child does not inherit the host environment. Process isolation is not a general operating-system security boundary or a database security assessment.
- Only existing regular files with a single hard link are accepted. Symlinks, resolved-path changes, directory/file identity replacement and hard links are rejected. Host-controlled parent directories must not be writable by agents or untrusted operating-system processes. Normal data updates within the same database identity remain allowed.
- The configured gateway database must be denied by the host integration. Use a separate database or reviewed copy, never the gateway's own storage. Backup and restore are separate host operations.
- Query failures expose a structured connector error, not upstream SQL diagnostics. After a read failure, inspect the host configuration and data source. There are no automatic retries or writes.

SQLite files may contain views or sensitive columns beyond the selected query. Keep database ownership and fixed SELECT review under host control. No endpoint edits connector configuration or grants wider database access.

## Host integration

`loadConnectorConfig(path)` reads bounded strict JSON from a regular host file. Before locking the registry, call `registerReadOnlyConnectors(registry, {config,baseDir,denyPaths:[gatewayDatabasePath]})`. It returns safe connector metadata. Add deliberate allow rules and profile grants for registered tool names; registration alone does not authorize execution. Both exports and `CONNECTOR_LIMITS` can be used by custom hosts.
