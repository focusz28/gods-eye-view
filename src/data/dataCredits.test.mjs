import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_CREDITS } from './dataCredits.js';

test('every credit carries a unique key and some markup to render', () => {
  const keys = DATA_CREDITS.map((entry) => entry.key);
  assert.equal(
    new Set(keys).size,
    keys.length,
    'a duplicate key would silently shadow one provider’s credit',
  );
  for (const entry of DATA_CREDITS) {
    assert.ok(entry.key, 'a credit without a key cannot be registered');
    assert.ok(
      entry.html && entry.html.trim().length > 0,
      `credit ${entry.key} has nothing to show`,
    );
  }
});

test('adsbdb is credited and carries its published route-data restriction', () => {
  const credit = DATA_CREDITS.find((entry) => entry.key === 'adsbdb');
  assert.ok(
    credit,
    'adsbdb supplies aircraft type and routes and must be credited',
  );
  // adsbdb publishes this restriction for its route data. Pin the provider's
  // credits and restriction here so a later edit cannot silently remove them.
  assert.match(credit.html, /David Taylor, Edinburgh/);
  assert.match(credit.html, /Jim Mason, Glasgow/);
  assert.match(
    credit.html,
    /may not be\s+copied, published, or incorporated into other databases/,
  );
  assert.match(credit.html, /explicit permission of David J Taylor, Edinburgh/);
  assert.match(credit.html, /PlaneBase/);
  assert.match(credit.html, /Guillaume Michel/);
  assert.match(credit.html, /href="https:\/\/www\.adsbdb\.com"/);
});

test('taiwan-cctv is credited with Taiwan MOTC & Freeway Bureau attribution', () => {
  const credit = DATA_CREDITS.find((entry) => entry.key === 'taiwan-cctv');
  assert.ok(
    credit,
    'taiwan-cctv supplies open traffic camera streams and must be credited',
  );
  assert.match(
    credit.html,
    /Taiwan Ministry of Transportation and Communications \(MOTC\) &amp; Freeway Bureau/,
  );
  assert.match(credit.html, /Open Government Data/);
  assert.match(credit.html, /href="https:\/\/data\.gov\.tw\/"/);
});

test('wsdot-cctv is credited with Washington State DOT attribution', () => {
  const credit = DATA_CREDITS.find((entry) => entry.key === 'wsdot-cctv');
  assert.ok(
    credit,
    'wsdot-cctv supplies open traffic camera feeds and must be credited',
  );
  assert.match(
    credit.html,
    /Washington State Department of Transportation \(WSDOT\)/,
  );
  assert.match(credit.html, /Open Data/);
  assert.match(credit.html, /href="https:\/\/wsdot\.wa\.gov\/"/);
});
