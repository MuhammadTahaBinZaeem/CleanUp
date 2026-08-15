const $ = (id) => document.getElementById(id);

const APP_VERSION = '0.14.8';
const STORAGE_SCANS = 'cleanup_scans';
const STORAGE_ACTIONS = 'cleanup_actions';
const MAX_SELECTED_FILE_BYTES = 30 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_STORAGE_CHARS = 1_500_000;
const ACTION_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_UPLOAD_PROMPT = '<span class="camera-icon">◎</span><strong>Take, choose, or drop a photo</strong><small>JPEG, PNG, WEBP, HEIC/HEIF</small>';

const state = {
  selectedFile: null,
  previewUrl: null,
  analysis: null,
  analysisIsDemo: false,
  selectedItemIndex: null,
  position: null,
  facilities: [],
  selectedFacilityId: null,
  map: null,
  analyzeController: null,
  facilityController: null,
  locationController: null,
  analyzeGeneration: 0,
  facilityGeneration: 0,
  locationGeneration: 0,
  verifiedReceiptDetails: new Map(),
  impactController: null,
  impactVerificationState: 'idle',
  actionLocks: new Set(),
  healthRetryTimer: null,
  healthRetryAttempt: 0,
  healthGeneration: 0,
  healthController: null,
  actionReceiptPersistent: null
};

const LOCAL_DEMO_RESULT = {
  scene_summary: 'A plastic drink bottle and a small battery are visible.',
  uncertain: false,
  user_warning: 'Battery disposal rules vary by location. Use a designated battery/e-waste collection point.',
  ai_model: 'local-demo',
  items: [
    {
      name: 'Plastic drink bottle', material: 'PET plastic', waste_type: 'plastic', recyclable: true,
      reusable: false, normal_bin: false, special_handling: false, hazard_level: 'none', certainty: 'high',
      preparation_steps: ['Empty the bottle', 'Rinse if practical', 'Check local rules for caps and labels'],
      reuse_ideas: [], facility_tags: ['plastic', 'PET'],
      short_explanation: 'Common PET beverage container; usually recyclable where PET is accepted.',
      recommended_action: 'recycle'
    },
    {
      name: 'Small household battery', material: 'battery', waste_type: 'battery', recyclable: true,
      reusable: false, normal_bin: false, special_handling: true, hazard_level: 'medium', certainty: 'high',
      preparation_steps: ['Keep it dry', 'Protect terminals if storing multiple batteries', 'Use a battery or e-waste collection point'],
      reuse_ideas: [], facility_tags: ['battery', 'electronics'],
      short_explanation: 'Batteries need a dedicated collection route rather than ordinary recycling.',
      recommended_action: 'special-disposal'
    }
  ]
};

const storage = {
  getArray(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw || raw.length > MAX_STORAGE_CHARS) return [];
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 150) : [];
    } catch { return []; }
  },
  set(key, value) {
    try {
      const items = Array.isArray(value) ? [...value] : value;
      let encoded = JSON.stringify(items);
      if (Array.isArray(items)) {
        while (encoded.length > MAX_STORAGE_CHARS && items.length > 1) { items.pop(); encoded = JSON.stringify(items); }
      }
      if (encoded.length > MAX_STORAGE_CHARS) return false;
      localStorage.setItem(key, encoded); return true;
    } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(key); return true; } catch { return false; } }
};

async function withStorageLock(name, task) {
  let ran = false;
  const run = async () => { ran = true; return task(); };
  if (navigator.locks?.request) {
    try { return await navigator.locks.request(`cleanup:${name}`, run); }
    catch (error) { if (ran) throw error; }
  }
  return task();
}

async function mutateStoredArray(key, mutator) {
  return withStorageLock(key, async () => {
    const current = storage.getArray(key);
    const next = await mutator(current) || current;
    return storage.set(key, next);
  });
}
async function withActionOperationLock(marker, task) {
  return withStorageLock(`action-operation:${marker}`, task);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

function scrollToElement(element) {
  element?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

async function fetchJson(url, options = {}, timeoutMs = 25000) {
  const timeoutController = new AbortController();
  const parentSignal = options.signal;
  let signal = timeoutController.signal;
  let forwardAbort = null;

  if (parentSignal && typeof AbortSignal.any === 'function') {
    signal = AbortSignal.any([parentSignal, timeoutController.signal]);
  } else if (parentSignal) {
    forwardAbort = () => timeoutController.abort(parentSignal.reason);
    if (parentSignal.aborted) forwardAbort();
    else parentSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  const timer = setTimeout(() => timeoutController.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      const cancelled = Boolean(parentSignal?.aborted);
      const wrapped = new Error(cancelled ? 'Request cancelled' : 'Request timed out');
      wrapped.code = cancelled ? 'REQUEST_CANCELLED' : 'REQUEST_TIMEOUT';
      throw wrapped;
    }
    if (error instanceof TypeError) {
      const wrapped = new Error(navigator.onLine === false ? 'You appear to be offline.' : 'Network request failed. Check your connection and try again.');
      wrapped.code = 'NETWORK_ERROR';
      throw wrapped;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (forwardAbort) parentSignal?.removeEventListener('abort', forwardAbort);
  }
}

function clearHealthRetry() {
  if (state.healthRetryTimer) clearTimeout(state.healthRetryTimer);
  state.healthRetryTimer = null;
}
function scheduleHealthRetry() {
  if (state.healthRetryTimer || navigator.onLine === false) return;
  const delays = [4000, 8000, 15000, 30000, 60000, 120000];
  const index = Math.min(state.healthRetryAttempt, delays.length - 1);
  const delay = delays[index];
  state.healthRetryAttempt = Math.min(index + 1, delays.length - 1);
  state.healthRetryTimer = setTimeout(() => {
    state.healthRetryTimer = null;
    if (document.visibilityState === 'visible') health();
    else scheduleHealthRetry();
  }, delay);
}
async function health() {
  const generation = ++state.healthGeneration;
  state.healthController?.abort();
  state.healthController = null;
  if (navigator.onLine === false) { clearHealthRetry(); $('aiStatus').textContent = 'Offline · saved history available'; return; }
  const controller = new AbortController();
  state.healthController = controller;
  try {
    const data = await fetchJson('/api/health', { signal: controller.signal }, 8000);
    if (generation !== state.healthGeneration) return;
    const previousReceiptPersistence = state.actionReceiptPersistent;
    state.actionReceiptPersistent = data?.actionReceiptPersistent === true;
    if (previousReceiptPersistence !== state.actionReceiptPersistent) renderImpact();
    const configured = data?.geminiConfigured === true;
    const usable = Number.isInteger(data?.usableKeyCount) && data.usableKeyCount >= 0 ? data.usableKeyCount : 0;
    const usableModels = Array.isArray(data?.usableModels) ? data.usableModels.filter((m) => typeof m === 'string') : [];
    state.healthRetryAttempt = 0; clearHealthRetry();
    if (!configured) { $('aiStatus').textContent = 'Demo mode · add Gemini key'; return; }
    if (!usable || usableModels.length === 0) { $('aiStatus').textContent = 'AI routes unavailable · demo ready'; return; }
    const routeCount = Number.isInteger(data?.availableRouteCount) && data.availableRouteCount >= 0 ? data.availableRouteCount : null;
    if (routeCount === 0) { $('aiStatus').textContent = 'AI routes cooling down · demo ready'; return; }
    const model = typeof data.model === 'string' && data.model ? data.model : usableModels[0];
    const suffix = usable > 1 ? ` · ${usable} keys` : '';
    $('aiStatus').textContent = `AI ready · ${model}${suffix}`;
  } catch (error) {
    if (generation !== state.healthGeneration || error.code === 'REQUEST_CANCELLED') return;
    $('aiStatus').textContent = navigator.onLine === false ? 'Offline · saved history available' : 'Server waking or unavailable';
    scheduleHealthRetry();
  } finally {
    if (generation === state.healthGeneration) state.healthController = null;
  }
}
function revokePreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

function setBusy(id, busy) {
  const el = $(id);
  if (!el) return;
  el.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function clearAddressResults() {
  const el = $('addressResults');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
}

function cancelLocationLookup() {
  state.locationGeneration += 1;
  state.locationController?.abort();
  state.locationController = null;
  $('locationBtn').disabled = false;
  $('addressBtn').disabled = false;
}

function cancelFacilityLookup({ clear = false, message = '' } = {}) {
  state.facilityGeneration += 1;
  state.facilityController?.abort();
  state.facilityController = null;
  setBusy('facilityList', false);
  if (!clear) return;
  state.facilities = [];
  state.selectedFacilityId = null;
  $('pickupFacility').value = '';
  $('facilityList').innerHTML = `<p class="muted">${escapeHtml(message || 'No facility search yet.')}</p>`;
  clearMap(message || 'Choose a location to search nearby facilities.');
}

function localDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localTimeInputValue(date) {
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
function updateScheduleBounds({ resetValue = false } = {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + ACTION_MAX_DAYS * DAY_MS);
  const dateInput = $('pickupDate'); const timeInput = $('pickupTime');
  dateInput.min = localDateInputValue(now); dateInput.max = localDateInputValue(horizon);
  if (resetValue || !dateInput.value) {
    const tomorrow = new Date(now.getTime() + DAY_MS);
    dateInput.value = localDateInputValue(tomorrow > horizon ? horizon : tomorrow);
    timeInput.value = '10:00';
  }
  if (dateInput.value === localDateInputValue(now)) {
    const min = new Date(now); min.setSeconds(0,0);
    timeInput.min = localTimeInputValue(min);
  } else timeInput.removeAttribute('min');
  if (dateInput.value === localDateInputValue(horizon)) timeInput.max = localTimeInputValue(horizon);
  else timeInput.removeAttribute('max');
}
function setDefaultActionDate() { updateScheduleBounds({ resetValue:true }); }
$('pickupDate')?.addEventListener('change', () => updateScheduleBounds());
function resetActionDraft({ preserveMaterial = true } = {}) {
  $('pickupAction').value = 'dropoff';
  $('pickupWeight').value = '';
  $('pickupNote').value = '';
  $('pickupFacility').value = '';
  if (!preserveMaterial) $('pickupMaterial').value = '';
  $('pickupMessage').textContent = '';
  setDefaultActionDate();
  syncActionMode();
}

function clearCurrentAnalysisForAttempt(message) {
  state.analysis = null;
  state.analysisIsDemo = false;
  state.selectedItemIndex = null;
  state.selectedFacilityId = null;
  cancelLocationLookup();
  cancelFacilityLookup({ clear: true, message });
  state.position = null;
  clearAddressResults();
  $('activeItemBar').hidden = true;
  $('pickupMaterial').value = '';
  resetActionDraft({ preserveMaterial: false });
  $('resultsPanel').className = 'results-panel empty-state';
  $('resultsPanel').innerHTML = `<div><span class="big-icon">↗</span><h3>${escapeHtml(message)}</h3><p>Please keep this page open while cleanup prepares a new action plan.</p></div>`;
  setBusy('resultsPanel', true);
}

function resetAnalysisForNewImage() {
  state.analyzeGeneration += 1;
  state.analyzeController?.abort();
  state.analyzeController = null;
  clearCurrentAnalysisForAttempt('Ready for a new photo');
  $('resultsPanel').innerHTML = '<div><span class="big-icon">↗</span><h3>Your action plan appears here</h3><p>cleanup turns recognition into a disposal decision instead of showing raw AI probabilities.</p></div>';
  setBusy('resultsPanel', false);
  $('locationMessage').textContent = '';
}

function inferredImageMime(file) {
  const type = String(file?.type || '').toLowerCase();
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) return type;
  const name = String(file?.name || '').toLowerCase();
  if (/\.jpe?g$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  if (/\.heic$/.test(name)) return 'image/heic';
  if (/\.heif$/.test(name)) return 'image/heif';
  return '';
}

function supportedImageFile(file) {
  return Boolean(file && inferredImageMime(file));
}

function clearSelectedImage(message = '') {
  const hadAnalysisContext = Boolean(state.selectedFile || state.analysis || state.selectedItemIndex !== null || state.facilities.length);
  if (hadAnalysisContext) resetAnalysisForNewImage();
  revokePreview();
  state.selectedFile = null;
  $('preview').removeAttribute('src');
  $('preview').hidden = true;
  $('uploadPrompt').innerHTML = DEFAULT_UPLOAD_PROMPT;
  $('uploadPrompt').hidden = false;
  $('changePhotoHint').hidden = true;
  $('analyzeBtn').disabled = true;
  if (message) $('scanMessage').textContent = message;
}

function selectImageFile(file) {
  if (!supportedImageFile(file)) {
    clearSelectedImage('Choose a JPEG, PNG, WEBP, HEIC, or HEIF image.');
    return;
  }
  if (!Number.isFinite(Number(file.size)) || file.size <= 0) {
    clearSelectedImage('That image file is empty or unreadable. Choose another photo.');
    return;
  }
  if (file.size > MAX_SELECTED_FILE_BYTES) {
    clearSelectedImage('That image is over 30 MB. Choose a smaller photo.');
    return;
  }

  revokePreview();
  resetAnalysisForNewImage();
  state.selectedFile = file;
  state.previewUrl = URL.createObjectURL(file);
  $('preview').src = state.previewUrl;
  $('preview').hidden = false;
  $('uploadPrompt').hidden = true;
  $('changePhotoHint').hidden = false;
  $('analyzeBtn').disabled = false;
  $('scanMessage').textContent = `${file.name || 'Selected photo'} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
}

$('wasteImage').addEventListener('click', (event) => { event.currentTarget.value = ''; });
$('wasteImage').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) selectImageFile(file);
});
$('preview').addEventListener('error', () => {
  $('preview').hidden = true;
  $('uploadPrompt').hidden = false;
  $('uploadPrompt').innerHTML = '<span class="camera-icon">✓</span><strong>Photo selected</strong><small>Preview unavailable in this browser; cleanup can still try to analyze it.</small>';
});

const dropZone = document.querySelector('.drop-zone');
for (const eventName of ['dragenter', 'dragover']) {
  dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('drag-active');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-active');
  });
}
dropZone?.addEventListener('drop', (event) => selectImageFile(event.dataTransfer?.files?.[0]));

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}

async function loadDrawableImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ drawable: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Browser cannot decode this image')); };
    img.src = url;
  });
}

async function loadDrawable(blob) {
  if (typeof window.createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { drawable: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch {}
  }
  return loadDrawableImage(blob);
}

async function compressImage(file) {
  const mimeType = inferredImageMime(file);
  const canvasFriendly = new Set(['image/jpeg', 'image/png', 'image/webp']);
  let loaded;
  try {
    loaded = await loadDrawable(file);
  } catch {
    if (file.size <= MAX_UPLOAD_BYTES) return { blob: file, mimeType, compressed: false };
    throw new Error('This photo cannot be resized by your browser and is too large to upload. Convert it to JPEG/PNG first.');
  }

  const longest = Math.max(loaded.width, loaded.height);
  if (file.size <= 3 * 1024 * 1024 && longest <= 1800 && canvasFriendly.has(mimeType)) {
    loaded.cleanup();
    return { blob: file, mimeType, compressed: false };
  }

  const scale = Math.min(1, 1600 / Math.max(1, longest));
  const width = Math.max(1, Math.round(loaded.width * scale));
  const height = Math.max(1, Math.round(loaded.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) { loaded.cleanup(); throw new Error('This browser cannot resize the selected image'); }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(loaded.drawable, 0, 0, width, height);
  loaded.cleanup();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Could not resize the selected photo');
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('The resized photo is still too large. Try cropping it first.');
  return { blob, mimeType: 'image/jpeg', compressed: true };
}

$('analyzeBtn').addEventListener('click', async () => {
  if (!state.selectedFile) return;
  const generation = ++state.analyzeGeneration;
  state.analyzeController?.abort();
  const controller = new AbortController();
  state.analyzeController = controller;
  clearCurrentAnalysisForAttempt('Analyzing this photo…');
  $('analyzeBtn').disabled = true;
  $('demoBtn').disabled = true;
  $('scanMessage').textContent = 'Preparing photo…';

  try {
    const prepared = await compressImage(state.selectedFile);
    if (generation !== state.analyzeGeneration) return;
    $('scanMessage').textContent = prepared.compressed ? 'Photo resized. Asking Gemini for an action plan…' : 'Asking Gemini for an action plan…';
    const data = await blobToBase64(prepared.blob);
    if (generation !== state.analyzeGeneration) return;
    const payload = await fetchJson('/api/analyze-waste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: prepared.mimeType, data }),
      signal: controller.signal
    }, 65000);
    if (generation !== state.analyzeGeneration) return;
    const applied = await setAnalysis(payload.result, false);
    if (applied && !$('scanMessage').textContent.includes('could not save')) $('scanMessage').textContent = `Analyzed with ${state.analysis.ai_model || 'Gemini'}. Choose an item to find disposal options.`;
  } catch (error) {
    if (generation !== state.analyzeGeneration || error.code === 'REQUEST_CANCELLED') return;
    $('scanMessage').textContent = `${error.message}. You can still use the built-in demo result.`;
    setBusy('resultsPanel', false);
  } finally {
    if (generation === state.analyzeGeneration) {
      $('analyzeBtn').disabled = false;
      $('demoBtn').disabled = false;
      state.analyzeController = null;
    }
  }
});

$('demoBtn').addEventListener('click', async () => {
  const generation = ++state.analyzeGeneration;
  state.analyzeController?.abort();
  state.analyzeController = null;
  clearCurrentAnalysisForAttempt('Loading demo…');
  $('demoBtn').disabled = true;
  $('analyzeBtn').disabled = true;
  $('scanMessage').textContent = 'Loading a built-in two-item demo…';
  try {
    const payload = await fetchJson('/api/demo-analysis', { method: 'POST' }, 8000);
    if (generation !== state.analyzeGeneration) return;
    const applied = await setAnalysis(payload.result, true);
    if (applied && !$('scanMessage').textContent.includes('could not save')) $('scanMessage').textContent = 'Demo result loaded. Demo scans do not count toward impact.';
  } catch (error) {
    if (generation !== state.analyzeGeneration) return;
    const applied = await setAnalysis(typeof structuredClone === 'function' ? structuredClone(LOCAL_DEMO_RESULT) : JSON.parse(JSON.stringify(LOCAL_DEMO_RESULT)), true);
    if (applied && !$('scanMessage').textContent.includes('could not save')) $('scanMessage').textContent = 'Local demo loaded because the server is unavailable. Demo data does not count toward impact.';
  } finally {
    if (generation === state.analyzeGeneration) {
      $('demoBtn').disabled = false;
      $('analyzeBtn').disabled = !state.selectedFile;
    }
  }
});

function normalizeAnalysisPayload(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.items)) return null;
  const items = result.items.slice(0, 8).flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const name = typeof raw.name === 'string' ? raw.name.slice(0,160).trim() : '';
    const material = typeof raw.material === 'string' ? raw.material.slice(0,160).trim() : '';
    if (!name || !material) return [];
    const wasteType = typeof raw.waste_type === 'string' ? raw.waste_type.slice(0,40) : 'unknown';
    const dangerous = raw.special_handling === true || ['battery','e-waste','medical','hazardous'].includes(wasteType);
    return [{
      ...raw, name, material, waste_type:wasteType,
      recyclable: raw.recyclable === true, reusable: raw.reusable === true,
      normal_bin: dangerous ? false : raw.normal_bin === true, special_handling:dangerous,
      certainty:['low','medium','high'].includes(raw.certainty) ? raw.certainty : 'low',
      short_explanation:typeof raw.short_explanation === 'string' ? raw.short_explanation.slice(0,500) : 'Check local disposal guidance.',
      preparation_steps:Array.isArray(raw.preparation_steps) ? raw.preparation_steps.filter((x)=>typeof x==='string').slice(0,5) : [],
      reuse_ideas:Array.isArray(raw.reuse_ideas) ? raw.reuse_ideas.filter((x)=>typeof x==='string').slice(0,4) : [],
      facility_tags:Array.isArray(raw.facility_tags) ? raw.facility_tags.filter((x)=>typeof x==='string').slice(0,12) : [],
      item_proof:typeof raw.item_proof === 'string' ? raw.item_proof.slice(0,20000) : ''
    }];
  });
  return { scene_summary:typeof result.scene_summary==='string'?result.scene_summary.slice(0,500):'Waste analysis', user_warning:typeof result.user_warning==='string'?result.user_warning.slice(0,500):'', ai_model:typeof result.ai_model==='string'?result.ai_model.slice(0,160):'Gemini', items };
}

async function setAnalysis(result, demo) {
  setBusy('resultsPanel', false);
  const normalized = normalizeAnalysisPayload(result);
  if (!normalized || !normalized.items.length) {
    state.analysis = null;
    $('resultsPanel').className = 'results-panel empty-state';
    $('resultsPanel').innerHTML = '<div><span class="big-icon">?</span><h3>No discardable item detected</h3><p>Try a clearer photo with the item centered and visible.</p></div>';
    $('scanMessage').textContent = 'No discardable items were found. Try a clearer photo.';
    return false;
  }
  state.analysis = normalized; state.analysisIsDemo = Boolean(demo); state.selectedItemIndex = null; state.facilities=[]; state.selectedFacilityId=null;
  const scan = { id:uid(), at:new Date().toISOString(), demo:Boolean(demo), items:normalized.items.map((item)=>({name:item.name, material:item.material, waste_type:item.waste_type})) };
  const saved = await mutateStoredArray(STORAGE_SCANS, (scans) => [scan, ...scans].slice(0,50));
  renderAnalysis(); selectItem(0,{searchIfPossible:false}); renderImpact();
  if (!saved) $('scanMessage').textContent = 'Analysis ready, but this browser could not save scan history.';
  return true;
}
function routeLabel(item) {
  if (item.special_handling) return 'Special handling';
  if (item.recommended_action === 'check-local-rules') return 'Check local rules';
  if (item.reusable) return 'Reuse / recycle';
  if (item.recyclable) return 'Recyclable candidate';
  return 'General disposal';
}

function renderAnalysis() {
  const result = state.analysis;
  if (!result) return;
  $('resultsPanel').className = 'results-panel';
  $('resultsPanel').innerHTML = `
    <div class="result-summary">
      <div class="summary-row">
        <div><p class="eyebrow">ACTION PLAN</p><h3>${escapeHtml(result.scene_summary)}</h3></div>
        ${state.analysisIsDemo ? '<span class="demo-badge">DEMO</span>' : ''}
      </div>
      ${result.user_warning ? `<p class="demo-warning">${escapeHtml(result.user_warning)}</p>` : ''}
      <p class="muted">Choose an item to use it for nearby facility matching.</p>
    </div>
    ${result.items.map((item, index) => `
      <article class="result-item ${state.selectedItemIndex === index ? 'selected-result' : ''}">
        <div class="result-title"><h3>${escapeHtml(item.name)}</h3><span class="confidence">${escapeHtml(item.certainty || 'low')} certainty</span></div>
        <div class="result-meta">
          <span class="route-tag">${escapeHtml(item.material)}</span>
          <span class="${item.special_handling ? 'danger-tag' : item.recyclable ? 'safe-tag' : 'neutral-tag'}">${escapeHtml(routeLabel(item))}</span>
        </div>
        <p>${escapeHtml(item.short_explanation)}</p>
        ${item.preparation_steps?.length ? `<strong>What to do</strong><ol class="steps">${item.preparation_steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}
        ${item.reuse_ideas?.length ? `<strong>Reuse first</strong><ul class="steps">${item.reuse_ideas.map((idea) => `<li>${escapeHtml(idea)}</li>`).join('')}</ul>` : ''}
        <button class="item-select-btn ${state.selectedItemIndex === index ? 'active' : ''}" type="button" data-select-item="${index}" aria-pressed="${state.selectedItemIndex === index}">
          ${state.selectedItemIndex === index ? 'Selected for nearby search' : 'Use this item for nearby search'}
        </button>
      </article>`).join('')}`;
  document.querySelectorAll('[data-select-item]').forEach((button) => {
    button.addEventListener('click', () => selectItem(Number(button.dataset.selectItem), { searchIfPossible: true }));
  });
}

function activeItem() {
  return Number.isInteger(state.selectedItemIndex) ? state.analysis?.items?.[state.selectedItemIndex] : null;
}

function selectItem(index, { searchIfPossible }) {
  if (!state.analysis?.items?.[index]) return;
  const changed = state.selectedItemIndex !== null && state.selectedItemIndex !== index;
  state.selectedItemIndex = index;
  cancelFacilityLookup({ clear: false });
  state.selectedFacilityId = null;
  state.facilities = [];
  const item = activeItem();
  $('pickupMaterial').value = item.material || item.name;
  $('pickupFacility').value = '';
  $('activeItemName').textContent = `${item.name} · ${item.material}`;
  $('activeItemBar').hidden = false;
  if (changed) {
    resetActionDraft({ preserveMaterial: true });
    clearAddressResults();
  }
  renderAnalysis();
  syncActionMode();
  if (!state.position) {
    $('facilityList').innerHTML = '<p class="muted">Choose a location to find facilities for this item.</p>';
    clearMap('Choose a location to find facilities for this item.');
  }
  if (searchIfPossible && state.position) loadFacilitiesAt(state.position.lat, state.position.lon);
}

$('locationBtn').addEventListener('click', () => {
  if (!activeItem()) { $('locationMessage').textContent = 'Analyze a photo and choose an item first.'; return; }
  if (!navigator.geolocation) { $('locationMessage').textContent = 'Geolocation is not supported. Use address search instead.'; return; }
  cancelLocationLookup();
  cancelFacilityLookup({ clear: true, message: 'Getting your location…' });
  state.position = null;
  clearAddressResults();
  const generation = ++state.locationGeneration;
  const controller = new AbortController();
  state.locationController = controller;
  $('locationBtn').disabled = true;
  $('addressBtn').disabled = false;
  $('locationMessage').textContent = 'Getting your location…';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (generation !== state.locationGeneration || controller.signal.aborted) return;
      state.locationController = null;
      $('locationBtn').disabled = false;
      loadFacilitiesAt(position.coords.latitude, position.coords.longitude);
    },
    (error) => {
      if (generation !== state.locationGeneration || controller.signal.aborted) return;
      state.locationController = null;
      $('locationBtn').disabled = false;
      $('locationMessage').textContent = `Location unavailable: ${error.message}. Try address search instead.`;
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 }
  );
});

$('addressBtn').addEventListener('click', searchAddress);
$('addressInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); searchAddress(); }
});

function normalizedGeocodePlaces(payload) {
  const combined = [...(Array.isArray(payload?.results) ? payload.results : []), ...(Array.isArray(payload?.places) ? payload.places : [])];
  const seen = new Set();
  const places = [];
  for (const raw of combined) {
    const lat = typeof raw?.lat === 'number' && Number.isFinite(raw.lat) ? raw.lat : NaN;
    const lon = typeof raw?.lon === 'number' && Number.isFinite(raw.lon) ? raw.lon : NaN;
    const label = String(raw?.label || raw?.display_name || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !label) continue;
    const key = `${lat.toFixed(5)}:${lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ lat, lon, label: label.slice(0, 240) });
    if (places.length >= 5) break;
  }
  return places;
}

function renderAddressChoices(places) {
  const el = $('addressResults');
  el.hidden = false;
  el.innerHTML = `<p class="address-results-title">Choose the location you meant:</p>${places.map((place, index) => `
    <button type="button" class="address-choice" data-address-index="${index}">${escapeHtml(place.label)}</button>`).join('')}`;
  el.querySelectorAll('[data-address-index]').forEach((button) => {
    button.addEventListener('click', () => useGeocodePlace(places[Number(button.dataset.addressIndex)]));
  });
}

async function useGeocodePlace(place) {
  if (!place) return;
  clearAddressResults();
  $('locationMessage').textContent = `Using ${place.label}`;
  await loadFacilitiesAt(place.lat, place.lon, { preserveMessage: true });
}

async function searchAddress() {
  if (!activeItem()) { $('locationMessage').textContent = 'Analyze a photo and choose an item first.'; return; }
  const query = $('addressInput').value.trim();
  if (query.length < 3) { $('locationMessage').textContent = 'Enter at least 3 characters of a city, area, or address.'; return; }
  cancelLocationLookup();
  cancelFacilityLookup({ clear: true, message: 'Finding that place…' });
  state.position = null;
  clearAddressResults();
  const generation = ++state.locationGeneration;
  const controller = new AbortController();
  state.locationController = controller;
  $('addressBtn').disabled = true;
  $('locationBtn').disabled = false;
  $('locationMessage').textContent = 'Finding that place…';
  try {
    const payload = await fetchJson('/api/geocode', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({query}), signal:controller.signal }, 15000);
    if (generation !== state.locationGeneration) return;
    const places = normalizedGeocodePlaces(payload); // payload.results and payload.places are both supported.
    if (!places.length) throw new Error('No matching place found. Try a more specific city or area.');
    if (places.length === 1) await useGeocodePlace(places[0]);
    else {
      $('locationMessage').textContent = `${places.length} possible locations found.`;
      renderAddressChoices(places);
    }
  } catch (error) {
    if (generation === state.locationGeneration && error.code !== 'REQUEST_CANCELLED') $('locationMessage').textContent = error.message;
  } finally {
    if (generation === state.locationGeneration) {
      state.locationController = null;
      $('addressBtn').disabled = false;
    }
  }
}

function itemFacilityTags(item) {
  const tags = [...(item?.facility_tags || []), item?.waste_type, item?.material].filter(Boolean);
  return [...new Set(tags.map(String))].slice(0, 8);
}

function normalizeFacilities(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0,30).flatMap((facility,index) => {
    if (!facility || typeof facility !== 'object' || Array.isArray(facility)) return [];
    const lat = typeof facility.lat === 'number' && Number.isFinite(facility.lat) ? facility.lat : NaN;
    const lon = typeof facility.lon === 'number' && Number.isFinite(facility.lon) ? facility.lon : NaN;
    const distance = typeof facility.distance_km === 'number' && Number.isFinite(facility.distance_km) && facility.distance_km >= 0 ? facility.distance_km : null;
    if (!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90||lon < -180||lon > 180) return [];
    const fallbackId=`facility-${index}-${lat.toFixed(5)}-${lon.toFixed(5)}`;
    const compatibility = facility.compatibility && typeof facility.compatibility==='object' ? {
      status:typeof facility.compatibility.status==='string'?facility.compatibility.status.slice(0,40):'unknown',
      score:typeof facility.compatibility.score==='number'&&Number.isFinite(facility.compatibility.score)?facility.compatibility.score:0,
      matches:Array.isArray(facility.compatibility.matches)?facility.compatibility.matches.filter((x)=>typeof x==='string').slice(0,12):[]
    } : {status:'unknown',score:0,matches:[]};
    return [{
      id:typeof facility.id==='string'&&facility.id?facility.id.slice(0,180):fallbackId,
      name:typeof facility.name==='string'&&facility.name?facility.name.slice(0,180):'Recycling point',
      source:typeof facility.source==='string'?facility.source.slice(0,120):'Unknown source',
      address:typeof facility.address==='string'?facility.address.slice(0,300):null,
      opening_hours:typeof facility.opening_hours==='string'?facility.opening_hours.slice(0,180):null,
      accepted:Array.isArray(facility.accepted)?facility.accepted.filter((x)=>typeof x==='string').slice(0,30):[],
      lat,lon,distance_km:distance,demo:facility.demo===true,compatibility,
      facility_proof:typeof facility.facility_proof==='string'?facility.facility_proof.slice(0,20000):''
    }];
  });
}
async function loadFacilitiesAt(lat, lon, { preserveMessage = false } = {}) {
  const item = activeItem();
  if (!item) return;
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    $('locationMessage').textContent = 'Invalid location.';
    return;
  }
  const generation = ++state.facilityGeneration;
  state.facilityController?.abort();
  const controller = new AbortController();
  state.facilityController = controller;
  state.position = { lat, lon };
  state.selectedFacilityId = null;
  $('pickupFacility').value = '';
  if (!preserveMessage) $('locationMessage').textContent = `Searching nearby options for ${item.name}…`;
  $('facilityList').innerHTML = '<div class="loading-card">Searching recycling data…</div>';
  setBusy('facilityList', true);
  clearMap(`Searching nearby options for ${item.name}…`);
  try {
    const payload = await fetchJson('/api/facilities', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ lat, lon, tags:itemFacilityTags(item), itemProof:item.item_proof || '' }), signal:controller.signal }, 22000);
    if (generation !== state.facilityGeneration) return;
    state.facilities = normalizeFacilities(payload.facilities);
    const prefix = payload.demo ? 'Live lookup unavailable or empty — clearly labelled demo pins shown.' : `${state.facilities.length} nearby recycling points found.`;
    $('locationMessage').textContent = preserveMessage ? `${$('locationMessage').textContent} · ${prefix}` : prefix;
    renderFacilities(payload.warning);
    await renderMap();
  } catch (error) {
    if (generation !== state.facilityGeneration || error.code === 'REQUEST_CANCELLED') return;
    $('locationMessage').textContent = error.message;
    state.facilities = [];
    renderFacilities();
    clearMap('Facility search failed. Try again or use a different address.');
  } finally {
    if (generation === state.facilityGeneration) {
      state.facilityController = null;
      setBusy('facilityList', false);
    }
  }
}

function compatibilityStatus(facility) {
  return typeof facility?.compatibility === 'string' ? facility.compatibility : facility?.compatibility?.status;
}

function compatibilityLabel(facility) {
  const status = compatibilityStatus(facility);
  if (status === 'listed-match' || status === 'possible-match') return ['safe-tag', 'Published tags match'];
  if (status === 'not-listed' || status === 'no-published-match') return ['neutral-tag', 'No published material match'];
  return ['neutral-tag', 'Acceptance unknown'];
}

function facilitySelectionAllowed(facility) {
  const item = activeItem();
  const status = compatibilityStatus(facility);
  const publishedMatch = status === 'listed-match' || status === 'possible-match';
  if (item?.special_handling) return publishedMatch && (state.analysisIsDemo || selectedFacilityHasProof(facility));
  return status !== 'not-listed' && status !== 'no-published-match';
}

function renderFacilities(warning) {
  const list = $('facilityList');
  const previousScroll = list.scrollTop;
  if (!state.facilities.length) {
    list.innerHTML = `${warning ? `<div class="demo-warning">${escapeHtml(warning)}</div>` : ''}<p class="muted">No facility results.</p>`;
    return;
  }
  list.innerHTML = `${warning ? `<div class="demo-warning">${escapeHtml(warning)}</div>` : ''}${state.facilities.map((facility, index) => {
    const [tagClass, tagText] = compatibilityLabel(facility);
    const selectable = facilitySelectionAllowed(facility);
    const disabledText = activeItem()?.special_handling ? 'No safe match published' : 'Material not listed';
    return `
      <article class="facility-card ${state.selectedFacilityId === facility.id ? 'selected-facility' : ''}" data-facility-index="${index}">
        <div class="facility-head"><h3>${escapeHtml(facility.name || 'Recycling point')}</h3>${facility.demo ? '<span class="demo-badge">DEMO</span>' : `<span class="${tagClass}">${tagText}</span>`}</div>
        <p><strong>${facility.distance_km === null ? 'Distance unavailable' : `${facility.distance_km.toFixed(2)} km`}</strong>${facility.distance_km === null ? '' : ' away'} · ${escapeHtml(facility.source || 'OpenStreetMap')}</p>
        ${facility.address ? `<p>${escapeHtml(facility.address)}</p>` : ''}
        ${facility.accepted?.length ? `<p>Published materials: ${escapeHtml(facility.accepted.slice(0, 8).join(', '))}</p>` : '<p>Acceptance details are not published — confirm before travelling.</p>'}
        ${facility.opening_hours ? `<p>Hours: ${escapeHtml(facility.opening_hours)}</p>` : ''}
        <div class="facility-actions">
          <button class="small-btn show-on-map" type="button">Show on map</button>
          <button class="small-btn select-facility" type="button" ${selectable ? '' : 'disabled'}>${selectable ? 'Use this destination' : disabledText}</button>
        </div>
      </article>`;
  }).join('')}`;
  list.scrollTop = previousScroll;
  document.querySelectorAll('[data-facility-index]').forEach((card) => {
    const index = Number(card.dataset.facilityIndex);
    card.querySelector('.show-on-map')?.addEventListener('click', () => focusFacility(index));
    const selectButton = card.querySelector('.select-facility');
    if (selectButton && !selectButton.disabled) selectButton.addEventListener('click', () => chooseFacility(index));
  });
}

let leafletPromise = null;
function loadExternalStyle(href) {
  if ([...document.styleSheets].some((sheet) => sheet.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = href; link.crossOrigin = '';
  document.head.appendChild(link);
}
function loadExternalScript(src, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('Map library load timed out')); }, timeoutMs);
    script.src = src; script.crossOrigin = ''; script.async = true;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Map library failed to load')); };
    document.head.appendChild(script);
  });
}
async function loadLeaflet() {
  if (window.L) return window.L;
  if (leafletPromise) return leafletPromise;
  leafletPromise = (async () => {
    const sources = [
      { js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' },
      { js: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', css: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css' }
    ];
    let lastError;
    for (const source of sources) {
      try {
        loadExternalStyle(source.css);
        await loadExternalScript(source.js);
        if (window.L) return window.L;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Map library could not load');
  })();
  try { return await leafletPromise; } catch (error) { leafletPromise = null; throw error; }
}

async function focusFacility(index) {
  const facility = state.facilities[index];
  if (!facility) return;
  if (!state.map) await renderMap();
  state.map?.setView([facility.lat, facility.lon], 16);
}

function chooseFacility(index) {
  const facility = state.facilities[index];
  if (!facility) return;
  if (!facilitySelectionAllowed(facility)) {
    const special = activeItem()?.special_handling;
    $('pickupMessage').textContent = special && !state.analysisIsDemo && !selectedFacilityHasProof(facility)
      ? 'This special-handling destination has no signed published-material match. Refresh the facility search before using it.'
      : special
        ? 'No safe match is published for this special-handling item. Choose a facility whose published tags match the material.'
        : 'This facility publishes different accepted materials. Choose a better match.';
    return;
  }
  state.selectedFacilityId = facility.id;
  $('pickupFacility').value = facility.name || 'Selected destination';
  renderFacilities();
  syncActionMode();
  focusFacility(index);
  $('pickupMessage').textContent = facility.demo
    ? 'Demo destination selected; this action will remain demo-only.'
    : 'Destination selected. Confirm material acceptance with the facility before travelling.';
  scrollToElement($('pickup'));
}

function clearMap(message) {
  if (state.map) { state.map.remove(); state.map = null; }
  $('map').innerHTML = `<div class="map-placeholder">${escapeHtml(message)}</div>`;
}

async function renderMap() {
  if (!state.position) { clearMap('Choose a location to search nearby facilities.'); return; }
  const el = $('map');
  try { await loadLeaflet(); } catch {
    clearMap('Map library could not load. Facility list is still available.');
    return;
  }
  if (state.map) state.map.remove();
  el.innerHTML = '';
  state.map = window.L.map(el).setView([state.position.lat, state.position.lon], 13);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(state.map);
  window.L.circleMarker([state.position.lat, state.position.lon], { radius: 8 }).addTo(state.map).bindPopup('Search location');
  const points = [[state.position.lat, state.position.lon]];
  state.facilities.forEach((facility) => {
    points.push([facility.lat, facility.lon]);
    window.L.circleMarker([facility.lat, facility.lon], { radius: 7 }).addTo(state.map)
      .bindPopup(`<strong>${escapeHtml(facility.name || 'Recycling point')}</strong><br>${facility.distance_km === null ? 'Distance unavailable' : `${facility.distance_km.toFixed(2)} km away`}`);
  });
  if (points.length > 1) state.map.fitBounds(points, { padding: [28, 28], maxZoom: 14 });
  setTimeout(() => state.map?.invalidateSize(), 60);
}

function selectedFacility() {
  return state.facilities.find((facility) => facility.id === state.selectedFacilityId) || null;
}

function syncActionMode() {
  const pickup = $('pickupAction').value === 'pickup';
  $('pickupFacility').value = pickup ? 'Demo pickup — no logistics provider connected' : (selectedFacility()?.name || '');
  $('pickupFacility').placeholder = pickup ? 'Demo pickup' : 'Choose a facility';
  if (pickup) $('pickupMessage').textContent = 'Pickup is a demo workflow only; no collector will be dispatched.';
  else if ($('pickupMessage').textContent.includes('demo workflow')) $('pickupMessage').textContent = '';
}
$('pickupAction').addEventListener('change', syncActionMode);

function boundedText(value, max = 240, fallback = '') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
  return text || fallback;
}
function canonicalIso(value) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) return '';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const iso = new Date(ms).toISOString();
  return iso === value ? iso : '';
}
function localInputsToIso(date, time) {
  const dm=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||''));
  const tm=/^(\d{2}):(\d{2})$/.exec(String(time||''));
  if (!dm || !tm) return '';
  const y=Number(dm[1]),m=Number(dm[2]),d=Number(dm[3]),h=Number(tm[1]),min=Number(tm[2]);
  if (m<1||m>12||d<1||d>31||h<0||h>23||min<0||min>59) return '';
  const value=new Date(y,m-1,d,h,min,0,0);
  if (value.getFullYear()!==y||value.getMonth()!==m-1||value.getDate()!==d||value.getHours()!==h||value.getMinutes()!==min) return '';
  return value.toISOString();
}
function recordPlannedIso(record) {
  const direct=canonicalIso(record?.plannedAtIso);
  if (direct) return direct;
  return localInputsToIso(record?.date,record?.time);
}
function strictStoredWeight(value) { return typeof value==='number' && Number.isFinite(value) && value>=0.1 && value<=10000 ? value : 0; }
function formWeight(value) { const n=Number(value); return Number.isFinite(n)&&n>=0.1&&n<=10000?n:0; }
function recordMarker(record) {
  const value=typeof record?.marker==='string'?record.marker:typeof record?.id==='string'?record.id:'';
  return /^[A-Za-z0-9._:-]{1,140}$/.test(value)?value:'';
}
function recordFingerprint(record) {
  return [record.action,record.itemName,record.material,record.facilityId,record.weight,record.plannedAtIso].map((x)=>String(x??'')).join('|').slice(0,1000);
}
function scheduledDateTime(record) { const iso=recordPlannedIso(record); return iso?new Date(iso):null; }
function storedActionIsValid(record) {
  const action = record?.action;
  const status = record?.status;
  if (typeof record?.isDemo !== 'boolean' || !['dropoff','pickup'].includes(action) || !['planned','completed'].includes(status)) return false;
  const plannedAt = recordPlannedIso(record);
  if (!recordMarker(record) || !plannedAt || !strictStoredWeight(record?.weight)) return false;
  if (!boundedText(record?.itemName || record?.material, 160)) return false;
  if (status === 'completed') {
    const completedAt = canonicalIso(record?.completedAt);
    if (!completedAt || Date.parse(completedAt) < Date.parse(plannedAt) || Date.parse(completedAt) > Date.now() + 5 * 60_000) return false;
  }
  if (action === 'pickup') return record.isDemo === true;
  return Boolean(boundedText(record?.facilityId, 120) && boundedText(record?.facilityName, 160));
}
function selectedFacilityHasProof(facility) { return typeof facility?.facility_proof==='string' && facility.facility_proof.length>20 && compatibilityStatus(facility)==='possible-match' && !facility.demo; }

async function requestPlanProof(record) {
  if (!record?.facilityProof || !strictStoredWeight(record.weight) || !canonicalIso(record.plannedAtIso)) throw new Error('No eligible matched facility proof is available. Search again before the scheduled action.');
  if (state.actionReceiptPersistent === false) throw new Error('Persistent server proofs are not configured on this deployment. Set ACTION_RECEIPT_SECRET to 32+ random characters before relying on attested history.');
  const payload=await fetchJson('/api/action/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({facilityProof:record.facilityProof,weight:record.weight,plannedAt:record.plannedAtIso})},15000);
  if (payload.persistent !== true) {
    state.actionReceiptPersistent = false;
    throw new Error('This server is using a temporary proof secret, so its receipts would break after restart. Configure ACTION_RECEIPT_SECRET before relying on attested history.');
  }
  state.actionReceiptPersistent = true;
  if (typeof payload.planReceipt!=='string'||payload.planReceipt.length<20) throw new Error('Server returned no valid plan proof.');
  return payload.planReceipt;
}

$('pickupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton=event.submitter || $('pickupForm').querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  const item=activeItem();
  if (!item) { $('pickupMessage').textContent='Analyze and choose an item first.'; return; }
  const action=$('pickupAction').value;
  const facility=action==='dropoff'?selectedFacility():null;
  const weight=formWeight($('pickupWeight').value);
  const plannedAtIso=localInputsToIso($('pickupDate').value,$('pickupTime').value);
  if (!weight) { $('pickupMessage').textContent='Enter a realistic weight from 0.1 to 10,000 kg.'; return; }
  if (!plannedAtIso) { $('pickupMessage').textContent='Choose a valid date and time.'; return; }
  const plannedMs=Date.parse(plannedAtIso); const now=Date.now();
  if (plannedMs<now-60_000) { $('pickupMessage').textContent='A planned action cannot be scheduled in the past.'; return; }
  if (plannedMs>now+ACTION_MAX_DAYS*DAY_MS) { $('pickupMessage').textContent=`Plan a drop-off no more than ${ACTION_MAX_DAYS} days ahead.`; return; }
  if (action==='dropoff'&&!facility) { $('pickupMessage').textContent='Choose a facility before saving a drop-off.'; return; }

  const isDemo=state.analysisIsDemo||Boolean(facility?.demo)||action==='pickup';
  const marker=uid();
  const record={
    id:marker,marker,action,material:boundedText(item.material||item.name,160),itemName:boundedText(item.name,160),wasteType:boundedText(item.waste_type,40,'unknown'),
    specialHandling:item.special_handling===true,facilityId:boundedText(facility?.id,120)||null,facilityName:boundedText(facility?.name,160)||(action==='pickup'?'Demo pickup — no logistics provider connected':null),
    facilitySource:boundedText(facility?.source,80)||null,compatibility:compatibilityStatus(facility)||null,weight:Number(weight.toFixed(3)),
    date:$('pickupDate').value,time:$('pickupTime').value,plannedAtIso,note:boundedText($('pickupNote').value,300),status:'planned',isDemo,createdAt:'',
    facilityProof:selectedFacilityHasProof(facility)?facility.facility_proof:'',planReceipt:'',completionReceipt:'',serverAttestedAt:''
  };
  const eligible=!isDemo&&action==='dropoff'&&Boolean(record.facilityProof);
  const fingerprint=recordFingerprint(record);
  if (state.actionLocks.has(fingerprint)) return;
  state.actionLocks.add(fingerprint); if (submitButton) submitButton.disabled=true;
  try {
    await withStorageLock(`action-create:${fingerprint}`, async () => {
      const recent=storage.getArray(STORAGE_ACTIONS).some((existing)=>recordFingerprint(existing)===fingerprint&&Date.now()-Date.parse(existing.createdAt||0)<10_000);
      if (recent) { $('pickupMessage').textContent='That same action was just saved already, possibly in another tab.'; renderActions(); return; }
      if (eligible) {
        try { record.planReceipt=await requestPlanProof(record); record.proofState='planned-proof'; }
        catch (error) { record.proofState='plan-missing'; record.proofError=boundedText(error.message,220); }
      } else record.proofState=isDemo?'demo':'not-eligible';
      // Stamp insertion time after any slow proof request so a waiting tab cannot age out of the duplicate window.
      record.createdAt=new Date().toISOString();
      let inserted=false;
      const saved=await mutateStoredArray(STORAGE_ACTIONS,(all)=>{
        const duplicate=all.some((existing)=>recordFingerprint(existing)===fingerprint&&Date.now()-Date.parse(existing.createdAt||0)<10_000);
        if (duplicate) return all;
        inserted=true;
        return [record,...all].slice(0,100);
      });
      if (!saved) { $('pickupMessage').textContent='Could not save this action in browser storage. Check private-mode/storage settings and try again.'; return; }
      if (!inserted) { $('pickupMessage').textContent='That same action was just saved already, possibly in another tab.'; renderActions(); return; }
      $('pickupWeight').value=''; $('pickupNote').value='';
      $('pickupMessage').textContent=isDemo?'Saved as a demo action. Demo actions never count toward attested impact.'
        :record.planReceipt?'Action saved with a server-signed pre-action plan.'
        :eligible?'Action saved, but the pre-action proof could not be created. Retry it before the scheduled time.'
        :'Action saved locally. This destination does not have a signed published-material match, so it cannot count as server-attested impact.';
      renderActions(); await renderImpact();
    });
  } finally { state.actionLocks.delete(fingerprint); if (submitButton) submitButton.disabled=false; }
});

function proofDetailsMatchRecord(record, details) {
  if (!record||!details||record.action!=='dropoff'||record.isDemo!==false) return false;
  return boundedText(record.itemName,160)===details.itemName && boundedText(record.material,160)===details.material && boundedText(record.wasteType,40,'unknown')===details.wasteType &&
    record.specialHandling===details.specialHandling && boundedText(record.facilityId,120)===details.facilityId && boundedText(record.facilityName,160)===details.facilityName &&
    boundedText(record.facilitySource,80)===details.facilitySource && strictStoredWeight(record.weight)===details.weight && recordPlannedIso(record)===details.plannedAt &&
    (!record.serverAttestedAt || canonicalIso(record.serverAttestedAt)===details.completedAt);
}
function proofBadge(record) {
  if (record?.validRecord === false) return '<span class="danger-tag">Invalid local record</span>';
  if (record?.isDemo===true) return '<span class="demo-badge">DEMO</span>';
  if (state.actionReceiptPersistent === false && (record?.planReceipt || record?.completionReceipt)) return '<span class="danger-tag">Proof secret not persistent</span>';
  if (record?.status!=='completed') return record?.planReceipt?'<span class="neutral-tag">Plan proof stored</span>':'';
  if (!record?.planReceipt) return '<span class="neutral-tag">No pre-action proof</span>';
  if (!record?.completionReceipt) return '<span class="neutral-tag">Completion not attested</span>';
  const details=state.verifiedReceiptDetails.get(record.completionReceipt);
  if (!details) {
    if (state.impactVerificationState==='verified') return '<span class="danger-tag">Stored proof did not validate</span>';
    if (state.impactVerificationState==='unavailable') return '<span class="neutral-tag">Proof stored · revalidation unavailable</span>';
    return '<span class="neutral-tag">Proof stored · checking</span>';
  }
  return proofDetailsMatchRecord(record,details)?'<span class="safe-tag">Server-attested</span>':'<span class="danger-tag">Signed proof differs</span>';
}
function completionControl(record) {
  const marker=recordMarker(record); if (!marker||record.validRecord===false) return '<button class="complete-btn" type="button" disabled>Invalid record</button>';
  const planned=scheduledDateTime(record); if (!planned) return '<button class="complete-btn" type="button" disabled>Invalid schedule</button>';
  if (record.status==='completed') {
    if (!record.planReceipt) return '<button class="complete-btn" type="button" disabled>No pre-action proof</button>';
    if (!record.completionReceipt && record.proofState==='completion-unavailable') return '<button class="complete-btn" type="button" disabled>Attestation unavailable</button>';
    if (!record.completionReceipt && state.actionReceiptPersistent === false) return '<button class="complete-btn" type="button" disabled>Proof secret unavailable</button>';
    if (!record.completionReceipt) return `<button class="complete-btn" data-retry-completion="${escapeHtml(marker)}" type="button">Retry attestation</button>`;
    return '<span class="safe-tag">Completed</span>';
  }
  if (planned.getTime()>Date.now()) {
    if (!record.planReceipt&&record.facilityProof&&state.actionReceiptPersistent === false) return '<button class="complete-btn" type="button" disabled>Proof secret unavailable</button>';
    if (!record.planReceipt&&record.facilityProof) return `<button class="complete-btn" data-retry-plan="${escapeHtml(marker)}" type="button">Retry plan proof</button>`;
    return '<button class="complete-btn" type="button" disabled>Scheduled</button>';
  }
  return `<button class="complete-btn" data-complete="${escapeHtml(marker)}" type="button">Mark completed</button>`;
}
function safeHistoryRecord(record) {
  return {
    marker:recordMarker(record),itemName:boundedText(record?.itemName||record?.material,160,'Saved action'),material:boundedText(record?.material,160),wasteType:boundedText(record?.wasteType,40,'unknown'),
    specialHandling:record?.specialHandling===true,facilityId:boundedText(record?.facilityId,120),facilityName:boundedText(record?.facilityName,160,'Destination unconfirmed'),facilitySource:boundedText(record?.facilitySource,80),
    weight:strictStoredWeight(record?.weight),plannedAtIso:recordPlannedIso(record),date:boundedText(record?.date,10),time:boundedText(record?.time,5),status:record?.status==='completed'?'completed':'planned',
    action:record?.action==='pickup'?'pickup':'dropoff',isDemo:record?.isDemo===true,planReceipt:typeof record?.planReceipt==='string'?record.planReceipt.slice(0,20000):'',completionReceipt:typeof record?.completionReceipt==='string'?record.completionReceipt.slice(0,20000):'',
    serverAttestedAt:canonicalIso(record?.serverAttestedAt),facilityProof:typeof record?.facilityProof==='string'?record.facilityProof.slice(0,20000):'',
    note:boundedText(record?.note,300),completedAt:canonicalIso(record?.completedAt),
    proofState:boundedText(record?.proofState,40),proofErrorCode:boundedText(record?.proofErrorCode,60),proofError:boundedText(record?.proofError,220),
    validRecord:storedActionIsValid(record)
  };
}
function formatPlanned(record) {
  const iso=recordPlannedIso(record); if (!iso) return 'Invalid schedule';
  try { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso)); } catch { return iso; }
}
function renderActions() {
  const actions=storage.getArray(STORAGE_ACTIONS);
  $('pickupHistory').innerHTML=actions.length?actions.map((raw)=>{
    const record={...raw,...safeHistoryRecord(raw)};
    return `<article class="history-card"><div><div class="history-title"><strong>${escapeHtml(record.itemName)}${record.weight?` · ${record.weight.toFixed(1)} kg`:''}</strong>${record.specialHandling?'<span class="danger-tag">Special handling</span>':''}${proofBadge(record)}</div>
      <p>${record.action==='pickup'?'Demo pickup':'Drop-off'} · ${escapeHtml(record.facilityName)}</p><p>${escapeHtml(formatPlanned(record))} · ${record.status==='completed'?'Completed':'Planned'}</p>${record.note?`<p class="history-note">Note: ${escapeHtml(record.note)}</p>`:''}${record.proofError?`<p class="proof-error">${escapeHtml(record.proofError)}</p>`:''}</div>${completionControl(record)}</article>`;
  }).join(''):'<p class="muted">No actions saved yet.</p>';
  document.querySelectorAll('[data-complete]').forEach((b)=>b.addEventListener('click',()=>completeRecord(b.dataset.complete)));
  document.querySelectorAll('[data-retry-plan]').forEach((b)=>b.addEventListener('click',()=>retryPlanProof(b.dataset.retryPlan)));
  document.querySelectorAll('[data-retry-completion]').forEach((b)=>b.addEventListener('click',()=>retryCompletionProof(b.dataset.retryCompletion)));
}
async function retryPlanProof(marker) {
  if (state.actionLocks.has(`plan:${marker}`)) return; state.actionLocks.add(`plan:${marker}`);
  try {
    await withActionOperationLock(marker, async () => {
      const snapshot=storage.getArray(STORAGE_ACTIONS).find((r)=>recordMarker(r)===marker);
      if (!snapshot||snapshot.status==='completed') { $('pickupMessage').textContent='No pre-action proof can be created after completion.'; return; }
      if (!storedActionIsValid(snapshot) || snapshot.action !== 'dropoff' || snapshot.isDemo === true) { $('pickupMessage').textContent='This saved action is invalid or demo-only and cannot receive a server plan proof.'; renderActions(); return; }
      if (snapshot.planReceipt) { $('pickupMessage').textContent='A pre-action server proof is already stored for this action.'; renderActions(); return; }
      if (!snapshot.facilityProof) { $('pickupMessage').textContent='Search the facility again to obtain a fresh matched proof.'; return; }
      if (Date.parse(recordPlannedIso(snapshot)||0)<Date.now()-60_000) { $('pickupMessage').textContent='The scheduled time has passed; a pre-action proof cannot be created retroactively.'; return; }
      const receipt=await requestPlanProof(snapshot);
      let updated=false;
      const saved=await mutateStoredArray(STORAGE_ACTIONS,(all)=>{ const found=all.find((r)=>recordMarker(r)===marker); if(found&&found.status==='planned'&&storedActionIsValid(found)&&!found.planReceipt) {found.planReceipt=receipt;found.proofState='planned-proof';found.proofError='';updated=true;} return all; });
      if(!saved){$('pickupMessage').textContent='The proof was created, but browser storage could not save it. Check storage settings and retry.';return;}
      if(!updated){$('pickupMessage').textContent='This action changed in another tab before the proof could be stored.';renderActions();return;}
      $('pickupMessage').textContent='Pre-action server proof stored.'; renderActions();
    });
  } catch(error) { $('pickupMessage').textContent=error.message; }
  finally { state.actionLocks.delete(`plan:${marker}`); }
}
async function obtainCompletionReceipt(snapshot) {
  if (!snapshot?.planReceipt) throw new Error('No pre-action proof exists for this action. Physical completion can be recorded locally, but it cannot be retroactively server-attested.');
  if (state.actionReceiptPersistent === false) throw new Error('Persistent server proofs are not configured on this deployment.');
  const payload=await fetchJson('/api/action/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planReceipt:snapshot.planReceipt})},15000);
  if (payload.persistent !== true) {
    state.actionReceiptPersistent = false;
    throw new Error('This server proof is restart-sensitive because ACTION_RECEIPT_SECRET is not persistent.');
  }
  state.actionReceiptPersistent = true;
  if (typeof payload.completionReceipt!=='string'||payload.completionReceipt.length<20) throw new Error('Server returned no completion proof.');
  return { receipt:payload.completionReceipt, completedAt:canonicalIso(payload.details?.completedAt)||'' };
}
async function completeRecord(marker) {
  if (state.actionLocks.has(`complete:${marker}`)) return; state.actionLocks.add(`complete:${marker}`);
  try {
    await withActionOperationLock(marker, async () => {
      const snapshot=storage.getArray(STORAGE_ACTIONS).find((r)=>recordMarker(r)===marker);
      if (!snapshot||snapshot.status==='completed') return;
      if (!storedActionIsValid(snapshot)) { $('pickupMessage').textContent='This saved action is malformed and cannot be completed.'; renderActions(); return; }
      const planned=scheduledDateTime(snapshot); if(!planned) { $('pickupMessage').textContent='This action has an invalid schedule.'; return; }
      if (planned.getTime()>Date.now()) { $('pickupMessage').textContent='This action is scheduled for the future and cannot be completed yet.'; renderActions(); return; }
      let proof=null; let proofError=''; let proofErrorCode='';
      if (snapshot.planReceipt) { try { proof=await obtainCompletionReceipt(snapshot); } catch(error) { proofError=boundedText(error.message,220); proofErrorCode=boundedText(error.code,60); } }
      const proofPermanent = proofErrorCode === 'BAD_PLAN_RECEIPT';
      const completedAt=new Date().toISOString();
      let updated=false;
      const saved=await mutateStoredArray(STORAGE_ACTIONS,(all)=>{ const found=all.find((r)=>recordMarker(r)===marker); if(!found||found.status!=='planned'||!storedActionIsValid(found))return all; found.status='completed';found.completedAt=completedAt;if(proof){found.completionReceipt=proof.receipt;found.serverAttestedAt=proof.completedAt;found.proofError='';found.proofErrorCode='';}else if(proofError){found.proofError=proofError;found.proofErrorCode=proofErrorCode;if(proofPermanent)found.proofState='completion-unavailable';}updated=true; return all; });
      if(!saved){$('pickupMessage').textContent='Could not update local history.';return;}
      if(!updated){$('pickupMessage').textContent='This action changed in another tab before completion could be saved.';renderImpact();return;}
      $('pickupMessage').textContent=proof?'Completion recorded and server-attested.' : proofPermanent?'Completion recorded locally. The original pre-action proof is expired or invalid, so this completion cannot be retroactively server-attested.' : snapshot.planReceipt?'Completion recorded locally; server attestation failed. You can retry attestation.' : 'Completion recorded locally. No pre-action proof existed, so this completion cannot be retroactively server-attested.';
      renderActions(); await renderImpact();
    });
  } finally { state.actionLocks.delete(`complete:${marker}`); }
}
async function retryCompletionProof(marker) {
  if(state.actionLocks.has(`attest:${marker}`))return;state.actionLocks.add(`attest:${marker}`);
  try{
    await withActionOperationLock(marker, async () => {
      const snapshot=storage.getArray(STORAGE_ACTIONS).find((r)=>recordMarker(r)===marker);
      if(!snapshot||snapshot.status!=='completed')return;
      if(!storedActionIsValid(snapshot) || snapshot.action!=='dropoff' || snapshot.isDemo===true){$('pickupMessage').textContent='This saved action is invalid or demo-only and cannot be server-attested.';renderActions();return;}
      if(snapshot.completionReceipt){$('pickupMessage').textContent='This completion already has a stored server attestation.';renderActions();return;}
      if(!snapshot.planReceipt){$('pickupMessage').textContent='No pre-action proof exists. This completion cannot be retroactively server-attested.';return;}
      const proof=await obtainCompletionReceipt(snapshot);
      let updated=false;
      const saved=await mutateStoredArray(STORAGE_ACTIONS,(all)=>{const found=all.find((r)=>recordMarker(r)===marker);if(found&&found.status==='completed'&&storedActionIsValid(found)&&!found.completionReceipt){found.completionReceipt=proof.receipt;found.serverAttestedAt=proof.completedAt;found.proofError='';found.proofErrorCode='';updated=true;}return all;});
      if(!saved){$('pickupMessage').textContent='Server attestation succeeded, but browser storage could not save the receipt.';return;}
      if(!updated){$('pickupMessage').textContent='This action changed in another tab before the attestation could be stored.';renderImpact();return;}
      $('pickupMessage').textContent='Server attestation recovered.';renderActions();await renderImpact();
    });
  }catch(error){
    if(error.code==='BAD_PLAN_RECEIPT'){
      await mutateStoredArray(STORAGE_ACTIONS,(all)=>{const found=all.find((r)=>recordMarker(r)===marker);if(found&&found.status==='completed'){found.proofState='completion-unavailable';found.proofErrorCode='BAD_PLAN_RECEIPT';found.proofError=boundedText(error.message,220);}return all;});
      renderActions();
    }
    $('pickupMessage').textContent=error.message;
  }finally{state.actionLocks.delete(`attest:${marker}`);}
}
function normalizeVerifiedCompletion(raw, requested) {
  if(!raw||typeof raw!=='object'||typeof raw.receipt!=='string'||!requested.has(raw.receipt))return null;
  const weight=typeof raw.weight==='number'&&Number.isFinite(raw.weight)&&raw.weight>=0.1&&raw.weight<=10000?raw.weight:0;
  const completedAt=canonicalIso(raw.completedAt),plannedAt=canonicalIso(raw.plannedAt);
  if(!weight||!completedAt||!plannedAt||Date.parse(completedAt)>Date.now()+5*60_000||Date.parse(completedAt)<Date.parse(plannedAt))return null;
  const limits={planId:100,itemName:160,material:160,wasteType:40,facilityId:120,facilityName:160,facilitySource:80};
  const out={};
  for(const [field,max] of Object.entries(limits)){if(typeof raw[field]!=='string'||!raw[field]||raw[field].length>max)return null;out[field]=raw[field];}
  if(out.facilitySource!=='OpenStreetMap'||typeof raw.specialHandling!=='boolean')return null;
  return {receipt:raw.receipt,...out,specialHandling:raw.specialHandling,weight,completedAt,plannedAt};
}
async function renderImpact() {
  const scans=storage.getArray(STORAGE_SCANS);
  const realItemCount=scans.filter((scan)=>scan.demo===false).reduce((sum,scan)=>sum+(Array.isArray(scan.items)?scan.items.filter((x)=>x&&typeof x==='object').slice(0,8).length:0),0);
  $('metricScans').textContent=String(realItemCount);
  const actions=storage.getArray(STORAGE_ACTIONS);
  const receipts=[...new Set(actions.filter((r)=>r?.status==='completed'&&typeof r?.completionReceipt==='string').map((r)=>r.completionReceipt).filter((x)=>x.length>20&&x.length<=20000))];
  state.impactController?.abort(); state.impactController=null;
  state.verifiedReceiptDetails=new Map();
  if(!receipts.length){
    state.impactVerificationState='idle';
    $('metricPickups').textContent='0';$('metricKg').textContent='0.0';
    if($('impactProofNote'))$('impactProofNote').textContent='No server-attested matched completions are stored in this browser yet. Physical handoff remains self-reported.';
    renderActions(); return;
  }
  if(state.actionReceiptPersistent===false){
    state.impactVerificationState='unavailable';
    $('metricPickups').textContent='0';$('metricKg').textContent='0.0';
    if($('impactProofNote'))$('impactProofNote').textContent='Persistent server proofs are not configured, so restart-sensitive receipts are excluded from attested impact. Set ACTION_RECEIPT_SECRET to a stable 32+ character secret.';
    renderActions(); return;
  }
  if(navigator.onLine===false){
    state.impactVerificationState='unavailable';
    $('metricPickups').textContent='0';$('metricKg').textContent='0.0';
    if($('impactProofNote'))$('impactProofNote').textContent='Offline — attested impact will be revalidated when the connection returns. Local history remains available below.';
    renderActions(); return;
  }
  const controller=new AbortController(); state.impactController=controller; state.impactVerificationState='checking'; renderActions();
  try{
    const payload=await fetchJson('/api/action/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipts}),signal:controller.signal},15000);
    if(state.impactController!==controller)return;
    const requested=new Set(receipts); const completions=(Array.isArray(payload.completions)?payload.completions:[]).map((x)=>normalizeVerifiedCompletion(x,requested)).filter(Boolean);
    const seen=new Set(); const unique=completions.filter((x)=>{if(seen.has(x.planId))return false;seen.add(x.planId);return true;});
    for(const item of unique)state.verifiedReceiptDetails.set(item.receipt,item);
    state.impactVerificationState='verified';
    $('metricPickups').textContent=String(unique.length);$('metricKg').textContent=unique.reduce((sum,item)=>sum+item.weight,0).toFixed(1);
    if($('impactProofNote'))$('impactProofNote').textContent=`${unique.length} signed completion record${unique.length===1?'':'s'} revalidated by cleanup. Physical handoff remains self-reported.`;
  }catch(error){
    if(error.code!=='REQUEST_CANCELLED'&&state.impactController===controller){
      state.impactVerificationState='unavailable';
      $('metricPickups').textContent='0';$('metricKg').textContent='0.0';
      if($('impactProofNote'))$('impactProofNote').textContent='Attested impact could not be revalidated right now; local history is still shown below.';
    }
  }finally{
    if(state.impactController===controller){state.impactController=null;renderActions();}
  }
}
async function clearStoredHistory() {
  return withStorageLock(STORAGE_ACTIONS, () => withStorageLock(STORAGE_SCANS, async () => ({
    scansRemoved: storage.remove(STORAGE_SCANS),
    actionsRemoved: storage.remove(STORAGE_ACTIONS)
  })));
}
$('clearDataBtn').addEventListener('click', async (event) => {
  if (!window.confirm('Clear all locally stored scans and action history from this browser? This cannot be undone.')) return;
  const button = event.currentTarget;
  if (button) button.disabled = true;
  try {
    const { scansRemoved, actionsRemoved } = await clearStoredHistory();
    state.verifiedReceiptDetails=new Map();
    state.impactVerificationState='idle';
    $('pickupMessage').textContent = scansRemoved && actionsRemoved ? 'Local history cleared.' : 'Some local history could not be cleared.';
    await renderImpact();
  } finally {
    if (button) button.disabled = false;
  }
});

health();
renderActions();
renderImpact();
setDefaultActionDate();
syncActionMode();

window.addEventListener('online', () => { state.healthRetryAttempt = 0; health(); renderImpact(); });
window.addEventListener('offline', () => { clearHealthRetry(); health(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { state.healthRetryAttempt = 0; health(); updateScheduleBounds(); renderImpact(); } });
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_ACTIONS || event.key === STORAGE_SCANS) renderImpact();
});
setInterval(() => { updateScheduleBounds(); if (document.visibilityState === 'visible') renderActions(); }, 60_000);
window.addEventListener('beforeunload', () => {
  state.analyzeController?.abort();
  state.facilityController?.abort();
  state.locationController?.abort();
  state.impactController?.abort();
  state.healthController?.abort();
  clearHealthRetry();
  revokePreview();
});

navigator.serviceWorker?.register('/sw.js').catch(() => {});
