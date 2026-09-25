import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWashingtonHeading,
  findNearestWashingtonCity,
  normalizeWsdotCamera,
  loadWsdotSourcesFromOpenData,
} from '../../server/providers/cctv/sources.js';
import {
  DEFAULT_WSDOT_URL,
  DEFAULT_WSDOT_MAX_SOURCES,
  WASHINGTON_ANCHORS,
} from '../../server/providers/cctv/constants.js';
import { isLikelyWashingtonCoordinate } from '../../server/providers/cctv/normalize.js';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';

test('isLikelyWashingtonCoordinate accepts Washington coordinates and rejects outsiders', () => {
  // Seattle
  assert.equal(isLikelyWashingtonCoordinate(47.6062, -122.3321), true);
  // Spokane
  assert.equal(isLikelyWashingtonCoordinate(47.6588, -117.426), true);
  // Vancouver, WA
  assert.equal(isLikelyWashingtonCoordinate(45.6387, -122.6615), true);
  // Snoqualmie Pass
  assert.equal(isLikelyWashingtonCoordinate(47.4243, -121.4138), true);
  // Bellingham
  assert.equal(isLikelyWashingtonCoordinate(48.7519, -122.4787), true);

  // Null island and non-finite
  assert.equal(isLikelyWashingtonCoordinate(0, 0), false);
  assert.equal(isLikelyWashingtonCoordinate(NaN, -122.3), false);
  assert.equal(isLikelyWashingtonCoordinate(null, undefined), false);

  // Out of bounds (Austin, Tokyo, London, Taipei)
  assert.equal(isLikelyWashingtonCoordinate(30.2672, -97.7431), false);
  assert.equal(isLikelyWashingtonCoordinate(35.6762, 139.6503), false);
  assert.equal(isLikelyWashingtonCoordinate(51.5074, -0.1278), false);
  assert.equal(isLikelyWashingtonCoordinate(25.033, 121.5654), false);
});

test('extractWashingtonHeading parses compass direction codes and title direction tokens', () => {
  // Dedicated compass codes
  assert.equal(extractWashingtonHeading('N', 'I-5'), 0);
  assert.equal(extractWashingtonHeading('S', 'I-5'), 180);
  assert.equal(extractWashingtonHeading('E', 'I-90'), 90);
  assert.equal(extractWashingtonHeading('W', 'I-90'), 270);
  assert.equal(extractWashingtonHeading('NE', 'SR 520'), 45);
  assert.equal(extractWashingtonHeading('NW', 'SR 520'), 315);
  assert.equal(extractWashingtonHeading('SE', 'SR 167'), 135);
  assert.equal(extractWashingtonHeading('SW', 'SR 167'), 225);

  // Direction in title when compass direction is B (Both) or O (Other)
  assert.equal(
    extractWashingtonHeading('B', 'I-5 SB at MP 132.4: SR 16 Interchange'),
    180,
  );
  assert.equal(
    extractWashingtonHeading('B', 'I-5 at MP 131.8: S 38th St Northbound'),
    0,
  );
  assert.equal(
    extractWashingtonHeading('O', 'I-90 EB at MP 12.0: Eastgate'),
    90,
  );
  assert.equal(
    extractWashingtonHeading('B', 'SR 520 WB at MP 4.2: Evergreen Point'),
    270,
  );

  // Unstated / ambiguous
  assert.equal(extractWashingtonHeading('B', 'I-5 at MP 133.6: Pacific Ave'), null);
  assert.equal(extractWashingtonHeading(null, 'Main Street Bridge'), null);
});

test('findNearestWashingtonCity matches closest anchor', () => {
  // Near Seattle downtown
  assert.equal(findNearestWashingtonCity(47.61, -122.33), 'Seattle');
  // Near Spokane
  assert.equal(findNearestWashingtonCity(47.66, -117.42), 'Spokane');
  // Near Tacoma
  assert.equal(findNearestWashingtonCity(47.25, -122.44), 'Tacoma');
  // Near Snoqualmie Pass
  assert.equal(findNearestWashingtonCity(47.42, -121.41), 'Snoqualmie Pass');
  // Near Vancouver WA
  assert.equal(findNearestWashingtonCity(45.64, -122.66), 'Vancouver');
});

test('normalizeWsdotCamera normalizes valid features and enforces security constraints', () => {
  const validFeature = {
    attributes: {
      OBJECTID: 1001,
      CameraTitle: 'I-5 at Interstate Bridge SB, north end',
      ImageURL: 'https://images.wsdot.wa.gov/sw/005vc00320.jpg',
      CompassDirection: 'S',
    },
    geometry: {
      x: -122.674,
      y: 45.62,
    },
  };

  const cam = normalizeWsdotCamera(validFeature);
  assert.ok(cam);
  assert.equal(cam.id, 'wsdot-1001');
  assert.equal(cam.name, 'I-5 at Interstate Bridge SB, north end');
  assert.equal(cam.cityId, 'washington');
  assert.equal(cam.city, 'Vancouver');
  assert.equal(cam.provider, 'WSDOT');
  assert.equal(cam.feedType, 'image');
  assert.equal(cam.headingDeg, 180);
  assert.equal(cam.headingConfidence, 'high');
  assert.equal(cam.url, 'https://images.wsdot.wa.gov/sw/005vc00320.jpg');
  assert.equal(cam.snapshotUrl, 'https://images.wsdot.wa.gov/sw/005vc00320.jpg');
  assert.equal(cam.sourceKind, 'wsdot-open-data');

  // Accepts partner domain tripcheck.com
  const tripcheckFeature = {
    ...validFeature,
    attributes: {
      ...validFeature.attributes,
      OBJECTID: 1002,
      ImageURL: 'https://www.tripcheck.com/RoadCams/cams/test.jpg',
    },
  };
  const tripcheckCam = normalizeWsdotCamera(tripcheckFeature);
  assert.ok(tripcheckCam);
  assert.equal(tripcheckCam.id, 'wsdot-1002');

  // Security: Rejects non-HTTPS
  assert.equal(
    normalizeWsdotCamera({
      ...validFeature,
      attributes: {
        ...validFeature.attributes,
        ImageURL: 'http://images.wsdot.wa.gov/sw/005vc00320.jpg',
      },
    }),
    null,
  );

  // Security: Rejects untrusted domains
  assert.equal(
    normalizeWsdotCamera({
      ...validFeature,
      attributes: {
        ...validFeature.attributes,
        ImageURL: 'https://malicious-site.com/cam.jpg',
      },
    }),
    null,
  );

  // Rejects out-of-bounds coordinates
  assert.equal(
    normalizeWsdotCamera({
      ...validFeature,
      geometry: { x: -97.74, y: 30.26 },
    }),
    null,
  );

  // Rejects missing/empty object IDs
  assert.equal(
    normalizeWsdotCamera({
      ...validFeature,
      attributes: { ...validFeature.attributes, OBJECTID: '' },
    }),
    null,
  );
});

test('loadWsdotSourcesFromOpenData prioritizes sources across anchors', async () => {
  const originalFetch = globalThis.fetch;
  const mockFeatures = [
    {
      attributes: {
        OBJECTID: 2001,
        CameraTitle: 'Seattle I-5 NB',
        ImageURL: 'https://images.wsdot.wa.gov/nw/005vc16500.jpg',
        CompassDirection: 'N',
      },
      geometry: { x: -122.33, y: 47.61 },
    },
    {
      attributes: {
        OBJECTID: 2002,
        CameraTitle: 'Spokane I-90 EB',
        ImageURL: 'https://images.wsdot.wa.gov/ea/090vc28000.jpg',
        CompassDirection: 'E',
      },
      geometry: { x: -117.42, y: 47.66 },
    },
    {
      attributes: {
        OBJECTID: 2003,
        CameraTitle: 'Vancouver I-5 SB',
        ImageURL: 'https://images.wsdot.wa.gov/sw/005vc00100.jpg',
        CompassDirection: 'S',
      },
      geometry: { x: -122.66, y: 45.64 },
    },
  ];

  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('wsdot.wa.gov')) {
      return new Response(JSON.stringify({ features: mockFeatures }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ features: [] }), { status: 200 });
  };

  try {
    const list = await loadWsdotSourcesFromOpenData();
    assert.equal(list.length, 3);
    assert.ok(list.every((c) => c.id.startsWith('wsdot-')));
    assert.ok(list.some((c) => c.city === 'Seattle'));
    assert.ok(list.some((c) => c.city === 'Spokane'));
    assert.ok(list.some((c) => c.city === 'Vancouver'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createCctvCatalog respects CCTV_WSDOT_ENABLED env toggle', async () => {
  const originalEnv = process.env.CCTV_WSDOT_ENABLED;
  try {
    process.env.CCTV_WSDOT_ENABLED = '0';
    const getCatalog = createCctvCatalog();
    const originalFetch = globalThis.fetch;
    let fetchedWsdot = false;
    globalThis.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('wsdot')) {
        fetchedWsdot = true;
      }
      return new Response('{"features":[]}', { status: 200 });
    };
    try {
      await getCatalog();
      assert.equal(
        fetchedWsdot,
        false,
        'WSDOT sources should not be fetched when CCTV_WSDOT_ENABLED=0',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    if (originalEnv === undefined) delete process.env.CCTV_WSDOT_ENABLED;
    else process.env.CCTV_WSDOT_ENABLED = originalEnv;
  }
});
