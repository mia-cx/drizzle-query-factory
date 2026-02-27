<!-- @format -->

# @mia-cx/drizzle-query-factory

Declarative, composable query parameter parser for [Drizzle ORM](https://orm.drizzle.team/). Converts query params from any web framework into typed Drizzle conditions, sorting, and pagination — without coupling your API to a specific column layout.

- **Schema-agnostic** — no built-in column names; you supply your own Drizzle schema
- **Allowlist-only** — only explicitly declared columns can be filtered/sorted; unknown params are ignored
- **Composable** — returns `SQL | undefined`, not a complete query; safe to `and()` with auth conditions
- **Custom filters** — plug in arbitrary SQL via `customFilters` for app-specific logic (sub-queries, joins, etc.)
- **Dialect-agnostic** — works with SQLite, Postgres, MySQL
- **Framework-agnostic** — accepts `Request`, `URL`, `URLSearchParams`, or `Record<string, string>`

## Install

```bash
pnpm i @mia-cx/drizzle-query-factory
# drizzle-orm is a peer dependency
pnpm i drizzle-orm
```

## Quick Start

```typescript
import { parseListQuery, listResponse } from "@mia-cx/drizzle-query-factory";
import type { ListQueryConfig } from "@mia-cx/drizzle-query-factory";
import { eq, and, sql } from "drizzle-orm";
import { resources } from "./schema";

// 1. Declare which params you allow and how they map to columns
const config: ListQueryConfig = {
  filters: {
    status: { column: resources.status },
    type: { column: resources.type, op: "in" }, // ?type=post,song
    owner_id: { column: resources.ownerId },
    title: { column: resources.title, op: "like" }, // ?title=hello → LIKE '%hello%'
  },
  sortable: {
    created_at: resources.createdAt,
    updated_at: resources.updatedAt,
    title: resources.title,
  },
  defaultSort: { key: "created_at", dir: "desc" },
};

// 2. Parse — pass the Request (or URL, URLSearchParams, or plain object)
const query = parseListQuery(request, config);

// 3. Compose with auth — query params can never bypass your auth layer
const authWhere = eq(resources.status, "LISTED");
const finalWhere = and(authWhere, query.where);

// 4. Query
const [rows, [{ total }]] = await Promise.all([
  db
    .select()
    .from(resources)
    .where(finalWhere)
    .orderBy(query.orderBy)
    .limit(query.limit)
    .offset(query.offset),
  db
    .select({ total: sql<number>`count(*)` })
    .from(resources)
    .where(finalWhere),
]);

// 5. Respond with a standardised envelope
return listResponse(rows, total, query.limit, query.offset);
// → { data: [...], meta: { total, limit, offset, has_more } }
```

## Framework Examples

`parseListQuery` accepts any of: `Request`, `URL`, `URLSearchParams`, or `Record<string, string>`. Since Hono and SvelteKit both use the standard Web `Request`, the same config works in both without glue code.

### Hono

```typescript
app.get("/resources", async (c) => {
  const query = parseListQuery(c.req.raw, config);
  // ...
});
```

### SvelteKit

```typescript
export const load: PageServerLoad = async ({ url }) => {
  const query = parseListQuery(url, config);
  // ...
};
```

### Plain object (tests, scripts)

```typescript
const query = parseListQuery({ status: "active", limit: "10" }, config);
```

## Custom Filters

Column filters cover simple comparisons. For anything more complex — sub-queries, joins, multi-column conditions — use `customFilters`:

```typescript
import { sql } from "drizzle-orm";

const config: ListQueryConfig = {
  filters: {
    status: { column: resources.status },
  },
  customFilters: {
    // ?scope=mine → only resources owned by the current user
    scope: (value) =>
      value === "mine" ?
        sql`${resources.ownerId} = ${currentUserId}`
      : undefined, // return undefined to skip

    // ?has_post=true → only resources that have a post row
    has_post: (value) =>
      value === "true" ?
        sql`EXISTS (SELECT 1 FROM posts WHERE posts.resource_id = ${resources.id})`
      : undefined,
  },
  sortable: { created_at: resources.createdAt },
  defaultSort: { key: "created_at", dir: "desc" },
};
```

Custom filters receive the raw string value and return `SQL | undefined`. They're AND-ed with column filters and with any auth conditions you add.

## Execution Helper: `runListQuery`

If you want the factory to execute the Drizzle query for you (instead of manually building the chain), use `runListQuery`. It accepts the DB context, table, and parsed query, then runs the select + optional count and returns results with pagination metadata.

### Basic usage (rows mode, default)

```typescript
import { parseListQuery, runListQuery, listResponse } from "@mia-cx/drizzle-query-factory";

const query = parseListQuery(request, config);

const { rows, total, has_more } = await runListQuery({
  db, table: resources, query,
  baseWhere: eq(resources.status, "LISTED"), // composable with query-param filters
});

return listResponse(rows, total, query.limit, query.offset);
```

### Envelope mode

Returns a `ListResponseEnvelope` directly — no manual wrapping needed:

```typescript
const envelope = await runListQuery({
  db, table: resources, query,
  baseWhere: eq(resources.status, "LISTED"),
  mode: "envelope",
});
return c.json(envelope);
// → { data: [...], meta: { total, limit, offset, has_more } }
```

### Skipping count

By default, `runListQuery` runs two parallel queries (rows + `count(*)`). Set `count: false` to skip the count query and use heuristic metadata instead:

```typescript
const result = await runListQuery({
  db, table: resources, query, count: false,
});
// result.total = offset + rows.length  (lower-bound, not exact)
// result.has_more = rows.length === limit
```

This is useful for tables where you don't need exact totals and want to avoid the overhead of a second query.

### Caveats

- **`count: false` metadata is non-exact.** `total` is a lower bound (`offset + rows.length`), and `has_more` is a heuristic (`rows.length === limit`). Suitable for "load more" UIs but not for displaying exact page counts.
- **Concurrent-write drift.** When `count: true`, the rows query and count query run in parallel without a transaction. Under concurrent writes, `total` may not match the actual rows returned. This is acceptable for display metadata; document it if precision matters.

## Composing with Auth

`parseListQuery` deliberately returns partial conditions rather than a complete query. This means query params can **never** bypass your authorization layer:

```typescript
// Auth determines the base WHERE — users only see what they're allowed to
const authWhere =
  isAdmin ?
    undefined // admin sees everything
  : eq(resources.status, "LISTED"); // guests see LISTED only

// Query-param filters layer on top
const finalWhere =
  authWhere ?
    query.where ?
      and(authWhere, query.where) // both
    : authWhere // auth only
  : query.where; // params only (or undefined)

db.select().from(resources).where(finalWhere);
```

## Query String Format

```
GET /resources?status=LISTED&type=post&sort=created_at&order=desc&limit=20&offset=0
GET /resources?type=post,song     # comma-separated with op:"in" → inArray
GET /resources?title=hello        # with op:"like" → LIKE '%hello%'
GET /resources?min_age=18         # with op:"gte" + parse → gte(age, 18)
```

## API Reference

### `parseListQuery(input, config)`

Parses query parameters into a `ParsedListQuery` that can be spread into a Drizzle query chain.

| Param    | Type              | Description                                 |
| -------- | ----------------- | ------------------------------------------- |
| `input`  | `QueryInput`      | Query parameters (see accepted types below) |
| `config` | `ListQueryConfig` | Filter, sort, and pagination configuration  |

**`QueryInput`** — accepted input types:

| Type | Example | Typical Use |
| --- | --- | --- |
| `Request` | `parseListQuery(c.req.raw, config)` | Hono |
| `Request` | `parseListQuery(event.request, config)` | SvelteKit |
| `URL` | `parseListQuery(event.url, config)` | SvelteKit `load` |
| `URLSearchParams` | `parseListQuery(url.searchParams, config)` | Any |
| `Record<string, string>` | `parseListQuery({ status: "active" }, config)` | Tests / scripts |

**Returns:** `ParsedListQuery`

```typescript
type ParsedListQuery = {
  where: SQL | undefined; // AND of all matched conditions (undefined if none)
  orderBy: SQL; // column + direction
  limit: number; // clamped to [1, maxLimit]
  offset: number; // clamped to >= 0
};
```

### `ListQueryConfig`

```typescript
type ListQueryConfig = {
  filters: Record<string, ColumnFilter>; // param name → column + operator
  customFilters?: Record<string, CustomFilter>; // param name → (value) => SQL | undefined
  sortable: Record<string, Column>; // sort key → column
  defaultSort: { key: string; dir: "asc" | "desc" };
  defaultLimit?: number; // default: 20
  maxLimit?: number; // default: 100
};
```

### `ColumnFilter`

```typescript
type ColumnFilter = {
  column: Column; // Drizzle column reference
  op?: FilterOp; // default: "eq"
  parse?: (value: string) => unknown; // coerce string → column type
};

type FilterOp = "eq" | "like" | "gt" | "gte" | "lt" | "lte" | "in";
```

### `CustomFilter`

```typescript
type CustomFilter = (value: string) => SQL | undefined;
```

### `listResponse(data, total, limit, offset)`

Wraps a page of results in a standardised envelope with pagination metadata.

```typescript
listResponse([...items], 100, 20, 0);
// → { data: [...], meta: { total: 100, limit: 20, offset: 0, has_more: true } }

listResponse([...items], 5, 20, 0);
// → { data: [...], meta: { total: 5, limit: 20, offset: 0, has_more: false } }
```

### `itemResponse(data)`

Wraps a single item in a `{ data }` envelope consistent with `listResponse`.

```typescript
itemResponse({ id: "1", name: "Example" });
// → { data: { id: "1", name: "Example" } }
```

### `runListQuery(options)`

Executes a paginated list query against a Drizzle table, composing `baseWhere` with parsed query-param filters.

| Param | Type | Description |
| --- | --- | --- |
| `db` | `{ select: ... }` | Any Drizzle database instance (D1, Postgres, etc.) |
| `table` | `Table` | Drizzle table to query |
| `query` | `ParsedListQuery` | Output of `parseListQuery` |
| `baseWhere?` | `SQL` | Additional WHERE condition (e.g. auth scope) |
| `count?` | `boolean` | Run `count(*)` query. Default: `true` |
| `mode?` | `"rows" \| "envelope"` | Return shape. Default: `"rows"` |

**Returns (mode: `"rows"`):** `{ rows: T[], total: number, has_more: boolean }`

**Returns (mode: `"envelope"`):** `{ data: T[], meta: { total, limit, offset, has_more } }`

### `applyOperator(op, column, value)`

Low-level helper that resolves a `FilterOp` + column + value into a Drizzle `SQL` condition. Used internally by `parseListQuery`; exported for edge cases where you need to build conditions outside the query-param flow.

## Fallback Behavior

The factory never throws on bad input — it falls back gracefully:

| Scenario | Behavior |
| --- | --- |
| Unknown query param | Silently ignored (allowlist-only) |
| Empty param value | Ignored |
| Invalid `sort` key | Falls back to `defaultSort.key` |
| Invalid `order` value | Falls back to `defaultSort.dir` |
| Non-numeric `limit` | Falls back to `defaultLimit` |
| `limit` out of range | Clamped to `[1, maxLimit]` |
| Negative `offset` | Clamped to `0` |
| `in` operator | Splits comma-separated values (`?type=a,b` → `inArray`) |
| `like` operator | Wraps in `%…%` (`?title=hello` → `LIKE '%hello%'`) |

## License

MIT
