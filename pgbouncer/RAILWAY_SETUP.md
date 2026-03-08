# PgBouncer — Railway Setup Guide

PgBouncer sits in front of Railway Postgres and multiplexes hundreds of application connections down to a small, stable pool of real Postgres connections. This is the key to horizontal scaling.

## Architecture

```
api (10 conns)  ─┐
worker (10)      ├─→  PgBouncer (transaction mode) ──→  Railway Postgres
tracker (10)    ─┘        25 real connections              (can't handle >100)
```

With **transaction pooling**, a backend connection is held only for the duration of a single transaction, then returned to the pool. Perfect for stateless API services.

---

## Step 1 — Create the PgBouncer service in Railway

1. In your Railway project, click **+ New Service → Empty Service**
2. Name it **`PgBouncer`**
3. Set the **Source** to this GitHub repo, root path: `pgbouncer/`
4. Deploy once — it will build from `pgbouncer/Dockerfile`

---

## Step 2 — Set environment variables on the PgBouncer service

In the PgBouncer service **Variables** tab, add:

```
# Backend Postgres connection (Railway internal networking)
POSTGRESQL_HOST=${{Postgres.PGHOST}}
POSTGRESQL_PORT=${{Postgres.PGPORT}}
POSTGRESQL_DATABASE=${{Postgres.PGDATABASE}}
POSTGRESQL_USERNAME=${{Postgres.PGUSER}}
POSTGRESQL_PASSWORD=${{Postgres.PGPASSWORD}}

# PgBouncer config
PGBOUNCER_PORT=5432
PGBOUNCER_POOL_MODE=transaction
PGBOUNCER_MAX_CLIENT_CONN=1000
PGBOUNCER_DEFAULT_POOL_SIZE=25
PGBOUNCER_IGNORE_STARTUP_PARAMETERS=extra_float_digits
PGBOUNCER_SERVER_TLS_SSLMODE=require
PGBOUNCER_AUTH_TYPE=scram-sha-256
```

> **Note:** `${{Postgres.PGHOST}}` uses Railway's [variable reference syntax](https://docs.railway.com/guides/variables#reference-variables) — replace `Postgres` with the exact name of your Railway Postgres service if it differs.

---

## Step 3 — Update DATABASE_URL on api, worker, and tracker services

For each of the three services, update their `DATABASE_URL` variable to route through PgBouncer instead of directly to Postgres:

```
DATABASE_URL=postgresql://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{PgBouncer.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}
```

> `${{PgBouncer.RAILWAY_PRIVATE_DOMAIN}}` resolves to `pgbouncer.railway.internal` — the private hostname Railway assigns. This only works inside the same Railway project/environment (no public internet required).

---

## Step 4 — Enable private networking

Make sure **Private Networking** is enabled in your Railway project settings. Go to:

**Project Settings → Networking → Private Networking** → Enable

This allows services to communicate over `*.railway.internal` hostnames without going through the public internet.

---

## Connection Pool Sizing Reference

| Setting | Value | Why |
|---|---|---|
| `PGBOUNCER_DEFAULT_POOL_SIZE` | 25 | Real connections to Postgres per database/user pair |
| `PGBOUNCER_MAX_CLIENT_CONN` | 1000 | Max simultaneous app connections to PgBouncer |
| `max` in postgres.js client | 10 | Max connections per service instance to PgBouncer |

**Formula:** `DEFAULT_POOL_SIZE` should stay well under Postgres's `max_connections` (Railway default: 100). 25 leaves plenty of headroom.

---

## Verifying the setup

After deploying, check PgBouncer logs in Railway. You should see:
```
LOG  C-0x... postgres/openmail@... login attempt: db=openmail user=openmail
LOG  S-0x... postgres/openmail@... new connection to server
```

To check pool stats, connect to PgBouncer and run:
```sql
SHOW POOLS;
SHOW STATS;
```
