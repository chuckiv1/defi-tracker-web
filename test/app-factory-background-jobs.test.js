const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('app factory starts a background scheduler for scheduled messages', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app-factory.js'), 'utf8');

  assert.match(source, /setInterval\(\(\) => \{\s*flushScheduledMessages\(\)/);
  assert.match(source, /flushScheduledMessages\(\)\.catch/);
});
