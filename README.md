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
    status:   { column: resources.status },
    type:     { column: resources.type, op: "in" },       // ?type=post,song
    owner_id: { column: resources.ownerId },
    title:    { column: resources.title, op: "like" },     // ?title=hello → LIKE '%hello%'
  },
  sortable: {
    created_at: resources.createdAt,
    updated_at: resources.updatedAt,
    title:      resources.title,
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
  db.select().from(resources)
    .where(finalWhere)
    .orderBy(query.orderBy)
    .limit(query.limit)
    .offset(query.offset),
  db.select({ total: sql<number>`count(*)` })
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
      value === "mine"
        ? sql`${resources.ownerId} = ${currentUserId}`
        : undefined,  // return undefined to skip

    // ?has_post=true → only resources that have a post row
    has_post: (value) =>
      value === "true"
        ? sql`EXISTS (SELECT 1 FROM posts WHERE posts.resource_id = ${resources.id})`
        : undefined,
  },
  sortable: { created_at: resources.createdAt },
  defaultSort: { key: "created_at", dir: "desc" },
};
```

Custom filters receive the raw string value and return `SQL | undefined`. They're AND-ed with column filters and with any auth conditions you add.

## Composing with Auth

`parseListQuery` deliberately returns partial conditions rather than a complete query. This means query params can **never** bypass your authorization layer:

```typescript
// Auth determines the base WHERE — users only see what they're allowed to
const authWhere = isAdmin
  ? undefined                                   // admin sees everything
  : eq(resources.status, "LISTED");             // guests see LISTED only

// Query-param filters layer on top
const finalWhere = authWhere
  ? query.where
    ? and(authWhere, query.where)               // both
    : authWhere                                 // auth only
  : query.where;                                // params only (or undefined)

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

| Param | Type | Description |
|-------|------|-------------|
| `input` | `QueryInput` | Query parameters (see accepted types below) |
| `config` | `ListQueryConfig` | Filter, sort, and pagination configuration |

**`QueryInput`** — accepted input types:

| Type | Example | Typical Use |
|------|---------|-------------|
| `Request` | `parseListQuery(c.req.raw, config)` | Hono |
| `Request` | `parseListQuery(event.request, config)` | SvelteKit |
| `URL` | `parseListQuery(event.url, config)` | SvelteKit `load` |
| `URLSearchParams` | `parseListQuery(url.searchParams, config)` | Any |
| `Record<string, string>` | `parseListQuery({ status: "active" }, config)` | Tests / scripts |

**Returns:** `ParsedListQuery`

```typescript
type ParsedListQuery = {
  where: SQL | undefined;  // AND of all matched conditions (undefined if none)
  orderBy: SQL;            // column + direction
  limit: number;           // clamped to [1, maxLimit]
  offset: number;          // clamped to >= 0
};
```

### `ListQueryConfig`

```typescript
type ListQueryConfig = {
  filters: Record<string, ColumnFilter>;        // param name → column + operator
  customFilters?: Record<string, CustomFilter>; // param name → (value) => SQL | undefined
  sortable: Record<string, Column>;             // sort key → column
  defaultSort: { key: string; dir: "asc" | "desc" };
  defaultLimit?: number; // default: 20
  maxLimit?: number;     // default: 100
};
```

### `ColumnFilter`

```typescript
type ColumnFilter = {
  column: Column;                       // Drizzle column reference
  op?: FilterOp;                        // default: "eq"
  parse?: (value: string) => unknown;   // coerce string → column type
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
listResponse([...items], 100, 20, 0)
// → { data: [...], meta: { total: 100, limit: 20, offset: 0, has_more: true } }

listResponse([...items], 5, 20, 0)
// → { data: [...], meta: { total: 5, limit: 20, offset: 0, has_more: false } }
```

### `itemResponse(data)`

Wraps a single item in a `{ data }` envelope consistent with `listResponse`.

```typescript
itemResponse({ id: "1", name: "Example" })
// → { data: { id: "1", name: "Example" } }
```

### `applyOperator(op, column, value)`

Low-level helper that resolves a `FilterOp` + column + value into a Drizzle `SQL` condition. Used internally by `parseListQuery`; exported for edge cases where you need to build conditions outside the query-param flow.

## Fallback Behavior

The factory never throws on bad input — it falls back gracefully:

| Scenario | Behavior |
|----------|----------|
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
