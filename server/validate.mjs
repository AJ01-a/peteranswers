/**
 * validate.mjs — PETER's intelligent check on operator input.
 *
 * Three layers, strongest first:
 *
 *   1. localNormalise()     provably safe mechanical repairs. Runs always,
 *                           including when Ollama is not there at all.
 *   2. the model            spelling and obvious typing mistakes, returned
 *                           as structured JSON with a confidence.
 *   3. guards.js            vetoes anything that alters meaning, names or
 *                           numbers. The model never gets the last word.
 *
 * Then a mechanism policy is applied, because PETER's own engine is
 * punctuation-sensitive (see MECHANIC NOTES below).
 */

import { config } from './config.mjs';
import { chat, extractJSON } from './ollama.mjs';
import { analyseCorrection, analyseCaptureRepair, words } from './guards.mjs';

/* =========================================================================
   MECHANIC NOTES — why punctuation is not a free-for-all here
   -------------------------------------------------------------------------
   a) The petition field's trigger character (default ".") CLOSES the hidden
      capture while the operator types live. A secret answer containing the
      trigger is physically untypable, so we must never add one.
   b) engine/answers.js `isPhrase()` treats a value ending in terminal
      punctuation as a finished statement and skips the phrase templates.
      "Daniel" becomes "The answer is Daniel."; "Daniel." stays bare.
      Adding a period to a short answer silently changes the performance.
   Therefore: sentences may gain a final period, short noun phrases may not.
   ========================================================================= */

const TERMINAL = /[.!?…]+$/;

/** Repairs that cannot possibly change meaning. Always safe, always local. */
export function localNormalise(input) {
  const changes = [];
  const original = String(input ?? '');
  let text = original;

  const step = (next, note) => {
    if (next !== text) { text = next; changes.push(note); }
  };

  step(text.replace(/[   ]/g, ' '), 'Replaced non-breaking spaces');
  step(text.replace(/\s+/g, ' '), 'Collapsed repeated spaces');
  step(text.trim(), 'Trimmed surrounding whitespace');
  step(text.replace(/\s+([,.;:!?])/g, '$1'), 'Removed space before punctuation');
  step(text.replace(/([,;:])(?=\S)/g, '$1 '), 'Added space after punctuation');
  step(text.replace(/([.!?])\1+/g, '$1'), 'Removed duplicated punctuation');
  step(text.replace(/,{2,}/g, ','), 'Removed duplicated commas');
  step(
    text.replace(/\b(\p{L}+)(\s+\1\b)+/giu, '$1'),
    'Removed a duplicated word'
  );

  return { text, changes };
}

/** Short noun phrase, or a full statement? Mirrors engine/answers.js. */
function isShortPhrase(text) {
  const bare = text.replace(TERMINAL, '');
  if (/[.!?…]/.test(bare)) return false;
  return words(bare).length <= 5;
}

/**
 * Apply the punctuation rules the PETER engine actually depends on.
 * @returns {{text:string, changes:string[], notes:string[], triggerConflict:boolean}}
 */
export function applyMechanicPolicy(text, { field = 'answer', trigger = '.' } = {}) {
  const changes = [];
  const notes = [];
  let out = text;

  if (field === 'answer') {
    if (isShortPhrase(out)) {
      const stripped = out.replace(TERMINAL, '');
      if (stripped !== out) {
        out = stripped;
        changes.push('Removed the final full stop (a short answer must stay unpunctuated)');
        notes.push(
          'PETER styles short answers itself ("The answer is Daniel."). ' +
          'A trailing full stop would suppress that.'
        );
      }
    } else if (!TERMINAL.test(out) && out) {
      out += '.';
      changes.push('Added the missing full stop');
    }
  } else if (field === 'petition') {
    // The petition is spooled out character by character and is never typed,
    // so its punctuation is presentation only and safe to normalise.
    if (out && !/[.!?:…]$/.test(out)) notes.push('The petition does not end with punctuation.');
  }

  const triggerConflict = Boolean(trigger) && field === 'answer' && out.includes(trigger);
  if (triggerConflict) {
    notes.push(
      `This answer contains "${trigger}", which is the arming character. ` +
      'Typing it live would close the capture early — use the console field, ' +
      'or change the trigger in System.'
    );
  }

  return { text: out, changes, notes, triggerConflict };
}

/* ------------------------------------------------------------- prompts -- */

const SYSTEM = `You are a spell-checker inside a stage-magic application. You are NOT a chat assistant and you never talk to the user.

You receive one short line that a performer typed. Find MISSPELLED WORDS only.

For each misspelled word, report the word exactly as it was typed and what it should be. Do not rewrite the line — you only list individual words.

You MAY fix:
- misspelled words          (teh -> the)
- doubled letters           (Stacyy -> Stacy)
- missing letters           (Stcy -> Stacy)
- wrong capitalisation      (peter -> Peter)

You MUST NOT:
- replace a word with a different word or a synonym
- change a name into a different name unless the typed word is clearly not a real spelling
- change any number
- report a word that is already spelled correctly
- touch punctuation (a later stage handles it)

Reply with ONLY this JSON object and nothing else:
{"status":"valid|corrected|needs_confirmation","confidence":0.0,"fixes":[{"from":"<word exactly as typed>","to":"<corrected word>"}]}

- "valid": every word is spelled correctly. Use "fixes": [].
- "corrected": you are confident about every fix you listed.
- "needs_confirmation": a word looks wrong but more than one correction is plausible.
confidence is your certainty, 0.0 to 1.0.

Examples:
input: Peter, Stcy is the only one for me
output: {"status":"corrected","confidence":0.97,"fixes":[{"from":"Stcy","to":"Stacy"}]}
input: Peter, Stacy is the only one for me
output: {"status":"valid","confidence":1.0,"fixes":[]}
input: danil
output: {"status":"needs_confirmation","confidence":0.6,"fixes":[{"from":"danil","to":"Daniel"}]}`;

const CAPTURE_SYSTEM = `You are a component inside a stage-magic application. You are NOT a chat assistant.

A performer typed a short secret answer, then kept typing meaningless filler keys to finish an on-screen sentence. They forgot to mark where the answer ended, so the filler is stuck on the end.

Your only job: find where the intended answer stops, and return just that part.

Absolute rules:
- Your answer MUST be a prefix of the input, character for character.
- Never add, replace, reorder or re-spell anything.
- Never invent an answer.
- If the whole input looks like a real answer with no filler, return it unchanged.
- If you cannot tell where the answer ends, say so instead of guessing.

Filler looks like: a held key (qqqqqqqq), a mashed row (asdfghjkl), a repeated block (asdasdasd), or random letters with no word shape.

Reply with ONLY this JSON and nothing else:
{"status":"valid|corrected|needs_confirmation","confidence":0.0,"corrected":"<prefix of the input>","changes":["<short description>"]}`;

const SCHEMA_STATUSES = new Set(['valid', 'corrected', 'needs_confirmation', 'invalid']);

/** Apply word-level fixes to the original. Whole words only, in place. */
function applyFixes(original, fixes) {
  let text = original;
  const applied = [];
  for (const fix of fixes) {
    const from = String(fix.from ?? '').trim();
    const to = String(fix.to ?? '').trim();
    if (!from || !to || from === to) continue;
    if (from.length > 60 || to.length > 60) continue;
    // Whole-word, all occurrences, case-sensitive first then insensitive.
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let rx = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
    if (!rx.test(text)) {
      rx = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
      if (!rx.test(text)) continue;          // the model invented a word that isn't there
    }
    rx.lastIndex = 0;
    const next = text.replace(rx, to);
    if (next !== text) {
      text = next;
      applied.push(`Corrected '${from}' to '${to}'`);
    }
  }
  return { text, applied };
}

function parseModel(raw) {
  const data = extractJSON(raw);
  if (!data || typeof data !== 'object') return null;

  const status = SCHEMA_STATUSES.has(data.status) ? data.status : null;
  if (!status) return null;

  let confidence = Number(data.confidence);
  if (!Number.isFinite(confidence)) confidence = status === 'valid' ? 1 : 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  const fixes = Array.isArray(data.fixes)
    ? data.fixes.filter((f) => f && typeof f === 'object').slice(0, 8)
    : [];

  // Older/looser replies may still send a whole corrected line. Accept it only
  // when it plausibly IS the whole line, never when it is a single word.
  const wholeLine = typeof data.corrected === 'string' ? data.corrected.trim() : '';

  return { status, confidence, fixes, wholeLine };
}

/* ------------------------------------------------------------ validate -- */

/**
 * @param {{text:string, field?:'answer'|'petition', trigger?:string}} args
 * @returns {Promise<object>} the structured result described in the README
 */
/**
 * Repair a secret captured through the petition field when the operator forgot
 * the closing trigger. Truncation only — see analyseCaptureRepair().
 *
 * @returns {Promise<object>}
 */
export async function repairCapture({ text, model = '' }) {
  const original = String(text ?? '').trim();
  const base = {
    status: 'valid', confidence: 1, original, corrected: original,
    changes: [], needs_confirmation: false, needs_edit: false,
    source: 'local', notes: [], mechanic: { triggerConflict: false },
  };
  if (!original || !config.validationEnabled) return base;

  const res = await chat({
    system: CAPTURE_SYSTEM,
    user: original,
    timeout: config.validateTimeout,
    json: true,
    model,
    temperature: 0,
    numPredict: 160,
  });
  if (!res.ok) {
    return { ...base, notes: ['PETER could not be reached; kept what was typed.'] };
  }

  // The capture prompt has its own contract: a whole truncated string, not a
  // list of word fixes. Parse it directly rather than via parseModel().
  const data = extractJSON(res.text);
  const suggestion = typeof data?.corrected === 'string' ? data.corrected.trim() : null;
  let confidence = Number(data?.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));
  const status = SCHEMA_STATUSES.has(data?.status) ? data.status : null;
  if (!data || suggestion == null || !status) {
    return { ...base, notes: ['PETER returned an unreadable reply.'] };
  }
  const parsed = { status, confidence, corrected: suggestion, changes: Array.isArray(data.changes)
    ? data.changes.filter((c) => typeof c === 'string').slice(0, 4) : [] };

  const verdict = analyseCaptureRepair(original, parsed.corrected);
  if (!verdict.safe) {
    return { ...base, notes: [`Trim rejected: ${verdict.reasons[0]}.`] };
  }
  // Uncertainty is reported first: the operator should hear "I wasn't sure"
  // even when the model happened to return the text unchanged.
  if (parsed.confidence < config.confirmAt || parsed.status === 'needs_confirmation') {
    return {
      ...base, source: 'ollama', confidence: parsed.confidence,
      notes: ['PETER was unsure where the answer ended; kept what was typed.'],
    };
  }
  if (parsed.corrected === original) {
    return { ...base, source: 'ollama', confidence: parsed.confidence };
  }

  return {
    status: 'corrected',
    confidence: parsed.confidence,
    original,
    corrected: parsed.corrected.trim(),
    changes: parsed.changes.length ? parsed.changes : verdict.reasons,
    needs_confirmation: false,
    needs_edit: false,
    source: 'ollama',
    notes: ['The closing trigger was missing; PETER trimmed the filler.'],
    mechanic: { triggerConflict: false },
  };
}

export async function validate({ text, field = 'answer', trigger = '.', model = '' }) {
  if (field === 'capture') return repairCapture({ text, model });

  const original = String(text ?? '');
  const notes = [];

  if (!original.trim()) {
    return {
      status: 'invalid', confidence: 1, original, corrected: '',
      changes: [], needs_confirmation: false, needs_edit: true,
      source: 'local', notes: ['Nothing to check.'],
      mechanic: { triggerConflict: false },
    };
  }

  // --- layer 1: deterministic, always available -------------------------
  const local = localNormalise(original);
  let workingText = local.text;
  let changes = [...local.changes];
  let confidence = 1;
  let source = 'local';
  let modelStatus = null;

  // --- layer 2: the model ------------------------------------------------
  if (config.validationEnabled) {
    const res = await chat({
      system: SYSTEM,
      user: workingText,
      timeout: config.validateTimeout,
      json: true,
      model,
      temperature: 0,
      numPredict: 220,
    });

    if (res.ok) {
      const parsed = parseModel(res.text);
      if (!parsed) {
        notes.push('PETER returned an unreadable reply; mechanical checks only.');
      } else {
        modelStatus = parsed.status;

        // Word-level fixes are the contract; a whole rewritten line is only
        // accepted when it really looks like the whole line.
        let candidate = workingText;
        let described = [];
        if (parsed.fixes.length) {
          const out = applyFixes(workingText, parsed.fixes);
          candidate = out.text;
          described = out.applied;
        } else if (parsed.wholeLine && parsed.wholeLine !== workingText) {
          const plausible =
            Math.abs(words(parsed.wholeLine).length - words(workingText).length) <= 1 &&
            parsed.wholeLine.length >= workingText.length * 0.6;
          if (plausible) {
            candidate = parsed.wholeLine;
            described = ['Corrected spelling'];
          } else {
            // A whole-line rewrite rather than a spelling fix. Discard it, but
            // say so — the operator should know a suggestion was made and refused.
            notes.push('Suggestion rejected: PETER tried to reword this rather than fix it.');
          }
        }
        parsed.corrected = candidate;
        parsed.changes = described;
        // --- layer 3: the guards -----------------------------------------
        const verdict = analyseCorrection(workingText, parsed.corrected);
        if (!verdict.safe) {
          notes.push(`Suggestion rejected: ${verdict.reasons[0] || 'meaning would change'}.`);
        } else if (parsed.status === 'invalid') {
          notes.push('PETER could not read that at all.');
          confidence = parsed.confidence;
        } else if (
          candidate !== workingText &&
          (parsed.confidence < config.confirmAt || parsed.status === 'invalid')
        ) {
          // Too uncertain to even suggest — ask the operator to edit.
          confidence = parsed.confidence;
          notes.push('PETER is not sure what you meant.');
          return {
            status: 'needs_confirmation',
            confidence,
            original,
            corrected: workingText,
            changes,
            needs_confirmation: true,
            needs_edit: true,
            source: 'ollama',
            notes,
            mechanic: applyMechanicPolicy(workingText, { field, trigger }),
          };
        } else {
          if (parsed.corrected !== workingText) {
            workingText = parsed.corrected;
            changes.push(...(parsed.changes.length ? parsed.changes : ['Corrected spelling']));
          }
          confidence = parsed.confidence;
          source = 'ollama';
          if (verdict.forceConfirm) {
            notes.push(`Needs your eye: ${verdict.reasons[0] || 'ambiguous change'}.`);
          }
          var forceConfirm = verdict.forceConfirm;
        }
      }
    } else {
      notes.push(
        res.error === 'timeout'
          ? 'PETER took too long; mechanical checks only.'
          : 'PETER is offline; mechanical checks only.'
      );
    }
  }

  // --- mechanism policy --------------------------------------------------
  const policy = applyMechanicPolicy(workingText, { field, trigger });
  workingText = policy.text;
  changes.push(...policy.changes);
  notes.push(...policy.notes);

  // --- final status ------------------------------------------------------
  const changed = workingText !== original;
  const needsConfirmation =
    changed &&
    (Boolean(typeof forceConfirm !== 'undefined' && forceConfirm) ||
      (source === 'ollama' && confidence < config.autoApplyAt));

  return {
    status: changed ? 'corrected' : 'valid',
    confidence: source === 'local' ? 1 : confidence,
    original,
    corrected: workingText,
    changes,
    needs_confirmation: needsConfirmation,
    needs_edit: false,
    source,
    model_status: modelStatus,
    notes,
    mechanic: { triggerConflict: policy.triggerConflict },
  };
}
