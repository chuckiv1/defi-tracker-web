# Strategy Token Events Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repeatable token rows to strategy creation and investment booking while aggregating token balances in the strategy UI.

**Architecture:** Store token additions on `investmentHistory` entries as `tokenChanges` and compute current strategy token balances from those events. Keep legacy `strategy.token` readable so old data still renders correctly.

**Tech Stack:** Vanilla frontend in `app-core.js`, Express routes in `routes/strategies.js`, node test runner.

---

### Task 1: Backend token-change persistence

**Files:**
- Modify: `routes/strategies.js`
- Test: `test/strategy-token-events.test.js`

- [ ] Write failing tests for strategy creation and investment booking with `tokenChanges`
- [ ] Run the strategy token event tests and confirm failure
- [ ] Implement normalization/validation for repeatable token rows with legacy fallback
- [ ] Run tests and confirm pass

### Task 2: Frontend aggregation helpers

**Files:**
- Modify: `public/src/app-core.js`
- Test: `test/strategy-investment.test.js`

- [ ] Write failing tests for aggregated token balances and summary text
- [ ] Run the strategy helper tests and confirm failure
- [ ] Implement token event flattening, aggregation, and summary helpers
- [ ] Run tests and confirm pass

### Task 3: Strategy modal and investment modal UI

**Files:**
- Modify: `public/src/app-core.js`
- Test: `test/strategy-token-events.test.js`

- [ ] Write failing tests for hidden token inputs and repeatable add-row UI
- [ ] Run tests and confirm failure
- [ ] Implement `+ Token hinzufügen` rows for create/investment modals and request payload wiring
- [ ] Run tests and confirm pass

### Task 4: Strategy detail rendering

**Files:**
- Modify: `public/src/app-core.js`
- Test: `test/strategy-token-events.test.js`

- [ ] Write failing tests for aggregated token section and per-investment token change rendering
- [ ] Run tests and confirm failure
- [ ] Implement the minimal rendering changes
- [ ] Run tests and confirm pass

### Task 5: Verification

**Files:**
- Modify: `public/src/app_core.js` (none expected; verification only)

- [ ] Run `node --test test/strategy-token-events.test.js test/strategy-investment.test.js test/loop-detail-editing-and-strategy-reactivate.test.js`
- [ ] Run `node --check public/src/app-core.js && node --check routes/strategies.js`
- [ ] Run `npm run build`
