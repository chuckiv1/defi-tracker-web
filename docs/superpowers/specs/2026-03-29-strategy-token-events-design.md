# Strategy Token Events Design

**Goal:** Allow strategies and strategy investments to add multiple token rows while keeping each token change as its own investment event detail and showing aggregated token balances in the strategy UI.

**Scope:** Staging implementation for strategy creation, investment booking, strategy detail display, list badges/search, and backend persistence with legacy single-token compatibility.

## Data Model

- New strategies store token additions on the initial `investmentHistory` entry as `tokenChanges`.
- New investment bookings may also include `tokenChanges`.
- Each token change stays separate on the investment entry.
- Existing legacy `strategy.token` remains supported for rendering/search and may coexist for old data.

## UI

- Strategy create modal starts without token fields.
- `+ Token hinzufügen` adds repeatable rows with token, amount, entry price, and remove button.
- Investment modal gets the same repeatable token rows.
- Strategy detail `Token` section shows aggregated balances by symbol.
- Investment timeline shows token changes per entry.

## Aggregation

- Aggregate by uppercased token symbol.
- Display amount as sum of all token change amounts for that symbol.
- Entry/value use weighted average over positive additions only.
- Legacy `strategy.token` contributes to the aggregate when no token-change history exists.

## Compatibility

- Old strategies remain readable.
- Search and list badges include aggregated token names.
- Existing investment edit flow keeps existing token changes unchanged.
