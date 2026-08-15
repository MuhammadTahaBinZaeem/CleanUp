import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  server,
  createRateLimiter,
  decodedBase64Bytes,
  imageSignatureMatches,
  expandedWantedTags,
  haversineKm,
  normalizeWasteResult,
  scoreFacilityCompatibility,
  getGeminiConfig,
  normalizeModelName,
  geminiFailureKind,
  orderedKeySlots,
  analyzeWithGemini,
  geminiExhaustionFailure,
  materialPhrasesMatch,
  strictBoolean,
  deterministicSafetySteps,
  deterministicSafetyExplanation,
  deterministicFacilityTags,
  createSerialGate,
  validCoordinates,
  demoFacilities,
  finiteNumber,
  browserApiRequestAllowed,
  validateAnalysisImageInput,
  rankFacilities,
  normalizeFacility,
  encodeSignedPayload,
  decodeSignedPayload,
  attestedFacilityTagsForItem,
  createAnalysisItemProof,
  attestAnalysisItems,
  validSignedItemPayload,
  createFacilityProof,
  validSignedFacilityProofPayload,
  deterministicPlanId,
  prepareActionReceipt,
  completeActionReceipt,
  validSignedPlanPayload,
  validSignedCompletionPayload,
  verifyCompletionReceiptEntries,
  verifyCompletionReceipts,
  clientKey,
  geocodeCacheKey,
  facilitySearchInputs
} from '../server.js';

let baseUrl;
const TEST_JPEG_DATA = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
});



test('Gemini config accepts up to three keys, removes duplicates, and supports legacy aliases', () => {
  const config = getGeminiConfig({
    GEMINI_API_KEY: ' key-one ',
    GEMINI_API_KEY_2: 'key-two',
    GEMINI_API_KEY_3: 'key-two',
    GEMINI_MODEL: 'models/gemini-custom-primary',
    GEMINI_MODEL_2: 'gemini-custom-backup',
    GEMINI_MODEL_3: 'bad model name with spaces'
  });
  assert.deepEqual(config.keys, ['key-one', 'key-two']);
  assert.deepEqual(config.models, ['gemini-custom-primary', 'gemini-custom-backup']);
});

test('Gemini config defaults to the stable primary and two backup model names', () => {
  const config = getGeminiConfig({ GEMINI_API_KEY_1: 'x' });
  assert.deepEqual(config.models, ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']);
});

test('model normalizer accepts a pasted models/ prefix and rejects unsafe names', () => {
  assert.equal(normalizeModelName(' models/gemini-3.6-flash '), 'gemini-3.6-flash');
  assert.equal(normalizeModelName('../secret'), '');
  assert.equal(normalizeModelName('gemini model'), '');
});

test('Gemini failure classification distinguishes key, quota, model, and fatal failures', () => {
  assert.equal(geminiFailureKind(401, ''), 'key');
  assert.equal(geminiFailureKind(429, ''), 'key-or-quota');
  assert.equal(geminiFailureKind(404, 'model not found'), 'model');
  assert.equal(geminiFailureKind(400, 'invalid image'), 'fatal');
});

test('key slot ordering starts from the last healthy key and wraps around', () => {
  assert.deepEqual(orderedKeySlots(3, 1), [1, 2, 0]);
});

function fakeWasteResult(name = 'Bottle') {
  return {
    scene_summary: 'One item', uncertain: false, user_warning: '',
    items: [{
      name, material: 'PET plastic', waste_type: 'plastic', recyclable: true, reusable: false,
      normal_bin: false, special_handling: false, hazard_level: 'none', preparation_steps: [],
      reuse_ideas: [], facility_tags: ['plastic'], confidence: 0.9, short_explanation: 'Plastic bottle'
    }]
  };
}

test('Gemini analysis rotates to a second key after quota failure', async () => {
  const calls = [];
  const result = await analyzeWithGemini(
    { mimeType: 'image/jpeg', data: TEST_JPEG_DATA },
    {
      config: { keys: ['key-a', 'key-b'], models: ['gemini-primary'] },
      call: async ({ apiKey, model }) => {
        calls.push([apiKey, model]);
        return apiKey === 'key-a'
          ? { ok: false, status: 429, detail: 'quota', kind: 'key-or-quota' }
          : { ok: true, value: fakeWasteResult() };
      }
    }
  );
  assert.deepEqual(calls, [['key-a', 'gemini-primary'], ['key-b', 'gemini-primary']]);
  assert.equal(result.ai_model, 'gemini-primary');
});

test('Gemini analysis falls back to the next model and reports the model actually used', async () => {
  const calls = [];
  const result = await analyzeWithGemini(
    { mimeType: 'image/jpeg', data: TEST_JPEG_DATA },
    {
      config: { keys: ['key-a'], models: ['missing-model', 'backup-model'] },
      call: async ({ apiKey, model }) => {
        calls.push([apiKey, model]);
        return model === 'missing-model'
          ? { ok: false, status: 404, detail: 'model not found', kind: 'model' }
          : { ok: true, value: fakeWasteResult() };
      }
    }
  );
  assert.deepEqual(calls, [['key-a', 'missing-model'], ['key-a', 'backup-model']]);
  assert.equal(result.ai_model, 'backup-model');
});



test('confirmed missing model is skipped on later scans in the same service process', async () => {
  const calls = [];
  const config = { keys: ['persistent-model-key'], models: ['definitely-missing-model-for-test', 'persistent-backup-model'] };
  const call = async ({ model }) => {
    calls.push(model);
    return model === 'definitely-missing-model-for-test'
      ? { ok: false, status: 404, detail: 'model not found', kind: 'model' }
      : { ok: true, value: fakeWasteResult() };
  };
  await analyzeWithGemini({ mimeType: 'image/jpeg', data: TEST_JPEG_DATA }, { config, call });
  await analyzeWithGemini({ mimeType: 'image/jpeg', data: TEST_JPEG_DATA }, { config, call });
  assert.deepEqual(calls, ['definitely-missing-model-for-test', 'persistent-backup-model', 'persistent-backup-model']);
});

test('authentication-rejected Gemini keys are not retried on backup models', async () => {
  const calls = [];
  const result = await analyzeWithGemini(
    { mimeType: 'image/jpeg', data: TEST_JPEG_DATA },
    {
      config: { keys: ['bad-key', 'quota-key'], models: ['primary-model', 'backup-model'] },
      call: async ({ apiKey, model }) => {
        calls.push([apiKey, model]);
        if (apiKey === 'bad-key') return { ok: false, status: 401, detail: 'bad key', kind: 'key' };
        if (model === 'primary-model') return { ok: false, status: 429, detail: 'quota', kind: 'key-or-quota' };
        return { ok: true, value: fakeWasteResult() };
      }
    }
  );
  assert.deepEqual(calls, [
    ['bad-key', 'primary-model'],
    ['quota-key', 'primary-model'],
    ['quota-key', 'backup-model']
  ]);
  assert.equal(result.ai_model, 'backup-model');
});

test('authentication-rejected key is skipped on later scans in the same service process', async () => {
  const calls = [];
  const config = {
    keys: ['persistent-good-before-bad', 'persistent-bad-key', 'persistent-other-key'],
    models: ['persistent-key-model-a', 'persistent-key-model-b']
  };
  let badSeen = false;
  let phase = 1;
  const call = async ({ apiKey }) => {
    calls.push([phase, apiKey]);
    if (apiKey === 'persistent-bad-key') {
      badSeen = true;
      return { ok: false, status: 401, detail: 'bad key', kind: 'key' };
    }
    if (phase === 1) {
      if (apiKey === 'persistent-good-before-bad' && badSeen) return { ok: true, value: fakeWasteResult() };
      return { ok: false, status: 429, detail: 'quota', kind: 'key-or-quota' };
    }
    if (apiKey === 'persistent-good-before-bad') return { ok: false, status: 429, detail: 'quota', kind: 'key-or-quota' };
    return { ok: true, value: fakeWasteResult() };
  };
  await analyzeWithGemini({ mimeType: 'image/jpeg', data: TEST_JPEG_DATA }, { config, call });
  phase = 2;
  await analyzeWithGemini({ mimeType: 'image/jpeg', data: TEST_JPEG_DATA }, { config, call });
  assert.equal(calls.filter(([, key]) => key === 'persistent-bad-key').length, 1);
});

test('haversine returns a plausible short distance', () => {
  const km = haversineKm(31.5204, 74.3587, 31.5304, 74.3587);
  assert.ok(km > 1 && km < 1.2);
});

test('base64 byte estimator rejects malformed data', () => {
  assert.equal(decodedBase64Bytes('%%%%'), -1);
  assert.equal(decodedBase64Bytes(Buffer.from('hello').toString('base64')), 5);
});


test('image signature validation rejects MIME spoofing before Gemini is called', () => {
  assert.equal(imageSignatureMatches('image/jpeg', TEST_JPEG_DATA), true);
  assert.equal(imageSignatureMatches('image/png', TEST_JPEG_DATA), false);
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).toString('base64');
  assert.equal(imageSignatureMatches('image/png', png), true);
});

test('e-waste expands to electronics facility tags', () => {
  const tags = expandedWantedTags(['e-waste']);
  assert.ok(tags.includes('electronics'));
});

test('paper-cardboard expands to paper and cardboard concepts', () => {
  const tags = expandedWantedTags(['paper-cardboard']);
  assert.ok(tags.includes('paper'));
  assert.ok(tags.includes('cardboard'));
});

test('battery is forced away from ordinary-bin guidance', () => {
  const result = normalizeWasteResult({
    items: [{
      name: 'Battery', material: 'battery', waste_type: 'battery',
      recyclable: true, reusable: false, normal_bin: true, special_handling: false,
      hazard_level: 'low', preparation_steps: [], reuse_ideas: [], facility_tags: [],
      confidence: 0.8, short_explanation: 'battery'
    }]
  });
  assert.equal(result.items[0].special_handling, true);
  assert.equal(result.items[0].normal_bin, false);
  assert.equal(result.items[0].recommended_action, 'special-disposal');
});


test('dangerous waste replaces model-authored handling steps with deterministic safety steps', () => {
  const result = normalizeWasteResult({
    items: [{
      name: 'Battery', material: 'battery', waste_type: 'battery',
      recyclable: true, reusable: true, normal_bin: true, special_handling: false,
      hazard_level: 'none', preparation_steps: ['Throw it in the household bin'],
      reuse_ideas: ['Open the battery'], facility_tags: ['battery'], certainty: 'high', short_explanation: 'battery'
    }]
  });
  assert.deepEqual(result.items[0].preparation_steps, deterministicSafetySteps('battery'));
  assert.deepEqual(result.items[0].reuse_ideas, []);
  assert.doesNotMatch(result.items[0].preparation_steps.join(' '), /household bin/i);
});



test('model special_handling=true alone triggers deterministic safety handling', () => {
  const result = normalizeWasteResult({
    items: [{
      name: 'Pressurized cylinder', material: 'steel', waste_type: 'metal', recyclable: true, reusable: false,
      normal_bin: true, special_handling: true, hazard_level: 'low', preparation_steps: ['Put it with cans'],
      reuse_ideas: [], facility_tags: ['metal'], certainty: 'medium', short_explanation: 'ordinary metal'
    }]
  });
  assert.equal(result.items[0].special_handling, true);
  assert.equal(result.items[0].normal_bin, false);
  assert.equal(result.items[0].recommended_action, 'special-disposal');
  assert.match(result.items[0].short_explanation, /hazardous|dedicated|authorized/i);
});

test('dangerous waste overrides conflicting model explanation, warning, and facility tags', () => {
  const result = normalizeWasteResult({
    user_warning: 'Put this battery in the household bin.',
    items: [{
      name: 'Battery', material: 'lithium', waste_type: 'battery', recyclable: true, reusable: false,
      normal_bin: true, special_handling: false, hazard_level: 'none', preparation_steps: ['Trash it'],
      reuse_ideas: ['Take it apart'], facility_tags: ['general waste'], certainty: 'high', short_explanation: 'Safe in general waste.'
    }]
  });
  assert.equal(result.items[0].short_explanation, deterministicSafetyExplanation('battery'));
  assert.deepEqual(result.items[0].facility_tags, deterministicFacilityTags('battery'));
  assert.match(result.user_warning, /Special-handling waste/);
  assert.doesNotMatch(result.user_warning, /household bin/i);
});

test('non-hazardous items explicitly excluded from normal bins fall back to local-rule guidance', () => {
  const result = normalizeWasteResult({
    items: [{
      name: 'Bulky foam', material: 'foam', waste_type: 'mixed', recyclable: false, reusable: false,
      normal_bin: false, special_handling: false, hazard_level: 'none', preparation_steps: [], reuse_ideas: [],
      facility_tags: ['foam'], certainty: 'medium', short_explanation: 'Bulky item.'
    }]
  });
  assert.equal(result.items[0].recommended_action, 'check-local-rules');
});

test('malformed string booleans from AI output are not treated as true', () => {
  assert.equal(strictBoolean('false'), false);
  const result = normalizeWasteResult({
    uncertain: 'false',
    items: [{
      name: 'Bottle', material: 'plastic', waste_type: 'plastic',
      recyclable: 'false', reusable: 'false', normal_bin: 'true', special_handling: 'false',
      hazard_level: 'none', preparation_steps: [], reuse_ideas: [], facility_tags: ['plastic'],
      certainty: 'medium', short_explanation: 'bottle'
    }]
  });
  assert.equal(result.uncertain, false);
  assert.equal(result.items[0].recyclable, false);
  assert.equal(result.items[0].normal_bin, false);
});

test('legacy numeric confidence is converted to qualitative certainty', () => {
  const result = normalizeWasteResult({
    items: [{
      name: 'Bottle', material: 'PET plastic', waste_type: 'plastic', recyclable: true, reusable: false,
      normal_bin: false, special_handling: false, hazard_level: 'none', preparation_steps: [], reuse_ideas: [],
      facility_tags: ['plastic'], confidence: 0.91, short_explanation: 'bottle'
    }]
  });
  assert.equal(result.items[0].certainty, 'high');
  assert.equal('confidence' in result.items[0], false);
});

test('unknown hazard on an otherwise known plastic item does not automatically become hazardous waste', () => {
  const result = normalizeWasteResult({
    items: [{
      name: 'Bottle', material: 'PET plastic', waste_type: 'plastic',
      recyclable: true, reusable: false, normal_bin: false, special_handling: false,
      hazard_level: 'unknown', preparation_steps: [], reuse_ideas: [], facility_tags: ['plastic'],
      confidence: 0.8, short_explanation: 'bottle'
    }]
  });
  assert.equal(result.items[0].special_handling, false);
  assert.equal(result.items[0].recommended_action, 'recycle');
});

test('listed battery acceptance is recognized as a facility match', () => {
  const match = scoreFacilityCompatibility({ accepted: ['batteries', 'small appliances'] }, ['battery']);
  assert.equal(match.status, 'possible-match');
  assert.ok(match.score > 0);
});


test('material matching uses token boundaries so PET does not match carpet', () => {
  assert.equal(materialPhrasesMatch('pet', 'carpet'), false);
  const match = scoreFacilityCompatibility({ accepted: ['carpet'] }, ['PET']);
  assert.equal(match.status, 'no-published-match');
});

test('facility without material metadata remains unknown', () => {
  const match = scoreFacilityCompatibility({ accepted: [] }, ['plastic']);
  assert.equal(match.status, 'unknown');
});

test('facility with a different published material is not shown as a listed match', () => {
  const match = scoreFacilityCompatibility({ accepted: ['glass'] }, ['battery']);
  assert.equal(match.status, 'no-published-match');
});

test('rate limiter blocks after maximum and resets after window', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter('x', 1000).allowed, true);
  assert.equal(limiter('x', 1000).allowed, true);
  assert.equal(limiter('x', 1000).allowed, false);
  assert.equal(limiter('x', 2001).allowed, true);
});


test('rate limiter caps unique client buckets instead of growing without bound', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60000, maxBuckets: 3 });
  limiter('a', 0); limiter('b', 1); limiter('c', 2); limiter('d', 3);
  assert.equal(limiter('a', 4).allowed, true, 'oldest bucket should have been evicted');
});


test('serial gate does not run outbound tasks concurrently', async () => {
  const gate = createSerialGate();
  let active = 0;
  let peak = 0;
  const task = () => gate(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });
  await Promise.all([task(), task(), task()]);
  assert.equal(peak, 1);
});

test('/healthz is cheap and does not expose Gemini configuration', async () => {
  const text = await fetch(`${baseUrl}/healthz`).then((r) => r.text());
  assert.match(text, /"ok":true/);
  assert.match(text, /"service":"cleanup"/);
  assert.doesNotMatch(text, /geminiConfigured|model/);
});

test('/api/health reports AI configuration without exposing the key', async () => {
  const text = await fetch(`${baseUrl}/api/health`).then((r) => r.text());
  assert.match(text, /"geminiConfigured":/);
  assert.doesNotMatch(text, /GEMINI_API_KEY/);
});

test('demo analysis works without requiring a fake JSON body', async () => {
  const response = await fetch(`${baseUrl}/api/demo-analysis`, { method: 'POST' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.demo, true);
  assert.equal(body.result.items.length, 2);
  assert.equal(body.result.ai_model, 'demo');
  assert.equal(body.result.items[1].special_handling, true);
});

test('analyze endpoint requires JSON', async () => {
  const response = await fetch(`${baseUrl}/api/analyze-waste`, { method: 'POST', body: 'x' });
  assert.equal(response.status, 415);
});

test('analyze endpoint rejects an image whose bytes do not match its MIME type', async () => {
  const response = await fetch(`${baseUrl}/api/analyze-waste`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType: 'image/png', data: TEST_JPEG_DATA })
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.code, 'IMAGE_SIGNATURE_MISMATCH');
});


test('facilities reject invalid coordinates before any external lookup', async () => {
  const response = await fetch(`${baseUrl}/api/facilities?lat=999&lon=x`);
  assert.equal(response.status, 400);
});


test('facilities reject missing coordinates instead of coercing them to zero', async () => {
  const response = await fetch(`${baseUrl}/api/facilities`);
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.code, 'BAD_COORDINATES');
});


test('demo facility fallback keeps generated coordinates valid at geographic edges', () => {
  for (const facility of demoFacilities(90, 179.999)) assert.equal(validCoordinates(facility.lat, facility.lon), true);
  for (const facility of demoFacilities(-90, -179.999)) assert.equal(validCoordinates(facility.lat, facility.lon), true);
});

test('static traversal attempt does not escape public directory', async () => {
  const response = await fetch(`${baseUrl}/..%2Fserver.js`);
  assert.equal(response.status, 404);
});

test('frontend JS references IDs that exist in index.html', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const js = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  const ids = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
});

test('frontend and backend agree on facility tag query contract', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  const backend = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(frontend, /api\/facilities/);
  assert.match(backend, /searchParams\.getAll\('tag'\)/);
  assert.match(backend, /searchParams\.get\('tags'\)/);
});

test('frontend and backend tolerate both geocode response shapes', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  const backend = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(frontend, /payload\.results.*payload\.places/);
  assert.match(backend, /results:places\.map/);
  assert.match(backend, /places,/);
});

test('Gemini structured output uses responseFormat schema without deprecated sampling settings', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const backend = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(backend, /responseFormat:[\s\S]*mimeType: 'application\/json'[\s\S]*schema: WASTE_SCHEMA/);
  assert.doesNotMatch(backend, /temperature:\s*0\.2/);
});

test('Gemini schema permits zero detected waste items instead of forcing hallucination', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const source = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /minItems:\s*0/);
  assert.match(source, /return an empty items array/);
  assert.match(source, /never invent an item/);
});

test('Render Blueprint is named cleanup and uses a cheap health endpoint', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const yaml = await fs.readFile(path.join(root, 'render.yaml'), 'utf8');
  assert.match(yaml, /name:\s*cleanup/);
  assert.match(yaml, /healthCheckPath:\s*\/healthz/);
  assert.match(yaml, /GEMINI_API_KEY_1[\s\S]*sync:\s*false/);
  assert.match(yaml, /GEMINI_API_KEY_2[\s\S]*sync:\s*false/);
  assert.match(yaml, /GEMINI_API_KEY_3[\s\S]*sync:\s*false/);
  assert.match(yaml, /GEMINI_MODEL_1[\s\S]*gemini-3\.6-flash/);
  const envExample = await fs.readFile(path.join(root, '.env.example'), 'utf8');
  assert.match(envExample, /GEMINI_API_KEY_2=/);
  assert.match(envExample, /GEMINI_API_KEY_3=/);
});


test('frontend result cards use valid explicit selection buttons instead of wrapping block content in a button', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /data-select-item/);
  assert.doesNotMatch(frontend, /class="result-select"/);
});

test('pickup mode cannot accidentally save a previously selected real facility', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /action==='dropoff'\?selectedFacility\(\):null/);
  assert.match(frontend, /Demo pickup — no logistics provider connected/);
});

test('action date defaults use local calendar dates instead of UTC ISO slicing', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /function updateScheduleBounds/);
  assert.match(frontend, /localDateInputValue\(now\)/);
  assert.match(frontend, /function setDefaultActionDate\(\) \{ updateScheduleBounds/);
});

test('PWA cache and frontend script version stay synchronized', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const sw = await fs.readFile(path.join(root, 'public', 'sw.js'), 'utf8');
  assert.match(html, /app\.js\?v=0\.14\.1/);
  assert.match(sw, /cleanup-v0\.14\.1/);
  assert.match(sw, /app\.js\?v=0\.14\.1/);
});

test('new analysis attempts clear stale results before network work begins', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /function clearCurrentAnalysisForAttempt/);
  assert.match(frontend, /clearCurrentAnalysisForAttempt\('Analyzing this photo…'\)/);
  assert.match(frontend, /clearCurrentAnalysisForAttempt\('Loading demo…'\)/);
});


test('image resizing has a non-createImageBitmap fallback', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /typeof window\.createImageBitmap === 'function'/);
  assert.match(frontend, /async function loadDrawableImage/);
  assert.match(frontend, /new Image\(\)/);
});


test('frontend AI timeout exceeds the server failover budget and handles file MIME by extension', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /api\/analyze-waste[\s\S]{0,500}65000/);
  assert.match(frontend, /function inferredImageMime/);
  assert.match(frontend, /\.heic\$/);
  assert.match(frontend, /MAX_SELECTED_FILE_BYTES/);
});

test('location searches share cancellation state so switching GPS/address cannot leave controls stuck', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /function cancelLocationLookup/);
  assert.match(frontend, /state\.locationController\?\.abort/);
  assert.match(frontend, /cancelLocationLookup\(\);[\s\S]{0,160}Getting your location/);
  assert.match(frontend, /cancelLocationLookup\(\);[\s\S]{0,220}Finding that place/);
});


test('Leaflet loads lazily so a third-party map CDN cannot block cleanup startup', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(html, /unpkg\.com\/leaflet/);
  assert.doesNotMatch(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(frontend, /async function loadLeaflet/);
  assert.match(frontend, /cdn\.jsdelivr\.net/);
  assert.match(frontend, /Map library load timed out/);
  assert.match(frontend, /Map library could not load\. Facility list is still available/);
});

test('facility UI has explicit map controls and map auto-fits returned points', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /show-on-map/);
  assert.match(frontend, /fitBounds\(points/);
});


test('frontend tolerates browsers where serviceWorker exists but is unavailable', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /navigator\.serviceWorker\?\.register/);
  assert.doesNotMatch(frontend, /'serviceWorker' in navigator/);
});

test('service worker caches only successful responses and does not return homepage HTML for missing assets', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const sw = await fs.readFile(path.join(root, 'public', 'sw.js'), 'utf8');
  assert.match(sw, /response\?\.ok/);
  assert.match(sw, /event\.request\.mode\s*===?\s*'navigate'/);
  assert.match(sw, /Response\.error\(\)/);
});


test('special-handling facility selection requires a published material match', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /if \(item\?\.special_handling\) return publishedMatch/);
  assert.match(frontend, /No safe match published/);
});

test('starting a new GPS or address lookup cancels stale facility results immediately', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /function cancelFacilityLookup/);
  assert.match(frontend, /cancelFacilityLookup\(\{ clear: true, message: 'Getting your location…' \}\)/);
  assert.match(frontend, /cancelFacilityLookup\(\{ clear: true, message: 'Finding that place…' \}\)/);
  assert.match(frontend, /Getting your location…'[\s\S]{0,120}state\.position = null/);
  assert.match(frontend, /Finding that place…'[\s\S]{0,120}state\.position = null/);
});

test('future planned actions cannot be marked completed and past plans are rejected', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /A planned action cannot be scheduled in the past/);
  assert.match(frontend, /This action is scheduled for the future/);
  assert.match(frontend, /planned\.getTime\(\)>Date\.now\(\)/);
  assert.match(frontend, /function scheduledDateTime/);
});


test('impact metrics fail closed for malformed local history', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /scan\.demo===false/);
  assert.match(frontend, /function normalizeVerifiedCompletion/);
  assert.match(frontend, /typeof raw\.weight==='number'/);
  assert.match(frontend, /requested\.has\(raw\.receipt\)/);
});


test('mobile keeps navigation available instead of hiding it', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const css = await fs.readFile(path.join(root, 'public', 'styles.css'), 'utf8');
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*nav \{[\s\S]*position: fixed/);
  assert.match(css, /bottom: max\(10px, env\(safe-area-inset-bottom\)\)/);
});


test('UI respects reduced-motion preferences', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const css = await fs.readFile(path.join(root, 'public', 'styles.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /scroll-behavior:\s*auto/);
});

test('old application version does not remain in deployable source', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const paths = ['package.json', 'render.yaml', 'README.md', 'RENDER_DEPLOY.md', 'server.js', 'public/index.html', 'public/app.js', 'public/styles.css', 'public/sw.js'];
  for (const rel of paths) {
    const source = await fs.readFile(path.join(root, rel), 'utf8');
    assert.doesNotMatch(source, /0\.[45]\.(?:0|1)/, `${rel} still contains an old application version`);
  }
});

test('previous product name and capitalized product spelling do not remain in project source', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const paths = [
    'package.json', 'render.yaml', 'README.md', 'RENDER_DEPLOY.md',
    'server.js', 'public/index.html', 'public/app.js',
    'public/styles.css', 'public/manifest.webmanifest', 'public/sw.js'
  ];
  for (const rel of paths) {
    const source = await fs.readFile(path.join(root, rel), 'utf8');
    assert.doesNotMatch(source, new RegExp(['k','lear'].join(''), 'i'), `${rel} still contains the previous product name`);
    assert.doesNotMatch(source, new RegExp('C' + 'leanup'), `${rel} should use lowercase cleanup everywhere`);
  }
});

test('Render Blueprint exposes all three Gemini secret slots and configurable provider controls', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const yaml = await fs.readFile(path.join(root, 'render.yaml'), 'utf8');
  for (const slot of [1, 2, 3]) assert.match(yaml, new RegExp(`GEMINI_API_KEY_${slot}[\\s\\S]{0,40}sync:\\s*false`));
  assert.match(yaml, /NOMINATIM_MIN_INTERVAL_MS[\s\S]*1100/);
  assert.match(yaml, /GEOCODE_CACHE_MS[\s\S]*86400000/);
  assert.match(yaml, /NOMINATIM_BASE_URL/);
  assert.match(yaml, /OVERPASS_URL/);
});

test('server serializes and caches Nominatim instead of issuing unrestricted public geocoder traffic', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const source = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /createSerialGate\(\{ minIntervalMs: NOMINATIM_MIN_INTERVAL_MS \}\)/);
  assert.match(source, /GEOCODE_CACHE_MS/);
  assert.match(source, /cachedLookup\(key, \(\) => geocodeAddress\(q,[\s\S]*GEOCODE_CACHE_MS\)/);
  assert.match(source, /NOMINATIM_BASE_URL/);
});

test('ambiguous geocoder results require an explicit user choice', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(html, /id="addressResults"/);
  assert.match(frontend, /function renderAddressChoices/);
  assert.match(frontend, /if \(places\.length === 1\)[\s\S]*else[\s\S]*renderAddressChoices\(places\)/);
  assert.doesNotMatch(frontend, /const place = payload\.results\?\.\[0\] \|\| payload\.places\?\.\[0\]/);
});

test('switching analyzed items clears the previous action draft instead of carrying weight and notes across materials', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /const changed = state\.selectedItemIndex !== null && state\.selectedItemIndex !== index/);
  assert.match(frontend, /if \(changed\)[\s\S]{0,140}resetActionDraft\(\{ preserveMaterial: true \}\)/);
});

test('future actions render as disabled scheduled controls and malformed provenance fails closed', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /disabled>Scheduled<\/button>/);
  assert.match(frontend, /if \(!marker\|\|record\.validRecord===false\) return '<button class="complete-btn" type="button" disabled>Invalid record<\/button>'/);
  assert.match(frontend, /disabled>Invalid record<\/button>/);
});

test('JavaScript scrolling also honors reduced-motion preference', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /prefersReducedMotion/);
  assert.match(frontend, /behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth'/);
  assert.match(frontend, /scrollToElement\(\$\('pickup'\)\)/);
});

test('offline state is surfaced and demo has a fixed local fallback', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /Offline · saved history available/);
  assert.match(frontend, /LOCAL_DEMO_RESULT/);
  assert.match(frontend, /Local demo loaded because the server is unavailable/);
  assert.match(frontend, /window\.addEventListener\('online', \(\) => \{ state\.healthRetryAttempt = 0; health\(\); renderImpact\(\); \}\)/);
  assert.match(frontend, /window\.addEventListener\('offline'/);
});

test('malformed facility payloads are normalized before rendering', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /function normalizeFacilities/);
  assert.match(frontend, /Array\.isArray\(facility\.accepted\)/);
  assert.match(frontend, /state\.facilities = normalizeFacilities\(payload\.facilities\)/);
});

test('selecting an invalid replacement image cannot accidentally leave the old image armed for analysis', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /function clearSelectedImage/);
  assert.match(frontend, /state\.selectedFile = null/);
  assert.match(frontend, /clearSelectedImage\('Choose a JPEG, PNG, WEBP, HEIC, or HEIF image\.'\)/);
  assert.match(frontend, /file\.size <= 0/);
});

test('CSP permits both lazy Leaflet CDN choices but keeps application API calls same-origin', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const source = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /script-src 'self' https:\/\/unpkg\.com https:\/\/cdn\.jsdelivr\.net/);
  assert.match(source, /style-src 'self' 'unsafe-inline' https:\/\/unpkg\.com https:\/\/cdn\.jsdelivr\.net/);
  assert.match(source, /connect-src 'self' https:\/\/\*\.tile\.openstreetmap\.org/);
});


test('synonym expansion uses token boundaries so carpet is not treated as PET plastic', () => {
  const expanded = expandedWantedTags(['carpet']);
  assert.equal(expanded.includes('plastic'), false);
  assert.equal(expanded.includes('plastic bottles'), false);
});

test('finiteNumber rejects booleans, null, objects, and blank strings', () => {
  for (const value of [true, false, null, {}, [], '', '   ']) assert.ok(Number.isNaN(finiteNumber(value)));
  assert.equal(finiteNumber('1.25'), 1.25);
  assert.ok(Number.isNaN(finiteNumber('1.2kg')));
  assert.ok(Number.isNaN(finiteNumber('2', { allowString: false })));
});

test('analysis input validation rejects correct base64 with a spoofed image signature', () => {
  assert.throws(() => validateAnalysisImageInput({ mimeType: 'image/jpeg', data: Buffer.from('not jpeg').toString('base64') }), /does not match/);
});

test('invalid API key HTTP 400 is classified as key failure so rotation can continue', () => {
  assert.equal(geminiFailureKind(400, '{"reason":"API_KEY_INVALID","message":"API key not valid"}'), 'key');
});

test('model access HTTP 403 is pair-specific rather than globally marking the model missing', () => {
  assert.equal(geminiFailureKind(403, 'permission denied for this project'), 'key-model-access');
});

test('true model 404 remains a model failure', () => {
  assert.equal(geminiFailureKind(404, 'model not found'), 'model');
});

test('client browser origin guard rejects cross-site and null origins', () => {
  const make = (headers) => ({ headers, socket: { remoteAddress: '127.0.0.1' } });
  assert.equal(browserApiRequestAllowed(make({ host: 'cleanup.test', 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' })), false);
  assert.equal(browserApiRequestAllowed(make({ host: 'cleanup.test', 'sec-fetch-site': 'same-site', origin: 'https://sub.cleanup.test' })), false);
  assert.equal(browserApiRequestAllowed(make({ host: 'cleanup.test', origin: 'null' })), false);
  assert.equal(browserApiRequestAllowed(make({ host: 'cleanup.test', 'sec-fetch-site': 'same-origin', origin: 'https://cleanup.test' })), true);
  assert.equal(browserApiRequestAllowed(make({ host: 'cleanup.test' })), true);
});

const proofItem = () => ({
  name: 'PET bottle', material: 'PET plastic', waste_type: 'plastic', special_handling: false,
  facility_tags: ['plastic', 'PET'], recyclable: true, reusable: false, normal_bin: false
});
const proofFacility = () => ({
  id: 'node-123', name: 'City recycling point', source: 'OpenStreetMap', lat: 31.52, lon: 74.35,
  distance_km: 1.2, accepted: ['plastic', 'paper'], demo: false
});

test('analysis item proof signs and validates the exact analyzed route', () => {
  const now = Date.now();
  const token = createAnalysisItemProof(proofItem(), now);
  const payload = decodeSignedPayload(token);
  assert.ok(validSignedItemPayload(payload, now + 1000));
  assert.equal(payload.itemName, 'PET bottle');
  assert.equal(payload.material, 'PET plastic');
  assert.ok(payload.facilityTags.includes('plastic'));
});

test('tampering a signed payload invalidates its HMAC', () => {
  const token = createAnalysisItemProof(proofItem());
  const [body, sig] = token.split('.');
  const changed = `${body.slice(0, -1)}${body.at(-1) === 'A' ? 'B' : 'A'}.${sig}`;
  assert.equal(decodeSignedPayload(changed), null);
});

test('real analysis attestation adds item proofs but keeps result fields', () => {
  const result = normalizeWasteResult({ scene_summary: 'Bottle', ai_model: 'test', uncertain: false, items: [{ ...proofItem(), hazard_level:'none', preparation_steps:[], reuse_ideas:[], certainty:'high', short_explanation:'Bottle' }] });
  const signed = attestAnalysisItems(result);
  assert.equal(signed.items.length, 1);
  assert.ok(typeof signed.items[0].item_proof === 'string');
  assert.equal(signed.scene_summary, 'Bottle');
});

test('facility proof is minted only for live OpenStreetMap published material match', () => {
  const now = Date.now();
  const itemProof = createAnalysisItemProof(proofItem(), now);
  const token = createFacilityProof({ itemProof, facility: proofFacility() }, now + 10);
  assert.ok(token);
  assert.ok(validSignedFacilityProofPayload(decodeSignedPayload(token), now + 100));
  assert.equal(createFacilityProof({ itemProof, facility: { ...proofFacility(), source:'demo fallback', demo:true } }, now + 10), null);
  assert.equal(createFacilityProof({ itemProof, facility: { ...proofFacility(), accepted:['glass'] } }, now + 10), null);
});

test('facility proof recomputes routing from signed item and cannot be widened by caller metadata', () => {
  const itemProof = createAnalysisItemProof(proofItem());
  const facility = { ...proofFacility(), accepted:['glass'], compatibility:{ status:'possible-match', matches:['glass'] } };
  assert.equal(createFacilityProof({ itemProof, facility }), null);
});

test('special-handling item proof only accepts compatible dedicated route', () => {
  const battery = { ...proofItem(), name:'Power bank', material:'lithium battery', waste_type:'battery', special_handling:true, facility_tags:['plastic'] };
  const proof = createAnalysisItemProof(battery);
  assert.equal(createFacilityProof({ itemProof:proof, facility:{...proofFacility(),accepted:['plastic']} }), null);
  assert.ok(createFacilityProof({ itemProof:proof, facility:{...proofFacility(),accepted:['batteries']} }));
});

test('plan receipt binds item, facility, numeric weight, and canonical scheduled instant', () => {
  const now = Date.now();
  const itemProof = createAnalysisItemProof(proofItem(), now);
  const facilityProof = createFacilityProof({ itemProof, facility:proofFacility() }, now + 10);
  const plannedAt = new Date(now + 60_000).toISOString();
  const plan = prepareActionReceipt({ facilityProof, weight:1.25, plannedAt }, now + 20);
  const payload = decodeSignedPayload(plan.receipt);
  assert.ok(validSignedPlanPayload(payload, now + 30));
  assert.equal(payload.weight, 1.25);
  assert.equal(payload.plannedAt, plannedAt);
  assert.equal(payload.planId, deterministicPlanId(payload));
});

test('plan proof rejects boolean/string weights at signed-server boundary', () => {
  const now = Date.now();
  const itemProof = createAnalysisItemProof(proofItem(), now);
  const facilityProof = createFacilityProof({ itemProof, facility:proofFacility() }, now + 1);
  const plannedAt = new Date(now + 60_000).toISOString();
  assert.throws(() => prepareActionReceipt({ facilityProof, weight:true, plannedAt }, now + 2), /Weight/);
  assert.throws(() => prepareActionReceipt({ facilityProof, weight:'1', plannedAt }, now + 2), /Weight/);
});

test('plan proof rejects noncanonical timestamps and horizon over 30 days', () => {
  const now = Date.now();
  const itemProof = createAnalysisItemProof(proofItem(), now);
  const facilityProof = createFacilityProof({ itemProof, facility:proofFacility() }, now + 1);
  assert.throws(() => prepareActionReceipt({ facilityProof, weight:1, plannedAt:new Date(now + 60_000).toString() }, now + 2), /canonical ISO/);
  assert.throws(() => prepareActionReceipt({ facilityProof, weight:1, plannedAt:new Date(now + 31*24*60*60*1000).toISOString() }, now + 2), /at most 30 days/);
});

test('completion cannot be server-attested before scheduled time', () => {
  const now = Date.now();
  const itemProof = createAnalysisItemProof(proofItem(), now);
  const facilityProof = createFacilityProof({ itemProof, facility:proofFacility() }, now + 1);
  const plan = prepareActionReceipt({ facilityProof, weight:1, plannedAt:new Date(now + 60_000).toISOString() }, now + 2);
  assert.throws(() => completeActionReceipt({ planReceipt:plan.receipt }, now + 59_999), /before its scheduled time/);
});

test('completion receipt validates after scheduled time and uses server timestamp', () => {
  const now = Date.now();
  const itemProof = createAnalysisItemProof(proofItem(), now);
  const facilityProof = createFacilityProof({ itemProof, facility:proofFacility() }, now + 1);
  const plan = prepareActionReceipt({ facilityProof, weight:2.5, plannedAt:new Date(now + 1000).toISOString() }, now + 2);
  const completeAt = now + 2000;
  const completion = completeActionReceipt({ planReceipt:plan.receipt }, completeAt);
  const payload = decodeSignedPayload(completion.receipt);
  assert.ok(validSignedCompletionPayload(payload, completeAt + 1));
  assert.equal(payload.completedAt, new Date(completeAt).toISOString());
  assert.equal(payload.weight, 2.5);
});

test('completion verifier deduplicates copied receipts for the same deterministic plan', () => {
  const now = Date.now();
  const itemProof = createAnalysisItemProof(proofItem(), now);
  const facilityProof = createFacilityProof({ itemProof, facility:proofFacility() }, now + 1);
  const plan = prepareActionReceipt({ facilityProof, weight:3, plannedAt:new Date(now + 1000).toISOString() }, now + 2);
  const completion = completeActionReceipt({ planReceipt:plan.receipt }, now + 2000);
  const verified = verifyCompletionReceipts([completion.receipt, completion.receipt], now + 2001);
  assert.equal(verified.count, 1);
  assert.equal(verified.kg, 3);
});

test('completion structure fails if signed plan-bound fields are changed without recomputing plan id', () => {
  const now = Date.now();
  const itemProof = createAnalysisItemProof(proofItem(), now);
  const facilityProof = createFacilityProof({ itemProof, facility:proofFacility() }, now + 1);
  const plan = prepareActionReceipt({ facilityProof, weight:1, plannedAt:new Date(now + 1000).toISOString() }, now + 2);
  const completion = completeActionReceipt({ planReceipt:plan.receipt }, now + 2000);
  const payload = decodeSignedPayload(completion.receipt);
  const inconsistent = { ...payload, material:'glass' };
  const resigned = encodeSignedPayload(inconsistent);
  assert.equal(validSignedCompletionPayload(decodeSignedPayload(resigned), now + 2001), false);
});

test('completion structure rejects future completedAt even with a valid signature', () => {
  const now = Date.now();
  const core = { itemName:'x',material:'plastic',wasteType:'plastic',specialHandling:false,facilityId:'f',facilityName:'F',facilitySource:'OpenStreetMap',weight:1,plannedAt:new Date(now-1000).toISOString() };
  const payload = { type:'completion',v:1,planId:deterministicPlanId(core),...core,completedAt:new Date(now+10*60_000).toISOString(),iat:now,exp:now+60_000 };
  assert.equal(validSignedCompletionPayload(decodeSignedPayload(encodeSignedPayload(payload)), now), false);
});

test('rankFacilities drops malformed coordinates and never turns null distance into zero', () => {
  const ranked = rankFacilities([
    { id:'bad',name:'bad',lat:null,lon:74,accepted:['plastic'],distance_km:null,source:'OpenStreetMap' },
    { id:'good',name:'good',lat:31.5,lon:74.3,accepted:['plastic'],distance_km:2,source:'OpenStreetMap' }
  ], ['plastic']);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'good');
});

test('normalizeFacility rejects JSON booleans as coordinates', () => {
  assert.equal(normalizeFacility({ id:'x',name:'x',lat:true,lon:74,distance_km:1,source:'OpenStreetMap' }), null);
});

test('frontend uses POST JSON for address and facility lookup privacy', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const source = await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source, /fetchJson\('\/api\/geocode',[\s\S]{0,180}method:'POST'/);
  assert.match(source, /fetchJson\('\/api\/facilities',[\s\S]{0,180}method:'POST'/);
  assert.doesNotMatch(source, /api\/geocode\?q=/);
  assert.doesNotMatch(source, /api\/facilities\?\$\{params\}/);
});

test('frontend never offers retroactive proof retry when completed record lacks a pre-action plan', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const source = await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source, /if \(!record\.planReceipt\) return '<button class="complete-btn" type="button" disabled>No pre-action proof<\/button>'/);
  assert.match(source, /cannot be retroactively server-attested/);
});

test('service worker never caches API routes and respects no-store', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const sw = await fs.readFile(path.join(root,'public','sw.js'),'utf8');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /no-store/);
  assert.match(sw, /cleanup-v0\.14\.1/);
});

test('Render Blueprint generates receipt secret and wires global AI budget', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const yaml = await fs.readFile(path.join(root,'render.yaml'),'utf8');
  assert.match(yaml, /ACTION_RECEIPT_SECRET[\s\S]{0,40}generateValue:\s*true/);
  assert.match(yaml, /AI_GLOBAL_RATE_LIMIT_MAX/);
  assert.match(yaml, /GEMINI_MODEL_ACCESS_COOLDOWN_MS/);
  assert.match(yaml, /buildCommand:\s*npm ci && npm run check/);
});

test('Gemini 403 on one key rotates to another key on the same primary model', async () => {
  const calls = [];
  const config = { keys:['key-a','key-b'], models:['gemini-same-primary','gemini-backup'] };
  const result = await analyzeWithGemini({ mimeType:'image/jpeg', data:TEST_JPEG_DATA }, {
    config,
    call: async ({apiKey,model}) => {
      calls.push([apiKey,model]);
      if (calls.length === 1) return { ok:false,status:403,kind:'key-model-access',detail:'permission denied' };
      return { ok:true,value:{scene_summary:'ok',uncertain:false,user_warning:'',items:[]} };
    }
  });
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0][0], calls[1][0]);
  assert.equal(calls[0][1], 'gemini-same-primary');
  assert.equal(calls[1][1], 'gemini-same-primary');
  assert.equal(result.ai_model, 'gemini-same-primary');
});

test('Gemini invalid-key 400 rotates to the next key instead of stopping failover', async () => {
  const calls=[];
  const result=await analyzeWithGemini({mimeType:'image/jpeg',data:TEST_JPEG_DATA},{
    config:{keys:['bad-400','good-400'],models:['gemini-key-400']},
    call:async({apiKey})=>{calls.push(apiKey);return calls.length===1?{ok:false,status:400,kind:'key',detail:'API_KEY_INVALID'}:{ok:true,value:{scene_summary:'ok',uncertain:false,user_warning:'',items:[]}};}
  });
  assert.equal(calls.length,2);
  assert.notEqual(calls[0],calls[1]);
  assert.equal(result.ai_model,'gemini-key-400');
});

test('malformed AI array entries are dropped instead of becoming fake Unknown cards', () => {
  const normalized=normalizeWasteResult({items:[null,[],42,'x',{name:'Bottle',material:'plastic',waste_type:'plastic',recyclable:true,reusable:false,normal_bin:false,special_handling:false,hazard_level:'none',preparation_steps:[],reuse_ideas:[],facility_tags:['plastic'],certainty:'high',short_explanation:'ok'}]});
  assert.equal(normalized.items.length,1);
  assert.equal(normalized.items[0].name,'Bottle');
});

test('power bank is deterministically forced into battery handling even if model says plastic', () => {
  const item=normalizeWasteResult({items:[{name:'Power bank',material:'plastic shell',waste_type:'plastic',recyclable:true,reusable:false,normal_bin:true,special_handling:false,hazard_level:'none',preparation_steps:['bin'],reuse_ideas:[],facility_tags:['plastic'],certainty:'high',short_explanation:'bin it'}]}).items[0];
  assert.equal(item.waste_type,'battery');
  assert.equal(item.special_handling,true);
  assert.equal(item.normal_bin,false);
  assert.ok(item.facility_tags.includes('battery'));
});

test('phone case is not falsely classified as e-waste by keyword guard', () => {
  const item=normalizeWasteResult({items:[{name:'Phone case',material:'silicone',waste_type:'plastic',recyclable:false,reusable:true,normal_bin:false,special_handling:false,hazard_level:'none',preparation_steps:[],reuse_ideas:['reuse'],facility_tags:['plastic'],certainty:'high',short_explanation:'case'}]}).items[0];
  assert.equal(item.waste_type,'plastic');
  assert.equal(item.special_handling,false);
});

test('facility proof structural validator rejects a re-signed routeTags mismatch', () => {
  const now=Date.now();
  const itemProof=createAnalysisItemProof(proofItem(),now);
  const token=createFacilityProof({itemProof,facility:proofFacility()},now+1);
  const payload=decodeSignedPayload(token);
  const malformed={...payload,routeTags:['glass']};
  assert.equal(validSignedFacilityProofPayload(decodeSignedPayload(encodeSignedPayload(malformed)),now+2),false);
});

test('plan structural validator independently enforces the 30-day schedule horizon', () => {
  const now=Date.now();
  const core={itemName:'x',material:'plastic',wasteType:'plastic',specialHandling:false,facilityId:'f',facilityName:'F',facilitySource:'OpenStreetMap',weight:1,plannedAt:new Date(now+31*24*60*60*1000).toISOString()};
  const malformed={type:'plan',v:1,planId:deterministicPlanId(core),...core,iat:now,exp:now+32*24*60*60*1000};
  assert.equal(validSignedPlanPayload(decodeSignedPayload(encodeSignedPayload(malformed)),now+1),false);
});

test('completion structural validator binds completedAt exactly to the signed server iat', () => {
  const now=Date.now();
  const core={itemName:'x',material:'plastic',wasteType:'plastic',specialHandling:false,facilityId:'f',facilityName:'F',facilitySource:'OpenStreetMap',weight:1,plannedAt:new Date(now-1000).toISOString()};
  const malformed={type:'completion',v:1,planId:deterministicPlanId(core),...core,completedAt:new Date(now-1).toISOString(),iat:now,exp:now+60_000};
  assert.equal(validSignedCompletionPayload(decodeSignedPayload(encodeSignedPayload(malformed)),now),false);
});

test('HTTP action prepare and verify endpoints enforce the signed proof chain', async () => {
  const now=Date.now();
  const itemProof=createAnalysisItemProof(proofItem(),now);
  const facilityProof=createFacilityProof({itemProof,facility:proofFacility()},now+1);
  const plannedAt=new Date(Date.now()+30_000).toISOString();
  const prepare=await fetch(`${baseUrl}/api/action/prepare`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({facilityProof,weight:1.5,plannedAt})});
  assert.equal(prepare.status,200);
  const body=await prepare.json();
  assert.ok(body.planReceipt);
  const tooEarly=await fetch(`${baseUrl}/api/action/complete`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({planReceipt:body.planReceipt})});
  assert.equal(tooEarly.status,409);
  const verify=await fetch(`${baseUrl}/api/action/verify`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({receipts:['forged.receipt']})});
  const verified=await verify.json();
  assert.equal(verified.count,0);
  assert.equal(verified.kg,0);
});

test('HTTP completion endpoint produces a receipt for a just-past pre-signed plan', async () => {
  const now=Date.now();
  const itemProof=createAnalysisItemProof(proofItem(),now-2000);
  const facilityProof=createFacilityProof({itemProof,facility:proofFacility()},now-1900);
  const plan=prepareActionReceipt({facilityProof,weight:2,plannedAt:new Date(now-1000).toISOString()},now-1500);
  const response=await fetch(`${baseUrl}/api/action/complete`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({planReceipt:plan.receipt})});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.ok(payload.completionReceipt);
  const verify=await fetch(`${baseUrl}/api/action/verify`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({receipts:[payload.completionReceipt,payload.completionReceipt]})});
  const checked=await verify.json();
  assert.equal(checked.count,1);
  assert.equal(checked.kg,2);
});

test('HTTP browser-origin guard blocks foreign Origin on API POST', async () => {
  const response=await fetch(`${baseUrl}/api/demo-analysis`,{method:'POST',headers:{origin:'https://evil.example','sec-fetch-site':'cross-site'}});
  assert.equal(response.status,403);
  assert.equal((await response.json()).code,'CROSS_ORIGIN_BLOCKED');
});

test('privacy-safe POST facility endpoint rejects booleans as coordinates before lookup', async () => {
  const response=await fetch(`${baseUrl}/api/facilities`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:true,lon:74.3,tags:['plastic']})});
  assert.equal(response.status,400);
  assert.equal((await response.json()).code,'BAD_COORDINATES');
});

test('frontend proof badge requires local record to remain a real drop-off and non-demo', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/record\.action!==\'dropoff\'\|\|record\.isDemo!==false/);
  assert.match(source,/Signed proof differs/);
});

test('frontend impact trusts only server-returned details that were actually requested', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/requested\.has\(raw\.receipt\)/);
  assert.match(source,/state\.verifiedReceiptDetails\.set\(item\.receipt,item\)/);
  assert.doesNotMatch(source,/payload\.completions\.length/);
});

test('frontend local history uses bounded storage and a browser lock when available', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/MAX_STORAGE_CHARS/);
  assert.match(source,/navigator\.locks\?\.request/);
  assert.match(source,/while \(encoded\.length > MAX_STORAGE_CHARS/);
  assert.match(source,/window\.addEventListener\('storage'/);
});

test('mobile CSS includes safe-area bottom padding and does not ellipsize AI status', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const css=await fs.readFile(path.join(root,'public','styles.css'),'utf8');
  assert.match(css,/padding-bottom:calc\(86px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/\.status-pill \{ max-width:none; white-space:normal; overflow:visible; text-overflow:clip/);
});

test('manifest and shell asset versions are synchronized to 0.14.1', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const html=await fs.readFile(path.join(root,'public','index.html'),'utf8');
  const sw=await fs.readFile(path.join(root,'public','sw.js'),'utf8');
  const manifest=JSON.parse(await fs.readFile(path.join(root,'public','manifest.webmanifest'),'utf8'));
  assert.match(html,/styles\.css\?v=0\.14\.1/);
  assert.match(html,/manifest\.webmanifest\?v=0\.14\.1/);
  assert.match(sw,/styles\.css\?v=0\.14\.1/);
  assert.equal(manifest.id,'/?source=pwa');
  assert.match(manifest.icons[0].src,/v=0\.14\.1/);
});

test('battery routing requires explicit battery acceptance rather than generic electronics', () => {
  assert.deepEqual(expandedWantedTags(['battery']).sort(), ['batteries','battery'].sort());
  assert.equal(scoreFacilityCompatibility({ accepted:['electronics'] }, ['battery','batteries']).status, 'no-published-match');
  assert.equal(scoreFacilityCompatibility({ accepted:['small batteries'] }, ['battery','batteries']).status, 'possible-match');
});

test('battery charger is treated as e-waste, while a power bank remains a battery', () => {
  const charger=normalizeWasteResult({items:[{name:'Battery charger',material:'plastic and electronics',waste_type:'e-waste',recyclable:true,reusable:false,normal_bin:false,special_handling:false,hazard_level:'low',preparation_steps:[],reuse_ideas:[],facility_tags:['electronics'],certainty:'high',short_explanation:'charger'}]});
  assert.equal(charger.items[0].waste_type,'e-waste');
  assert.deepEqual(charger.items[0].facility_tags, deterministicFacilityTags('e-waste'));
  const bank=normalizeWasteResult({items:[{name:'Power bank',material:'plastic',waste_type:'plastic',recyclable:false,reusable:false,normal_bin:true,special_handling:false,hazard_level:'none',preparation_steps:[],reuse_ideas:[],facility_tags:['plastic'],certainty:'high',short_explanation:'bank'}]});
  assert.equal(bank.items[0].waste_type,'battery');
  assert.deepEqual(bank.items[0].facility_tags, deterministicFacilityTags('battery'));
});

test('ordinary adjective sharp does not falsely turn non-medical waste into medical waste', () => {
  const result=normalizeWasteResult({items:[{name:'Sharp cheddar wrapper',material:'plastic film',waste_type:'plastic',recyclable:false,reusable:false,normal_bin:true,special_handling:false,hazard_level:'none',preparation_steps:[],reuse_ideas:[],facility_tags:['plastic'],certainty:'high',short_explanation:'wrapper'}]});
  assert.equal(result.items[0].waste_type,'plastic');
  assert.equal(result.items[0].special_handling,false);
});

test('signed dangerous item proof cannot claim ordinary handling or widened route tags', () => {
  const now=Date.now();
  const badHandling=encodeSignedPayload({type:'item',v:1,itemName:'Battery',material:'battery',wasteType:'battery',specialHandling:false,facilityTags:['battery','batteries'],iat:now,exp:now+60000});
  assert.equal(validSignedItemPayload(decodeSignedPayload(badHandling),now),false);
  const widened=encodeSignedPayload({type:'item',v:1,itemName:'Battery',material:'battery',wasteType:'battery',specialHandling:true,facilityTags:['battery','batteries','electronics'],iat:now,exp:now+60000});
  assert.equal(validSignedItemPayload(decodeSignedPayload(widened),now),false);
});

test('service-worker refresh is attached to fetch event lifetime', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const sw=await fs.readFile(path.join(root,'public','sw.js'),'utf8');
  assert.match(sw,/function networkAndRefresh\(request, event\)/);
  assert.match(sw,/event\.waitUntil\(refresh\)/);
  assert.match(sw,/networkAndRefresh\(event\.request,event\)/);
});

test('today schedule minimum uses the current minute and cannot wrap tomorrow midnight onto today', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/const min = new Date\(now\); min\.setSeconds\(0,0\)/);
  assert.doesNotMatch(source,/const min = new Date\(now\.getTime\(\) \+ 60_000\)/);
});

test('frontend retries health after a temporary server wake failure instead of leaving stale status', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/function scheduleHealthRetry\(\)/);
  assert.match(source,/Server waking or unavailable/);
  assert.match(source,/document\.addEventListener\('visibilitychange'/);
});

test('demo scan does not overwrite a local scan-history persistence warning', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  const matches=source.match(/applied && !\$\('scanMessage'\)\.textContent\.includes\('could not save'\)/g)||[];
  assert.ok(matches.length >= 3);
});

test('non-demo special-handling facility selection requires a signed facility proof', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/item\?\.special_handling\) return publishedMatch && \(state\.analysisIsDemo \|\| selectedFacilityHasProof\(facility\)\)/);
  assert.match(source,/no signed published-material match/);
});

test('serial gate cancels queued work and enforces its queue bound', async () => {
  const gate=createSerialGate({maxQueue:1});
  let release;
  const first=gate(()=>new Promise((resolve)=>{release=resolve;}));
  await new Promise((resolve)=>setTimeout(resolve,5));
  const controller=new AbortController();
  const second=gate(async()=>2,{signal:controller.signal});
  await assert.rejects(gate(async()=>3),(error)=>error.code==='LOOKUP_BUSY'&&error.status===503);
  controller.abort();
  await assert.rejects(second,(error)=>error.code==='REQUEST_CANCELLED');
  release(1);
  assert.equal(await first,1);
  assert.equal(await gate(async()=>4),4);
});

test('item and facility proofs expire at their independent lifetimes', () => {
  const start=Date.now();
  const itemProof=createAnalysisItemProof(proofItem(),start);
  assert.equal(validSignedItemPayload(decodeSignedPayload(itemProof),start+29*24*60*60*1000),true);
  assert.equal(validSignedItemPayload(decodeSignedPayload(itemProof),start+31*24*60*60*1000),false);
  const facilityProof=createFacilityProof({itemProof,facility:proofFacility()},start+1000);
  assert.ok(facilityProof);
  assert.equal(validSignedFacilityProofPayload(decodeSignedPayload(facilityProof),start+23*60*60*1000),true);
  assert.equal(validSignedFacilityProofPayload(decodeSignedPayload(facilityProof),start+25*60*60*1000),false);
});

test('two separately minted completion receipts for one plan still count once', () => {
  const start=Date.now();
  const itemProof=createAnalysisItemProof(proofItem(),start-5000);
  const facilityProof=createFacilityProof({itemProof,facility:proofFacility()},start-4000);
  const plan=prepareActionReceipt({facilityProof,weight:3.25,plannedAt:new Date(start-2000).toISOString()},start-3000);
  const one=completeActionReceipt({planReceipt:plan.receipt},start);
  const two=completeActionReceipt({planReceipt:plan.receipt},start+1000);
  assert.notEqual(one.receipt,two.receipt);
  const verified=verifyCompletionReceipts([one.receipt,two.receipt],start+1500);
  assert.equal(verified.count,1);
  assert.equal(verified.kg,3.25);
});

test('static server blocks a symlink that points outside public', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const link=path.join(root,'public',`.escape-${process.pid}.txt`);
  try {
    await fs.symlink('/etc/hosts',link);
    const response=await fetch(`${baseUrl}/${path.basename(link)}`);
    assert.equal(response.status,404);
    const text=await response.text();
    assert.doesNotMatch(text,/localhost/);
  } finally { await fs.unlink(link).catch(()=>{}); }
});

test('/api/health reports currently available key-model route count', async () => {
  const response=await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(Number.isInteger(body.availableRouteCount),true);
  assert.ok(body.availableRouteCount >= 0);
});

test('frontend does not claim AI ready when every key-model route is cooling down', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/routeCount === 0/);
  assert.match(source,/AI routes cooling down · demo ready/);
});

test('material-tag expansion fails closed on malformed non-array input', () => {
  assert.deepEqual(expandedWantedTags(null),[]);
  assert.deepEqual(expandedWantedTags({battery:true}),[]);
  assert.deepEqual(expandedWantedTags('battery'),[]);
  assert.equal(scoreFacilityCompatibility({accepted:['battery']}, {battery:true}).status,'unknown');
});

test('completed action with permanently invalid pre-action proof cannot offer futile retry', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/proofPermanent = proofErrorCode === 'BAD_PLAN_RECEIPT'/);
  assert.match(source,/found\.proofState='completion-unavailable'/);
  assert.match(source,/disabled>Attestation unavailable<\/button>/);
  assert.match(source,/original pre-action proof is expired or invalid/);
});

test('history surfaces bounded proof errors instead of silently hiding attestation failure', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const source=await fs.readFile(path.join(root,'public','app.js'),'utf8');
  assert.match(source,/proofError:boundedText\(record\?\.proofError,220\)/);
  assert.match(source,/class="proof-error"/);
});

test('repository baseline includes complete cleanup history documents without raw reference source trees', async () => {
  const root=path.resolve(new URL('..',import.meta.url).pathname);
  const changelog=await fs.readFile(path.join(root,'CHANGELOG.md'),'utf8');
  const history=await fs.readFile(path.join(root,'docs','PROJECT_HISTORY.md'),'utf8');
  assert.match(changelog,/0\.14\.1/);
  assert.match(history,/changed combined `cleanup` implementation/);
  assert.match(history,/does not contain the raw Android\/web reference repositories/);
});


test('geocode cache keys keep distinct Unicode address queries separate', () => {
  assert.notEqual(geocodeCacheKey('لاہور'), geocodeCacheKey('کراچی'));
  assert.equal(geocodeCacheKey('  Lahore  '), geocodeCacheKey('lahore'));
});

test('facility search fails closed when an item proof is supplied but invalid', () => {
  assert.throws(
    () => facilitySearchInputs({ lat: 33.6844, lon: 73.0479, itemProof: 'invalid.item.proof', tags: ['plastic'] }),
    (error) => error?.code === 'BAD_ITEM_PROOF' && error?.status === 400
  );
});

test('client rate-limit identity ignores spoofed forwarded IPs outside Render', () => {
  const oldRender = process.env.RENDER;
  const oldServiceId = process.env.RENDER_SERVICE_ID;
  delete process.env.RENDER;
  delete process.env.RENDER_SERVICE_ID;
  try {
    assert.equal(clientKey({ headers: { 'x-forwarded-for': '8.8.8.8' }, socket: { remoteAddress: '::ffff:127.0.0.1' } }), '127.0.0.1');
  } finally {
    if (oldRender === undefined) delete process.env.RENDER; else process.env.RENDER = oldRender;
    if (oldServiceId === undefined) delete process.env.RENDER_SERVICE_ID; else process.env.RENDER_SERVICE_ID = oldServiceId;
  }
});

test('invalid replacement photos clear stale analysis context and restore the upload prompt', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /function clearSelectedImage[\s\S]{0,500}resetAnalysisForNewImage\(\)/);
  assert.match(frontend, /uploadPrompt'\)\.innerHTML = DEFAULT_UPLOAD_PROMPT/);
  assert.match(frontend, /const file = event\.target\.files\?\.\[0\];[\s\S]{0,80}if \(file\) selectImageFile\(file\)/);
});

test('empty impact refresh releases its abort controller instead of leaving stale state', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /if\(!receipts\.length\)\{[\s\S]{0,500}state\.impactController===controller\)state\.impactController=null;return;/);
});


test('Gemini cooldown exhaustion reports quota, model access, and mixed cooldowns accurately', () => {
  assert.equal(geminiExhaustionFailure([], { skippedQuotaCooldown: true }).code, 'GEMINI_QUOTA_EXHAUSTED');
  assert.equal(geminiExhaustionFailure([], { skippedAccessCooldown: true }).code, 'GEMINI_MODEL_ACCESS_EXHAUSTED');
  const mixed = geminiExhaustionFailure([], { skippedQuotaCooldown: true, skippedAccessCooldown: true });
  assert.equal(mixed.code, 'GEMINI_ROUTES_COOLDOWN');
  assert.equal(mixed.status, 503);
});

test('health checks cancel stale requests so an older response cannot overwrite newer AI status', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /healthGeneration/);
  assert.match(frontend, /const generation = \+\+state\.healthGeneration/);
  assert.match(frontend, /state\.healthController\?\.abort\(\)/);
  assert.match(frontend, /generation !== state\.healthGeneration/);
});

test('saved action notes are sanitized and rendered back in history', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /note:boundedText\(record\?\.note,300\)/);
  assert.match(frontend, /history-note/);
  assert.match(frontend, /escapeHtml\(record\.note\)/);
});

test('minute schedule refresh does not revalidate every completion receipt', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const frontend = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(frontend, /setInterval\(\(\) => \{ updateScheduleBounds\(\); if \(document\.visibilityState === 'visible'\) renderActions\(\); \}, 60_000\)/);
  assert.doesNotMatch(frontend, /setInterval\([\s\S]{0,180}renderImpact\(\)[\s\S]{0,60}60_000/);
});

test('Render explicitly enables production error responses', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const yaml = await fs.readFile(path.join(root, 'render.yaml'), 'utf8');
  assert.match(yaml, /NODE_ENV[\s\S]{0,40}production/);
});
