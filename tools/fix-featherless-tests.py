from pathlib import Path
import re

p=Path('tests/server.test.js')
s=p.read_text()

s=s.replace('  featherlessFailureKind,\n  orderedKeySlots,', '  featherlessFailureKind,\n  createFeatherlessRequestBody,\n  orderedKeySlots,')

pattern=r"test\('Featherless config accepts up to three keys, removes duplicates, and supports legacy aliases'.*?test\('key slot ordering starts from the last healthy key and wraps around'"
replacement="""test('Featherless config uses exactly one API key and internal automatic model routing', () => {
  const config = getFeatherlessConfig({
    FEATHERLESS_API_KEY: ' one-key ',
    FEATHERLESS_API_KEY_2: 'ignored-extra-key',
    FEATHERLESS_MODEL_1: 'ignored/Custom-Model'
  });
  assert.deepEqual(config.keys, ['one-key']);
  assert.deepEqual(config.models, ['Qwen/Qwen3.6-35B-A3B', 'Qwen/Qwen3.6-27B', 'google/gemma-4-31B-it']);
});

test('Featherless slot-1 legacy key alias is accepted but model selection remains automatic', () => {
  const config = getFeatherlessConfig({ FEATHERLESS_API_KEY_1: 'legacy-key', FEATHERLESS_MODEL: 'ignored/Model' });
  assert.deepEqual(config.keys, ['legacy-key']);
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
s,c=re.subn(pattern,lambda _: replacement,s,count=1,flags=re.S)
if c!=1: raise RuntimeError(f'provider config block replacement count {c}')

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
s,c=re.subn(pattern,lambda _: replacement,s,count=1,flags=re.S)
if c!=1: raise RuntimeError(f'request contract block replacement count {c}')

s=s.replace(r"/FEATHERLESS_MODEL_1[\s\S]*featherless-3\.6-flash/", r"/FEATHERLESS_API_KEY[\s\S]*sync:\s*false/")
s=s.replace("  const envExample = await fs.readFile(path.join(root, '.env.example'), 'utf8');", "  assert.doesNotMatch(yaml, /FEATHERLESS_MODEL_[123]|FEATHERLESS_API_KEY_[123]|FEATHERLESS_BASE_URL/);\n  const envExample = await fs.readFile(path.join(root, '.env.example'), 'utf8');")
s=s.replace("  assert.match(envExample, /FEATHERLESS_API_KEY_2=/);\n  assert.match(envExample, /FEATHERLESS_API_KEY_3=/);", "  assert.match(envExample, /^FEATHERLESS_API_KEY=/m);\n  assert.doesNotMatch(envExample, /FEATHERLESS_API_KEY_[123]|FEATHERLESS_MODEL/);")

s=s.replace("test('invalid API key HTTP 400 is classified as key failure so rotation can continue', () => {\n  assert.equal(featherlessFailureKind(400, '{\"reason\":\"API_KEY_INVALID\",\"message\":\"API key not valid\"}'), 'key');\n});", "test('Featherless invalid API key HTTP 401 is a key failure while cold HTTP 400 falls back models', () => {\n  assert.equal(featherlessFailureKind(401, '{\"message\":\"API key is not recognized\"}'), 'key');\n  assert.equal(featherlessFailureKind(400, '{\"message\":\"model is cold and not ready for inference\"}'), 'model-cold');\n});")
s=s.replace('Featherless invalid-key 400 rotates to the next key instead of stopping failover', 'Featherless invalid-key failure is surfaced cleanly with one configured key')

s=s.replace(r'0\.14\.9', r'1\.0\.0')
s=s.replace('0.14.9', '1.0.0')
s=s.replace('synchronized to 0.14.9', 'synchronized to 1.0.0')

pattern=r"test\('Render Blueprint exposes all three Featherless secret slots and configurable provider controls'.*?\n\}\);"
replacement="""test('Render Blueprint exposes one Featherless key and keeps model routing internal', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const yaml = await fs.readFile(path.join(root, 'render.yaml'), 'utf8');
  assert.match(yaml, /- key: FEATHERLESS_API_KEY\\n\\s+sync: false/);
  assert.doesNotMatch(yaml, /FEATHERLESS_API_KEY_[123]|FEATHERLESS_MODEL_[123]|FEATHERLESS_BASE_URL/);
  const backend = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(backend, /AUTO_FEATHERLESS_MODELS/);
  assert.match(backend, /Qwen\/Qwen3\\.6-35B-A3B/);
  assert.match(backend, /Qwen\/Qwen3\\.6-27B/);
  assert.match(backend, /google\/gemma-4-31B-it/);
});"""
s,_=re.subn(pattern,lambda _: replacement,s,count=1,flags=re.S)

insert="""

test('deployable v1 source uses one Featherless key and contains no Gemini runtime variables', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  for (const rel of ['server.js', 'public/app.js', 'public/index.html', 'render.yaml', '.env.example', 'RENDER_DEPLOY.md', 'README.md']) {
    const text = await fs.readFile(path.join(root, rel), 'utf8');
    assert.doesNotMatch(text, /GEMINI_API_KEY|GEMINI_MODEL|generativelanguage\.googleapis\.com/);
  }
  const backend = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(backend, /api\.featherless\.ai\/v1/);
  assert.match(backend, /Authorization': `Bearer \$\{apiKey\}`/);
  const envExample = await fs.readFile(path.join(root, '.env.example'), 'utf8');
  assert.equal((envExample.match(/^FEATHERLESS_API_KEY=/gm) || []).length, 1);
  assert.doesNotMatch(envExample, /FEATHERLESS_MODEL/);
});
"""
s += insert
p.write_text(s)
print('Adapted regression suite for one-key Featherless auto-routing.')