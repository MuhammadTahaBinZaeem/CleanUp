from pathlib import Path
import re

p=Path('tests/server.test.js')
s=p.read_text()

# Import the provider request-builder contract.
s=s.replace('  featherlessFailureKind,\n  orderedKeySlots,', '  featherlessFailureKind,\n  createFeatherlessRequestBody,\n  orderedKeySlots,')

# Replace provider configuration tests with real Featherless owner/model IDs.
pattern=r"test\('Featherless config accepts up to three keys, removes duplicates, and supports legacy aliases'.*?test\('key slot ordering starts from the last healthy key and wraps around'"
replacement="""test('Featherless config accepts up to three keys, removes duplicates, and supports legacy aliases', () => {
  const config = getFeatherlessConfig({
    FEATHERLESS_API_KEY: ' key-one ',
    FEATHERLESS_API_KEY_2: 'key-two',
    FEATHERLESS_API_KEY_3: 'key-two',
    FEATHERLESS_MODEL: 'Acme/Primary-Vision',
    FEATHERLESS_MODEL_2: 'Acme/Backup-Vision',
    FEATHERLESS_MODEL_3: 'bad model name with spaces'
  });
  assert.deepEqual(config.keys, ['key-one', 'key-two']);
  assert.deepEqual(config.models, ['Acme/Primary-Vision', 'Acme/Backup-Vision']);
});

test('Featherless config defaults to three warm vision-capable model IDs', () => {
  const config = getFeatherlessConfig({ FEATHERLESS_API_KEY_1: 'x' });
  assert.deepEqual(config.models, ['Qwen/Qwen3.6-35B-A3B', 'Qwen/Qwen3.6-27B', 'google/gemma-4-31B-it']);
});

test('model normalizer accepts Featherless owner/model IDs and rejects unsafe names', () => {
  assert.equal(normalizeModelName(' Qwen/Qwen3.6-35B-A3B '), 'Qwen/Qwen3.6-35B-A3B');
  assert.equal(normalizeModelName('../secret'), '');
  assert.equal(normalizeModelName('model without owner'), '');
  assert.equal(normalizeModelName('Qwen//bad'), '');
});

test('Featherless failure classification distinguishes key, cold model, access, quota, model, and fatal failures', () => {
  assert.equal(featherlessFailureKind(401, 'API key is not recognized'), 'key');
  assert.equal(featherlessFailureKind(400, 'model is cold and not ready for inference'), 'model-cold');
  assert.equal(featherlessFailureKind(403, 'model not available on this plan'), 'key-model-access');
  assert.equal(featherlessFailureKind(429, 'rate limit'), 'key-or-quota');
  assert.equal(featherlessFailureKind(404, 'model_not_found'), 'model');
  assert.equal(featherlessFailureKind(400, 'invalid image'), 'fatal');
});

test('key slot ordering starts from the last healthy key and wraps around'"""
s,c=re.subn(pattern,replacement,s,count=1,flags=re.S)
if c!=1: raise RuntimeError(f'provider config block replacement count {c}')

# Replace Gemini-specific source-shape tests with the actual OpenAI-compatible vision request contract.
pattern=r"test\('Featherless structured output uses responseFormat schema without deprecated sampling settings'.*?\n\}\);\n\ntest\('Featherless schema permits zero detected waste items instead of forcing hallucination'.*?\n\}\);"
replacement="""test('Featherless request uses OpenAI-compatible JSON-mode vision content', () => {
  const body = createFeatherlessRequestBody({ mimeType: 'image/jpeg', data: TEST_JPEG_DATA, model: 'Qwen/Qwen3.6-35B-A3B' });
  assert.equal(body.model, 'Qwen/Qwen3.6-35B-A3B');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content[0].type, 'text');
  assert.match(body.messages[0].content[0].text, /never invent an item/i);
  assert.match(body.messages[0].content[0].text, /\"minItems\":0/);
  assert.equal(body.messages[0].content[1].type, 'image_url');
  assert.match(body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.ok(body.max_tokens >= 1000);
});

test('Featherless prompt permits zero detected waste items instead of forcing hallucination', () => {
  const body = createFeatherlessRequestBody({ mimeType: 'image/jpeg', data: TEST_JPEG_DATA, model: 'Qwen/Qwen3.6-35B-A3B' });
  const prompt = body.messages[0].content[0].text;
  assert.match(prompt, /return an empty items array/i);
  assert.match(prompt, /never invent an item/i);
});"""
s,c=re.subn(pattern,replacement,s,count=1,flags=re.S)
if c!=1: raise RuntimeError(f'request contract block replacement count {c}')

# Update provider and model expectations in Render/env regression.
s=s.replace(r"/FEATHERLESS_MODEL_1[\s\S]*featherless-3\.6-flash/", r"/FEATHERLESS_MODEL_1[\s\S]*Qwen\/Qwen3\.6-35B-A3B/")
s=s.replace("  const envExample = await fs.readFile(path.join(root, '.env.example'), 'utf8');", "  assert.match(yaml, /FEATHERLESS_BASE_URL[\\s\\S]*api\\.featherless\\.ai\\/v1/);\n  const envExample = await fs.readFile(path.join(root, '.env.example'), 'utf8');")

# Provider semantics: invalid key is 401; 400 cold/not-ready is a model availability condition.
s=s.replace("test('invalid API key HTTP 400 is classified as key failure so rotation can continue', () => {\n  assert.equal(featherlessFailureKind(400, '{\"reason\":\"API_KEY_INVALID\",\"message\":\"API key not valid\"}'), 'key');\n});", "test('Featherless invalid API key HTTP 401 rotates keys while cold HTTP 400 falls back models', () => {\n  assert.equal(featherlessFailureKind(401, '{\"message\":\"API key is not recognized\"}'), 'key');\n  assert.equal(featherlessFailureKind(400, '{\"message\":\"model is cold and not ready for inference\"}'), 'model-cold');\n});")

# Correct misleading later title/source assumptions if present.
s=s.replace('Featherless invalid-key 400 rotates to the next key instead of stopping failover', 'Featherless invalid-key failure rotates to the next key instead of stopping failover')

# Release/cache expectations.
s=s.replace(r'0\.14\.9', r'1\.0\.0')
s=s.replace('0.14.9', '1.0.0')
s=s.replace('synchronized to 0.14.9', 'synchronized to 1.0.0')

# Add a provider-cleanliness regression: deployable source should no longer require Gemini configuration.
insert="""

test('deployable v1 source uses Featherless configuration and contains no Gemini runtime variables', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  for (const rel of ['server.js', 'public/app.js', 'public/index.html', 'render.yaml', '.env.example', 'RENDER_DEPLOY.md']) {
    const text = await fs.readFile(path.join(root, rel), 'utf8');
    assert.doesNotMatch(text, /GEMINI_API_KEY|GEMINI_MODEL|generativelanguage\.googleapis\.com/);
  }
  const backend = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(backend, /api\.featherless\.ai\/v1/);
  assert.match(backend, /Authorization': `Bearer \$\{apiKey\}`/);
});
"""
s += insert
p.write_text(s)
print('Adapted regression suite for Featherless.')