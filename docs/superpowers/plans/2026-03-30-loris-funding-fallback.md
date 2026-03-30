# Loris Funding Fallback Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Loris funding rates as a fallback source behind existing exchange-native funding providers.

**Architecture:** Keep current provider-specific funding endpoints as the primary source. Add a cached Loris adapter that can fill missing `currentRate` values or fully replace funding payloads when the native provider fails and a supported Loris mapping exists.

**Tech Stack:** Node.js exchange service, REST fetch adapter, node test runner.

---

### Task 1: Loris fallback tests

**Files:**
- Create: `test/loris-funding-fallback.test.js`
- Modify: `services/exchanges/index.js`

- [ ] Write failing tests for Loris payload mapping and fallback usage
- [ ] Run `node --test test/loris-funding-fallback.test.js` and confirm failure
- [ ] Implement minimal Loris helper and fallback behavior
- [ ] Run tests again and confirm pass

### Task 2: Verification

**Files:**
- Modify: `services/exchanges/index.js`

- [ ] Run targeted exchange tests
- [ ] Run syntax checks / build as needed
