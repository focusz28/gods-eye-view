import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTaiwanHeading,
  findNearestTaiwanCity,
  normalizeTaiwanCamera,
  loadTaiwanSourcesFromOpenData,
} from '../../server/providers/cctv/sources.js';
import {
  DEFAULT_TAIWAN_FREEWAY_URL,
  DEFAULT_TAIWAN_THB_URL,
  DEFAULT_TAIWAN_MAX_SOURCES,
  TAIWAN_ANCHORS,
} from '../../server/providers/cctv/constants.js';
import { isLikelyTaiwanCoordinate } from '../../server/providers/cctv/normalize.js';
import { extractFirstMjpegFrame } from '../../server/providers/cctv/media.js';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';

test('isLikelyTaiwanCoordinate accepts Taiwan coordinates and rejects outsiders', () => {
  // Taipei
  assert.equal(isLikelyTaiwanCoordinate(25.033, 121.5654), true);
  // Kaohsiung
  assert.equal(isLikelyTaiwanCoordinate(22.6273, 120.3014), true);
  // Hualien
  assert.equal(isLikelyTaiwanCoordinate(23.9872, 121.6016), true);
  // Penghu
  assert.equal(isLikelyTaiwanCoordinate(23.57, 119.58), true);
  // Kinmen
  assert.equal(isLikelyTaiwanCoordinate(24.44, 118.32), true);

  // Null island and non-finite
  assert.equal(isLikelyTaiwanCoordinate(0, 0), false);
  assert.equal(isLikelyTaiwanCoordinate(NaN, 121.5), false);
  assert.equal(isLikelyTaiwanCoordinate(null, undefined), false);

  // Out of bounds (Tokyo, Austin, London)
  assert.equal(isLikelyTaiwanCoordinate(35.6762, 139.6503), false);
  assert.equal(isLikelyTaiwanCoordinate(30.2672, -97.7431), false);
  assert.equal(isLikelyTaiwanCoordinate(51.5074, -0.1278), false);
});

test('extractTaiwanHeading recognizes directional tokens from ID and name', () => {
  // Freeway IDs
  assert.equal(extractTaiwanHeading('CCTV-N1-N-0.100-M', '國道1號'), 0);
  assert.equal(extractTaiwanHeading('CCTV-N1-S-0.000-M', '國道1號'), 180);
  assert.equal(extractTaiwanHeading('CCTV-N2-E-11.590-M', '國道2號'), 90);
  assert.equal(extractTaiwanHeading('CCTV-N2-W-12.000-M', '國道2號'), 270);

  // Chinese tokens in name
  assert.equal(extractTaiwanHeading('CCTV-01', '台9線南下車道'), 180);
  assert.equal(extractTaiwanHeading('CCTV-02', '台9線北向車道'), 0);
  assert.equal(extractTaiwanHeading('CCTV-03', '台64線東向12K'), 90);
  assert.equal(extractTaiwanHeading('CCTV-04', '台64線西向8K'), 270);

  // No direction
  assert.equal(extractTaiwanHeading('CCTV-99', '台7線120K+700'), null);
});

test('findNearestTaiwanCity matches closest urban center', () => {
  // Near Taipei
  assert.equal(findNearestTaiwanCity(25.04, 121.55), 'Taipei');
  // Near Kaohsiung
  assert.equal(findNearestTaiwanCity(22.63, 120.31), 'Kaohsiung');
  // Near Taichung
  assert.equal(findNearestTaiwanCity(24.15, 120.67), 'Taichung');
  // Near Yilan
  assert.equal(findNearestTaiwanCity(24.75, 121.75), 'Yilan');
});

test('normalizeTaiwanCamera normalizes valid rows and enforces origin restrictions', () => {
  const validFreewayRow = {
    id: 'CCTV-N1-S-0.000-M',
    stakenumber: '國道1號(基隆端到基隆交流道)',
    gisx: 121.735695,
    gisy: 25.1229931,
    html: 'https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10000',
  };

  const cam = normalizeTaiwanCamera(validFreewayRow, true);
  assert.ok(cam);
  assert.equal(cam.id, 'taiwan-cctv-n1-s-0-000-m');
  assert.equal(cam.name, '國道1號(基隆端到基隆交流道)');
  assert.equal(cam.cityId, 'taiwan');
  assert.equal(cam.provider, 'Taiwan Freeway Bureau');
  assert.equal(cam.feedType, 'mjpeg');
  assert.equal(cam.headingDeg, 180);
  assert.equal(cam.headingConfidence, 'high');
  assert.equal(cam.url, 'https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10000');
  assert.equal(cam.sourceKind, 'taiwan-open-data');

  // Security: Rejects non-HTTPS
  assert.equal(
    normalizeTaiwanCamera({ ...validFreewayRow, html: 'http://cctvn.freeway.gov.tw/stream' }),
    null,
  );

  // Security: Rejects third-party domain
  assert.equal(
    normalizeTaiwanCamera({ ...validFreewayRow, html: 'https://untrusted.com/video' }),
    null,
  );

  // Rejects out-of-bounds coordinates
  assert.equal(
    normalizeTaiwanCamera({ ...validFreewayRow, gisx: -97.74, gisy: 30.26 }),
    null,
  );

  // Rejects invalid / missing IDs
  assert.equal(normalizeTaiwanCamera({ ...validFreewayRow, id: '' }), null);
});

test('extractFirstMjpegFrame extracts JPEG frame from multipart/x-mixed-replace stream', async () => {
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0x11, 0x22, 0x33, 0xff, 0xd9]);
  const streamData = Buffer.concat([
    Buffer.from('--boundary\r\nContent-Type: image/jpeg\r\n\r\n'),
    fakeJpeg,
    Buffer.from('\r\n--boundary\r\n'),
  ]);

  let cancelled = false;
  const mockResponse = {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(streamData);
      },
      cancel() {
        cancelled = true;
      },
    }),
  };

  const frame = await extractFirstMjpegFrame(mockResponse, 1024 * 1024);
  assert.ok(frame);
  assert.deepEqual(frame, fakeJpeg);
  assert.equal(cancelled, true, 'Stream should be cancelled immediately once first frame is acquired');
});

test('extractFirstMjpegFrame cancels and returns null when byte cap is exceeded', async () => {
  let cancelled = false;
  const hugeChunk = Buffer.alloc(100 * 1024, 0x00);
  const mockResponse = {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(hugeChunk);
        controller.enqueue(hugeChunk);
      },
      cancel() {
        cancelled = true;
      },
    }),
  };

  const frame = await extractFirstMjpegFrame(mockResponse, 50 * 1024);
  assert.equal(frame, null);
  assert.equal(cancelled, true);
});

test('loadTaiwanSourcesFromOpenData prioritizes sources across anchors', async () => {
  const originalFetch = globalThis.fetch;
  const mockRows = [
    {
      id: 'CCTV-N1-N-1',
      stakenumber: '國道1號台北段',
      gisx: 121.56,
      gisy: 25.03,
      html: 'https://cctvn.freeway.gov.tw/cam1',
    },
    {
      id: 'CCTV-N1-S-2',
      stakenumber: '國道1號高雄段',
      gisx: 120.30,
      gisy: 22.62,
      html: 'https://cctvs.freeway.gov.tw/cam2',
    },
    {
      id: 'CCTV-N1-S-3',
      stakenumber: '國道1號台中段',
      gisx: 120.67,
      gisy: 24.14,
      html: 'https://cctvc.freeway.gov.tw/cam3',
    },
  ];

  globalThis.fetch = async (url) => {
    if (url.includes('freeway')) {
      return new Response(JSON.stringify(mockRows), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  try {
    const list = await loadTaiwanSourcesFromOpenData();
    assert.equal(list.length, 3);
    assert.ok(list.every((c) => c.id.startsWith('taiwan-')));
    assert.ok(list.some((c) => c.city === 'Taipei'));
    assert.ok(list.some((c) => c.city === 'Kaohsiung'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createCctvCatalog respects CCTV_TAIWAN_ENABLED env toggle', async () => {
  const originalEnv = process.env.CCTV_TAIWAN_ENABLED;
  try {
    process.env.CCTV_TAIWAN_ENABLED = '0';
    const getCatalog = createCctvCatalog();
    // In mock or default test environment without network, ensure disabled pack is not offered
    const originalFetch = globalThis.fetch;
    let fetchedTaiwan = false;
    globalThis.fetch = async (url) => {
      if (typeof url === 'string' && (url.includes('thbapp') || url.includes('freeway'))) {
        fetchedTaiwan = true;
      }
      return new Response('[]', { status: 200 });
    };
    try {
      await getCatalog();
      assert.equal(fetchedTaiwan, false, 'Taiwan sources should not be fetched when CCTV_TAIWAN_ENABLED=0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    if (originalEnv === undefined) delete process.env.CCTV_TAIWAN_ENABLED;
    else process.env.CCTV_TAIWAN_ENABLED = originalEnv;
  }
});
