/**
 * main.js — wires the whole experience together.
 *
 * PUBLIC PATH:   petition → question → analysis → reveal → memory
 * HIDDEN PATH:   operator console → secret answer, timing, tone, effects
 *
 * Everything runs locally. No network requests are made by this application.
 */

import { $, sleep, pick, prefersReducedMotion } from './core/dom.js';
import { state, setOperator, setPref, setRuntime } from './core/state.js';
import { on } from './core/bus.js';
import { getMode } from './core/config.js';

import { PetitionEngine } from './engine/petition.js';
import { consult, thinkTime } from './engine/oracle.js';
import { session } from './engine/session.js';

import { PeterAvatar } from './components/PeterAvatar.js';
import { StatusIndicator } from './components/StatusIndicator.js';
import { ModeSelector } from './components/ModeSelector.js';
import { ProcessingSequence } from './components/ProcessingSequence.js';
import { AnswerDisplay } from './components/AnswerDisplay.js';
import { SessionHistory } from './components/SessionHistory.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { OperatorConsole } from './components/OperatorConsole.js';
import { initToasts, toast } from './components/Toasts.js';

import { ParticleBackground } from './fx/ParticleBackground.js';
import { initGlitch, burst, shake, textGlitch, startAmbientGlitch } from './fx/glitch.js';

import { AudioManager } from './audio/AudioManager.js';
import { VoiceManager } from './audio/VoiceManager.js';

import { initEasterEggs, questionEgg, WHISPERS } from './easterEggs.js';
import { peterAI, containsAuthoritative } from './services/peterAI.js';

/* ======================================================== element lookup */

const dom = {
  shell: $('#shell'),
  peter: $('#peter'),
  iris: $('#eye-iris'),
  caption: $('#peter-line'),
  status: $('#status'),
  statusLabel: $('#status-label'),
  veil: $('#veil'),
  glitchLayer: $('#glitch-layer'),
  particles: $('#particles'),

  modesRail: $('#modes-rail'),
  modeName: $('#mode-name'),
  modeHint: $('#mode-hint'),

  form: $('#question-form'),
  petition: $('#petition'),
  petitionWrap: $('#petition-wrap'),
  petitionProgress: $('#petition-progress'),
  question: $('#question'),
  counter: $('#question-counter'),
  askBtn: $('#btn-ask'),
  clearBtn: $('#btn-clear'),
  sequence: $('#sequence'),

  answer: $('#answer'),
  answerText: $('#answer-text'),
  answerMetaLabel: $('#answer-meta-label'),
  answerMetaTag: $('#answer-meta-tag'),
  replayBtn: $('#btn-replay'),
  againBtn: $('#btn-again'),

  historyList: $('#history-list'),
  historyEmpty: $('#history-empty'),
  clearSessionBtn: $('#btn-clear-session'),

  settingsPanel: $('#settings-panel'),
  settingsRows: $('#settings-rows'),
  settingsBtn: $('#btn-settings'),
  soundBtn: $('#btn-sound'),
  voiceBtn: $('#btn-voice'),
  motionBtn: $('#btn-motion'),

  opRoot: $('#op-console'),
  toasts: $('#toasts'),
};

/* ============================================================= managers */

initToasts(dom.toasts);

const audio = new AudioManager();
const voice = new VoiceManager();
const particles = new ParticleBackground(dom.particles);

initGlitch({ layerEl: dom.glitchLayer, peter: dom.peter, shell: dom.shell });

const avatar = new PeterAvatar({
  root: dom.peter,
  iris: dom.iris,
  caption: dom.caption,
});

const status = new StatusIndicator({
  root: dom.status,
  label: dom.statusLabel,
  onSecretUnlock: () => operatorConsole.toggle(),
});

const answerDisplay = new AnswerDisplay({
  root: dom.answer,
  textEl: dom.answerText,
  metaLabel: dom.answerMetaLabel,
  metaTag: dom.answerMetaTag,
  onType: () => { if (Math.random() < 0.34) audio.cue('type'); },
});

const sequence = new ProcessingSequence({
  root: dom.sequence,
  onStep: (step, progress) => {
    audio.cue('step');
    audio.setTension(0.25 + progress * 0.75);
    if (step.key === 'consult' && Math.random() < state.operator.glitch * 0.6) burst(state.operator.glitch * 0.5);
  },
});

const history = new SessionHistory({
  list: dom.historyList,
  emptyEl: dom.historyEmpty,
  clearBtn: dom.clearSessionBtn,
  onClear: () => {
    toast('Session cleared. Peter remembers nothing.');
    answerDisplay.idle();
    avatar.say('idle');
  },
});

/* ================================================== the petition engine */

const petitionEngine = new PetitionEngine(dom.petition, {
  getPetitionText: () => state.operator.petitionText,
  getTrigger: () => state.operator.trigger,
  onChange: (snap) => {
    dom.petitionWrap.classList.toggle('is-armed', snap.armed);
    dom.petitionProgress.style.width = `${Math.round(snap.progress * 100)}%`;
    setRuntime({ secretFromPetition: snap.secret });
    // A visible cue only the operator would recognise: the progress hairline
    // shifts colour while the closing trigger is still outstanding.
    dom.petitionWrap.classList.toggle('is-capturing', snap.captureOpen);
    if (snap.display.trim() && state.runtime.peterState === 'idle') avatar.setState('attentive');
  },
});

/* ============================================================== helpers */

function applyIntensity() {
  const root = document.documentElement;
  root.style.setProperty('--anim-intensity', String(state.operator.animation || 0.001));
  root.style.setProperty('--fx-intensity', String(0.4 + state.operator.glitch * 0.6 + state.operator.animation * 0.4));
}

function applyMotionPreference() {
  const reduced = state.prefs.reducedMotion || prefersReducedMotion();
  document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  particles.setEnabled(!reduced);
  dom.motionBtn.setAttribute('aria-pressed', String(state.prefs.reducedMotion));
}

async function applyAudioPreference() {
  const ok = await audio.setEnabled(state.prefs.ambient);
  dom.soundBtn.setAttribute('aria-pressed', String(state.prefs.ambient && ok));
  if (state.prefs.ambient && !ok) {
    setPref({ ambient: false });
    toast(audio.supported ? 'Sound needs a tap first — try again.' : 'This browser has no audio support.', { variant: 'warn' });
  }
  setOperator({ ambient: state.prefs.ambient });
}

function applyVoicePreference() {
  if (state.prefs.voice && !voice.supported) {
    setPref({ voice: false });
    dom.voiceBtn.setAttribute('aria-pressed', 'false');
    toast('This browser has no speech synthesis.', { variant: 'warn' });
    return;
  }
  voice.setEnabled(state.prefs.voice);
  dom.voiceBtn.setAttribute('aria-pressed', String(state.prefs.voice));
  setOperator({ voice: state.prefs.voice });
}

function setVeil(onFlag) {
  dom.veil.classList.toggle('is-on', onFlag && !state.prefs.reducedMotion && !prefersReducedMotion());
}

/* ============================================== the consultation itself */

let busy = false;

/**
 * Decide what PETER says. Deterministic and instant — the intelligent layer
 * is never consulted here, so an answer always exists.
 */
function decide({ questionText, secret }) {
  if (state.operator.paused) {
    return { text: 'Peter is unavailable.', kind: 'unavailable', raw: '', personality: state.operator.personality };
  }
  const egg = !secret && !state.operator.secretAnswer ? questionEgg(questionText) : null;
  if (egg) return { text: egg.text, kind: 'egg', raw: egg.text, personality: state.operator.personality };
  return consult({
    question: questionText,
    secret,
    operator: { ...state.operator, modeId: state.prefs.mode },
  });
}

/** Operator switches that would invalidate an in-flight wording request. */
const decisionFingerprint = () =>
  `${state.operator.paused}|${state.operator.responseType}|${state.prefs.mode}`;

/**
 * Ask the backend to word an answer that is already final.
 * Started as soon as the answer is known so it runs *underneath* the
 * cinematic sequence rather than adding to it.
 */
function startWording(result, questionText) {
  const eligible =
    state.operator.aiPresentation &&
    peterAI.online &&                       // never request when there is no backend
    (result.kind === 'secret' || result.kind === 'auto') &&
    result.raw;
  if (!eligible) return null;

  return peterAI.present({
    answer: result.raw,
    question: questionText,
    mode: state.prefs.mode,
    history: state.operator.sessionMemory
      ? session.history().slice(-3).map((h) => ({ question: h.question, answer: h.answer }))
      : [],
    model: state.operator.model,
    timeout: 12000,
  }).catch(() => null);
}

async function ask() {
  if (busy) return;

  const questionText = dom.question.value.trim();

  if (!questionText) {
    dom.question.focus();
    shake();
    avatar.setState('attentive');
    avatar.say('attentive', 'Peter cannot answer nothing.');
    toast('Write a question first.');
    return;
  }

  const check = petitionEngine.validate({ strict: state.operator.strictPetition });
  if (!check.ok) {
    dom.petition.focus();
    shake();
    avatar.say('attentive',
      check.reason === 'empty' ? 'The petition is missing.' : 'The petition is not finished.');
    toast('Write the petition to Peter first.', { variant: 'warn' });
    return;
  }

  busy = true;
  dom.askBtn.disabled = true;

  // Take the secret the operator hid inside the petition, if there was one.
  // takeSecret() already repairs the obvious case of a forgotten closing
  // trigger; `lastCapture` carries the details for the operator console.
  let secret = petitionEngine.takeSecret();
  const capture = petitionEngine.lastCapture;
  dom.petitionWrap.classList.remove('is-capturing');   // capture is closed now
  setRuntime({
    lastQuestion: questionText,
    secretFromPetition: secret,
    captureDiagnosis: capture,
    busy: true,
  });

  // --- theatre: begin ---------------------------------------------------
  voice.cancel();
  answerDisplay.stop();
  answerDisplay.thinking('Peter is silent…');
  avatar.setState('processing');
  status.set('processing');
  audio.cue('submit');
  audio.setTension(0.35);
  setVeil(true);

  // If the closing trigger was forgotten, the tail of the secret may still be
  // filler that the local repair could not recognise. Ask PETER, in parallel —
  // it resolves during the sequence, so it costs the performance nothing.
  const captureCheck =
    capture?.wasOpen && secret && state.operator.aiValidation && peterAI.online
      ? peterAI.validate({
          text: secret,
          field: 'capture',
          trigger: state.operator.trigger,
          model: state.operator.model,
        }).catch(() => null)
      : null;

  // The answer is settled now. Wording runs alongside the sequence, never
  // after it, so PETER's thinking time is ours to choose (section 19).
  const fingerprint = decisionFingerprint();
  let result = decide({ questionText, secret });
  let wording = startWording(result, questionText);

  const total = thinkTime(state.operator);
  const sequenceRun = sequence.run(total, { skip: !state.prefs.sequence });

  // Give the capture check the length of the sequence to come back.
  if (captureCheck) {
    const trimmed = await Promise.race([captureCheck, sequenceRun.then(() => null)]);
    if (trimmed && trimmed.status === 'corrected' && trimmed.corrected &&
        trimmed.corrected !== secret &&
        secret.toLowerCase().startsWith(trimmed.corrected.toLowerCase())) {
      secret = trimmed.corrected;
      setRuntime({
        secretFromPetition: secret,
        captureDiagnosis: { ...capture, text: secret, repaired: true, reason: trimmed.notes?.[0] || 'trimmed by PETER' },
      });
      // The answer changed, so the decision and any wording must be redone.
      result = decide({ questionText, secret });
      wording = startWording(result, questionText);
    }
  }

  await sequenceRun;

  // --- manual mode: hold until the operator sends ------------------------
  if (!state.operator.autoRespond) {
    status.set('processing');
    avatar.say('processing');
    await new Promise((resolve) => { setRuntime({ pendingResolve: resolve }); });
    setRuntime({ pendingResolve: null });
  }

  // If the operator changed their mind mid-sequence, re-decide and throw the
  // in-flight wording away — it belongs to an answer that no longer applies.
  if (decisionFingerprint() !== fingerprint) {
    result = decide({ questionText, secret });
    wording = null;
  }

  // Secrets are single-use so the next question starts clean.
  if (state.operator.secretAnswer) setOperator({ secretAnswer: '' });

  const isRefusal = result.kind === 'refusal' || result.kind === 'unavailable';

  // --- reveal -----------------------------------------------------------
  sequence.hide();

  if (isRefusal) {
    avatar.setState('refusing');
    status.set('offline');
    burst(Math.max(0.4, state.operator.glitch));
    shake();
    audio.cue('refuse');
    await sleep(450);
  } else {
    avatar.setState('answering');
    status.set('answering');
    audio.cue('reveal');
    audio.setTension(0.15);
    await sleep(prefersReducedMotion() ? 60 : 320);
  }

  // Collect the wording if it arrived in time; otherwise carry on without it.
  let display = result.text;
  if (wording) {
    const worded = await Promise.race([wording, sleep(1200).then(() => null)]);
    // Last line of defence: the operator's answer must still be in there.
    if (worded && containsAuthoritative(worded, result.raw)) display = worded;
  }

  const mode = getMode(state.prefs.mode);
  await answerDisplay.reveal(display, {
    kind: result.kind,
    tag: isRefusal ? null : mode.label,
  });

  if (result.kind === 'rare' || result.kind === 'unavailable') textGlitch(dom.answerText);

  if (state.prefs.voice) voice.speak(display);

  // --- settle -----------------------------------------------------------
  setVeil(false);
  audio.setTension(0);

  if (state.operator.sessionMemory) {
    session.add({
      question: questionText,
      answer: display,
      mode: state.prefs.mode,
      kind: result.kind,
    });
  }

  setRuntime({ lastAnswer: display, busy: false });
  busy = false;
  dom.askBtn.disabled = false;

  await sleep(1400);
  if (!busy) {
    avatar.setState(state.operator.paused ? 'paused' : 'idle');
    status.set(state.operator.paused ? 'offline' : 'connected');
  }
}

/* ==================================================== operator commands */

async function sendAnswer() {
  // Releasing a held answer must stay instant — never gate the performance.
  const resolve = state.runtime.pendingResolve;
  if (resolve) {
    setRuntime({ pendingResolve: null });
    resolve();
    return;
  }
  if (busy) { toast('Peter is already answering.'); return; }

  // A pending suggestion must be resolved before the answer goes out.
  if (state.runtime.pendingCorrection) {
    toast('Accept or keep the suggestion first.', { variant: 'warn' });
    return;
  }

  // Check the secret answer on its way out, if validation is on.
  if (state.operator.aiValidation && state.operator.secretAnswer.trim()) {
    const settled = await checkInput('answer');
    if (settled === null) return;          // waiting on the operator
  }

  if (dom.question.value.trim()) { ask(); return; }
  toast(state.operator.secretAnswer
    ? 'Answer queued for the next question.'
    : 'Nothing queued.');
}

function triggerRefusal() {
  setOperator({ responseType: 'refusal' });
  const resolve = state.runtime.pendingResolve;
  if (resolve) { setRuntime({ pendingResolve: null }); resolve(); }
  else if (!busy) {
    // Immediate, standalone refusal.
    avatar.setState('refusing');
    status.set('offline');
    burst(Math.max(0.5, state.operator.glitch));
    shake();
    audio.cue('refuse');
    answerDisplay.reveal(pick([
      'I cannot answer that.', 'Ask me something else.', 'That question is not meant to be answered.',
    ]), { kind: 'refusal' });
    setTimeout(() => {
      avatar.setState('idle');
      status.set('connected');
      setOperator({ responseType: 'normal' });
    }, 2600);
    return;
  }
  setTimeout(() => setOperator({ responseType: 'normal' }), 400);
}

function resetSession() {
  session.clear();
  answerDisplay.idle();
  avatar.setState('idle');
  status.set('connected');
  toast('Session reset.');
}

function hardReset() {
  session.clear();
  petitionEngine.reset();
  dom.question.value = '';
  dom.counter.textContent = '0 / 280';
  answerDisplay.idle();
  setOperator({ secretAnswer: '', target: '', responseType: 'normal', paused: false });
  avatar.setState('idle');
  status.set('connected');
  toast('All local state cleared.');
}

function togglePause() {
  const next = !state.operator.paused;
  setOperator({ paused: next });
  if (next) {
    avatar.setState('paused');
    status.set('offline');
    audio.setTension(0);
    toast('Peter paused.');
  } else {
    avatar.setState('idle');
    status.set('connected');
    toast('Peter resumed.');
  }
}


/* ============================================ PETER's intelligent layer */

let statusTimer = 0;

async function refreshAI({ force = false, announce = false, probe = false } = {}) {
  const status = await peterAI.refresh({ force, probe });
  setRuntime({ aiStatus: status.status, aiModel: status.model });
  operatorConsole.setAIStatus(status);
  if (announce) {
    toast(
      status.status === 'online' ? `PETER is online — ${status.model}`
        : status.status === 'model_unavailable' ? 'Ollama is up, but that model is not installed.'
        : status.status === 'no_backend' ? 'No backend — running on the built-in engine.'
        : 'PETER is offline — running on the built-in engine.',
      { variant: status.status === 'online' ? '' : 'warn' }
    );
  }
  return status;
}

/** Poll gently, and only while the console is open. */
function watchAI(on) {
  clearInterval(statusTimer);
  if (!on) return;
  statusTimer = setInterval(() => {
    if (state.runtime.consoleOpen && !document.hidden) refreshAI();
  }, 20000);
}

/**
 * Run the input past PETER. Resolves to the text that should be used.
 * Never throws, never blocks the trick: on any failure the original stands.
 */
async function checkInput(field = 'answer') {
  const isPetition = field === 'petition';
  const original = isPetition ? state.operator.petitionText : state.operator.secretAnswer;

  if (!original.trim()) {
    operatorConsole.showCorrection(null);
    toast(isPetition ? 'The petition is empty.' : 'No secret answer to check.');
    return original;
  }
  if (!state.operator.aiValidation) {
    operatorConsole.showCorrection(null);
    return original;
  }
  // Static host: there is nothing to ask, so don't ask.
  if (state.runtime.aiStatus === 'no_backend') {
    operatorConsole.showCorrection(null);
    return original;
  }

  operatorConsole.setConfidence(null);
  const result = await peterAI.validate({
    text: original,
    field,
    trigger: state.operator.trigger,
    model: state.operator.model,
  });
  result.field = field;

  setRuntime({ lastConfidence: result.confidence });
  operatorConsole.setConfidence(result.confidence);

  // Nothing to do.
  if (result.status === 'valid' && !result.needs_edit) {
    operatorConsole.showCorrection(result);
    return original;
  }

  // Too uncertain to suggest anything — the operator must look at it.
  if (result.needs_edit) {
    setRuntime({ pendingCorrection: null });
    operatorConsole.showCorrection(result);
    return null;
  }

  // High confidence and auto-correction on → apply silently.
  if (!result.needs_confirmation && state.operator.aiAutoCorrect) {
    applyCorrection(result);
    operatorConsole.showCorrection(result);
    return result.corrected;
  }

  // Otherwise hold it for ACCEPT / KEEP ORIGINAL.
  setRuntime({ pendingCorrection: result });
  operatorConsole.showCorrection({ ...result, needs_confirmation: true });
  return null;
}

function applyCorrection(result) {
  if (!result) return;
  if (result.field === 'petition') setOperator({ petitionText: result.corrected });
  else setOperator({ secretAnswer: result.corrected });
  operatorConsole.rebuildNotes();
}

function acceptCorrection(result) {
  const pending = result || state.runtime.pendingCorrection;
  applyCorrection(pending);
  setRuntime({ pendingCorrection: null });
  operatorConsole.showCorrection({ ...pending, needs_confirmation: false, needs_edit: false });
  toast('Correction applied.');
}

function keepOriginal() {
  setRuntime({ pendingCorrection: null });
  operatorConsole.showCorrection(null);
  toast('Original kept.');
}

/* ======================================================= operator console */

const operatorConsole = new OperatorConsole({
  root: dom.opRoot,
  onSend: sendAnswer,
  onClearAnswer: () => {
    setOperator({ secretAnswer: '', responseType: 'normal' });
    answerDisplay.idle();
    toast('Answer cleared.');
  },
  onRefuse: triggerRefusal,
  onGlitch: () => { burst(Math.max(0.45, state.operator.glitch)); audio.cue('glitch'); },
  onResetSession: resetSession,
  onHardReset: hardReset,
  onPauseToggle: togglePause,
  onModeChange: (id) => modes.select(id),
  getCaptureState: () => petitionEngine.snapshot(),
  onCheck: (field) => checkInput(field === 'petition' ? 'petition' : 'answer'),
  onAcceptCorrection: acceptCorrection,
  onKeepOriginal: keepOriginal,
  onRecheck: () => refreshAI({ force: true, probe: true, announce: true }),
  onModelPick: (name) => {
    setOperator({ model: name });
    toast(name ? `Preferring ${name}.` : 'Model selection set to auto.');
  },
  onToggle: (key, value, source) => {
    if (source === 'prefs') { applyMotionPreference(); return; }
    if (key === 'voice') { setPref({ voice: value }); applyVoicePreference(); }
    if (key === 'ambient') { setPref({ ambient: value }); applyAudioPreference(); }
  },
  onRange: (key) => { if (key === 'animation' || key === 'glitch') applyIntensity(); },
  onOpen: () => {
    setRuntime({ consoleOpen: true });
    audio.cue('open');
    refreshAI({ force: true, probe: true });
    watchAI(true);
  },
  onClose: () => {
    setRuntime({ consoleOpen: false });
    audio.cue('close');
    watchAI(false);
  },
});

/* ============================================================ mode rail */

const modes = new ModeSelector({
  rail: dom.modesRail,
  nameEl: dom.modeName,
  hintEl: dom.modeHint,
  onChange: (mode) => {
    setPref({ mode: mode.id });
    setOperator({ personality: mode.personality });
    audio.setMode(mode.id);
    audio.cue('open');
    dom.petition.placeholder = state.operator.petitionText;
    avatar.say('idle', mode.greeting || mode.hint);
    operatorConsole.sync();
  },
});

/* ========================================================= settings UI */

const settings = new SettingsPanel({
  root: dom.settingsPanel,
  rows: dom.settingsRows,
  toggleBtn: dom.settingsBtn,
  voice,
  onChange: (key) => {
    if (key === 'ambient') applyAudioPreference();
    if (key === 'voice') applyVoicePreference();
    if (key === 'reducedMotion') applyMotionPreference();
    operatorConsole.sync();
  },
});

/* ======================================================== interactions */

dom.form.addEventListener('submit', (e) => {
  e.preventDefault();
  ask();
});

dom.question.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    ask();
  }
});

dom.question.addEventListener('input', () => {
  const len = dom.question.value.length;
  dom.counter.textContent = `${len} / 280`;
  dom.question.style.height = 'auto';
  dom.question.style.height = `${Math.min(200, dom.question.scrollHeight)}px`;
  if (!busy) {
    if (len > 0 && state.runtime.peterState === 'idle') { avatar.setState('attentive'); status.set('listening'); }
    else if (len === 0 && state.runtime.peterState === 'attentive' && !dom.petition.value.trim()) {
      avatar.setState('idle'); status.set('connected');
    }
  }
});

dom.petition.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); dom.question.focus(); }
});

dom.clearBtn.addEventListener('click', () => {
  petitionEngine.reset();
  dom.question.value = '';
  dom.question.style.height = 'auto';
  dom.counter.textContent = '0 / 280';
  answerDisplay.idle();
  voice.cancel();
  avatar.setState('idle');
  status.set('connected');
  dom.petition.focus();
});

dom.againBtn.addEventListener('click', () => {
  dom.question.value = '';
  dom.question.style.height = 'auto';
  dom.counter.textContent = '0 / 280';
  petitionEngine.reset();
  answerDisplay.idle('Ask again.');
  dom.petition.focus();
});

dom.replayBtn.addEventListener('click', () => {
  const text = state.runtime.lastAnswer;
  if (!text) return;
  if (!voice.supported) { toast('This browser has no speech synthesis.', { variant: 'warn' }); return; }
  voice.speak(text, { force: true });
});

dom.soundBtn.addEventListener('click', async () => {
  setPref({ ambient: !state.prefs.ambient });
  await applyAudioPreference();
  operatorConsole.sync();
  settings.sync();
});

dom.voiceBtn.addEventListener('click', () => {
  setPref({ voice: !state.prefs.voice });
  applyVoicePreference();
  operatorConsole.sync();
  settings.sync();
});

dom.motionBtn.addEventListener('click', () => {
  setPref({ reducedMotion: !state.prefs.reducedMotion });
  applyMotionPreference();
  operatorConsole.sync();
  settings.sync();
  toast(state.prefs.reducedMotion ? 'Motion reduced.' : 'Motion restored.');
});

/* ========================================================== shortcuts */

function matchesShortcut(e, spec) {
  const parts = String(spec || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return false;
  const key = parts[parts.length - 1];
  const needCtrl = parts.includes('ctrl') || parts.includes('control');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');
  const needMeta = parts.includes('meta') || parts.includes('cmd');
  const pressed = (e.key || '').toLowerCase();
  const code = (e.code || '').toLowerCase().replace(/^key|^digit/, '');
  return (pressed === key || code === key)
    && (e.ctrlKey || e.metaKey) === (needCtrl || needMeta)
    && e.shiftKey === needShift
    && e.altKey === needAlt;
}

window.addEventListener('keydown', (e) => {
  // Open / close the console
  if (matchesShortcut(e, state.operator.shortcut)) {
    e.preventDefault();
    operatorConsole.toggle();
    return;
  }

  if (e.key === 'Escape') {
    if (operatorConsole.open) { e.preventDefault(); operatorConsole.close(); return; }
    if (!dom.settingsPanel.hidden) { settings.toggle(false); return; }
    voice.cancel();
    return;
  }

  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'Enter') { e.preventDefault(); sendAnswer(); return; }

  if (ctrl && e.shiftKey) {
    const k = (e.key || '').toLowerCase();
    const code = (e.code || '').toLowerCase();
    if (k === 'r' || code === 'keyr') { e.preventDefault(); resetSession(); return; }
    if (k === 'g' || code === 'keyg') { e.preventDefault(); burst(Math.max(0.45, state.operator.glitch)); audio.cue('glitch'); return; }
    if (k === 'x' || code === 'keyx') { e.preventDefault(); triggerRefusal(); return; }
    if (k === 'z' || code === 'keyz') { e.preventDefault(); togglePause(); return; }
  }
}, true);

/* ========================================================= easter eggs */

initEasterEggs({
  peter: dom.peter,
  avatar,
  onUnlock: (source) => {
    operatorConsole.show();
    if (source === 'konami') toast('The console is open.');
  },
  onWhisper: () => {
    avatar.say('idle', pick(WHISPERS));
    burst(state.operator.glitch * 0.5);
  },
});

/* ============================================================== startup */

function boot() {
  // Restore persisted preferences.
  modes.select(state.prefs.mode, { silent: true });
  dom.petition.placeholder = state.operator.petitionText;
  applyIntensity();
  applyMotionPreference();
  applyVoicePreference();
  dom.soundBtn.setAttribute('aria-pressed', 'false');

  if (state.prefs.ambient) {
    // Autoplay policy: wait for the first real gesture, then fade in.
    const resume = async () => {
      await applyAudioPreference();
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  particles.start();
  startAmbientGlitch();

  // Probe the backend once, quietly. A visitor never learns the outcome.
  refreshAI().catch(() => {});

  if (state.operator.paused) {
    avatar.setState('paused');
    status.set('offline');
  } else {
    avatar.setState('idle');
    status.set('connected');
  }

  if (session.length) {
    const last = session.last();
    answerDisplay.idle(`Peter remembers ${session.length} question${session.length === 1 ? '' : 's'} from this session.`);
    setRuntime({ lastAnswer: last.answer });
  } else {
    answerDisplay.idle();
  }

  // Peter grows attentive when the visitor focuses the form.
  for (const field of [dom.petition, dom.question]) {
    field.addEventListener('focus', () => {
      if (!busy && state.runtime.peterState === 'idle') { avatar.setState('attentive'); status.set('listening'); }
    });
    field.addEventListener('blur', () => {
      if (!busy && state.runtime.peterState === 'attentive'
        && !dom.question.value.trim() && !dom.petition.value.trim()) {
        avatar.setState('idle'); status.set('connected');
      }
    });
  }

  // Idle captions keep Peter breathing between questions.
  setInterval(() => {
    if (!busy && state.runtime.peterState === 'idle' && !document.hidden && Math.random() < 0.35) {
      avatar.say('idle');
    }
  }, 18000);

  if (location.protocol === 'file:') {
    const warn = document.createElement('div');
    warn.id = 'protocol-warning';
    warn.textContent = 'Opened directly from disk — ES modules need a server. Run: python3 -m http.server 8080';
    document.body.append(warn);
  }
}

on('operator:change', ({ changed }) => {
  if (changed.includes('animation') || changed.includes('glitch')) applyIntensity();
  if (changed.includes('petitionText')) dom.petition.placeholder = state.operator.petitionText;
  if (changed.includes('paused')) {
    if (state.operator.paused && !busy) { avatar.setState('paused'); status.set('offline'); }
  }
});

on('prefs:change', ({ changed }) => {
  if (changed.includes('reducedMotion')) applyMotionPreference();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) voice.cancel();
});

boot();

// Exposed only for manual QA in the browser console; harmless if unused.
window.__peter = { state, session, ask, avatar, audio, voice, petitionEngine, operatorConsole, modes };
