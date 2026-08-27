/**
 * guards.mjs — the rules that stop the model from becoming the author.
 *
 * Two jobs, both deterministic and both applied AFTER the model answers:
 *
 *   1. analyseCorrection()  — a suggested fix may only repair mechanical
 *      mistakes. Anything that alters meaning, names, numbers or content
 *      words is downgraded or rejected outright.
 *
 *   2. verifyPresentation() — presentation wording must contain the
 *      operator's authoritative answer verbatim and must not introduce a
 *      single new name, number or claim.
 *
 * If a guard is unsure, it fails closed. The deterministic PETER engine is
 * always a correct answer; the model is only ever an optional improvement.
 */

/* ----------------------------------------------------------- helpers ---- */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'if',
  'it', 'its', 'this', 'that', 'these', 'those', 'my', 'me', 'i', 'you',
  'your', 'he', 'she', 'they', 'them', 'his', 'her', 'their', 'we', 'us',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'has',
  'have', 'had', 'not', 'no', 'yes', 'so', 'as', 'by', 'from', 'one',
]);

export function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function words(text) {
  return norm(text).split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
}

/** Capitalised tokens that are NOT merely sentence-initial. */
export function properNouns(text) {
  const out = [];
  const sentences = norm(text).split(/(?<=[.!?…])\s+/);
  for (const sentence of sentences) {
    const toks = sentence.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
    toks.forEach((tok, i) => {
      if (i === 0) return;                                  // sentence start
      if (!/^\p{Lu}/u.test(tok)) return;
      if (tok === 'I') return;
      out.push(tok);
    });
  }
  return out;
}

/** Every capitalised token, sentence-initial included. */
export function capitalised(text) {
  return words(text).filter((w) => /^\p{Lu}/u.test(w) && w !== 'I');
}

export function digits(text) {
  return (norm(text).match(/\d+/g) || []).sort();
}

/**
 * Is `source` obviously a typing mistake that `target` repairs?
 * Missing vowels ("Stcy"), a stutter ("Stacyy"), or a tripled letter.
 * Anything else — "Stacy" vs "Stacey" — is a judgement call for the operator.
 */
function looksMistyped(source, target) {
  const w = String(source).toLowerCase();
  const c = String(target).toLowerCase();
  if (w === c) return true;                              // case only
  if (/(.)\1\1/.test(w)) return true;                    // "Staaacy"
  if (w.length >= 3 && !/[aeiou]/.test(w)) return true;  // "Stcy"
  const collapse = (x) => x.replace(/(.)\1+/g, '$1');
  if (/(.)\1/.test(w) && w.length > c.length && collapse(w) === collapse(c)) return true; // "Stacyy"
  return false;
}

function contentWords(text) {
  return words(text)
    .map((w) => w.toLowerCase())
    .filter((w) => !STOPWORDS.has(w));
}

/** Fuzzy overlap: a one-character typo still counts as the same word. */
function contentOverlap(a, b) {
  const A = contentWords(a);
  const B = contentWords(b);
  if (!A.length && !B.length) return 1;
  if (!A.length || !B.length) return 0;

  const pool = [...B];
  let matched = 0;
  for (const w of A) {
    const idx = pool.findIndex(
      (x) => x === w || (Math.min(w.length, x.length) >= 4 && levenshtein(w, x) <= 2)
    );
    if (idx !== -1) { matched++; pool.splice(idx, 1); }
  }
  return matched / Math.max(A.length, B.length);
}

/* -------------------------------------------------- correction guard ---- */

/**
 * Decide whether a suggested correction is mechanically safe.
 *
 * @param {string} original
 * @param {string} corrected
 * @returns {{safe:boolean, forceConfirm:boolean, reasons:string[]}}
 */
export function analyseCorrection(original, corrected) {
  const reasons = [];
  const a = norm(original);
  const b = norm(corrected);

  if (!b) return { safe: false, forceConfirm: false, reasons: ['empty correction'] };
  if (a === b) return { safe: true, forceConfirm: false, reasons: [] };

  // --- size ------------------------------------------------------------
  if (b.length < a.length * 0.6 || b.length > a.length * 1.8) {
    return { safe: false, forceConfirm: false, reasons: ['length changed too much'] };
  }

  const wa = words(a);
  const wb = words(b);
  if (Math.abs(wa.length - wb.length) > 1) {
    return { safe: false, forceConfirm: false, reasons: ['word count changed'] };
  }

  // --- numbers are never negotiable ------------------------------------
  const da = digits(a);
  const db = digits(b);
  if (da.join('|') !== db.join('|')) {
    return { safe: false, forceConfirm: false, reasons: ['numbers changed'] };
  }

  // --- names ------------------------------------------------------------
  // A capitalised token in the correction is acceptable only if the original
  // already contained that word (in any case), or something so close to it
  // that the original is plainly a typing mistake. Section 9: when more than
  // one reading is possible, ask the operator instead of guessing.
  const originalWords = wa;
  const originalLower = originalWords.map((w) => w.toLowerCase());
  let confirmNames = false;

  for (const cand of capitalised(b)) {
    const lower = cand.toLowerCase();

    // Same word, possibly only recapitalised — always fine.
    if (originalLower.includes(lower)) continue;

    // A near neighbour: this is a name repair, not a name swap.
    const nearIdx = originalLower.findIndex(
      (w) => w[0] === lower[0] && levenshtein(w, lower) <= 2
    );
    if (nearIdx === -1) {
      return { safe: false, forceConfirm: false, reasons: [`introduced name "${cand}"`] };
    }

    const source = originalWords[nearIdx];
    reasons.push(`name "${source}" → "${cand}"`);
    // Only auto-apply when the original is obviously mistyped. "Stacy" is a
    // perfectly good name, so "Stacy" → "Stacey" must be confirmed.
    if (!looksMistyped(source, cand)) confirmNames = true;
  }

  // A name that vanished entirely is a rewrite, not a repair.
  const correctedLower = wb.map((w) => w.toLowerCase());
  for (const name of capitalised(a)) {
    const lower = name.toLowerCase();
    if (correctedLower.includes(lower)) continue;
    if (correctedLower.some((w) => w[0] === lower[0] && levenshtein(w, lower) <= 2)) continue;
    return { safe: false, forceConfirm: false, reasons: [`name "${name}" was removed`] };
  }

  // --- meaning ----------------------------------------------------------
  const overlap = contentOverlap(a, b);
  if (overlap < 0.7) {
    return { safe: false, forceConfirm: false, reasons: ['meaning appears to have changed'] };
  }
  if (overlap < 0.9) reasons.push('wording drifted');

  return { safe: true, forceConfirm: confirmNames || overlap < 0.9, reasons };
}

/* ----------------------------------------------------- capture guard ---- */

/**
 * A capture repair may only CUT filler off the end. It can never add, replace
 * or reorder anything, so the check is simply: is the result a prefix of what
 * the operator actually typed?
 *
 * That single constraint makes this the safest correction in the system — the
 * model cannot invent an answer even if it tries.
 *
 * @returns {{safe:boolean, reasons:string[]}}
 */
export function analyseCaptureRepair(original, corrected) {
  const a = norm(original);
  const b = norm(corrected);

  if (!b) return { safe: false, reasons: ['nothing left'] };
  if (a === b) return { safe: true, reasons: [] };
  if (b.length > a.length) return { safe: false, reasons: ['longer than the original'] };
  if (!a.toLowerCase().startsWith(b.toLowerCase())) {
    return { safe: false, reasons: ['not a prefix of what was typed'] };
  }
  // Refuse to cut so much that nothing meaningful survives.
  if (b.length < 2) return { safe: false, reasons: ['trimmed too far'] };

  // What is being removed must actually LOOK like filler. A real model will
  // happily cut "the nine of swords" down to "the nine of"; the tail there is
  // a genuine word preceded by a space, not a keystroke run.
  const tail = a.slice(b.length);
  if (/\s/.test(tail.trim()) || /^\s/.test(tail)) {
    return { safe: false, reasons: ['the removed text looks like part of the answer'] };
  }
  if (tail.trim().length < 3) return { safe: false, reasons: ['nothing meaningful removed'] };

  const t = tail.trim().toLowerCase();
  const vowels = (t.match(/[aeiou]/g) || []).length;
  const vowelRatio = vowels / t.length;
  const looksLikeFiller =
    /(.)\1{2,}/.test(t) ||                                  // a held key
    (t.length >= 7 && vowelRatio < 0.18) ||                 // a long vowel-less mash
    /(?:asdf|qwer|zxcv|jkl|hjkl|uiop|wasd|lkjh|gfds|poiu|mnbv|fdsa)/.test(t) ||
    /(.{2,4})\1{1,}/.test(t);                               // a repeated block
  if (!looksLikeFiller) {
    return { safe: false, reasons: ['the removed text does not look like filler'] };
  }

  return { safe: true, reasons: [`removed ${a.length - b.length} trailing characters`] };
}

/* ------------------------------------------------ presentation guard ---- */

const ASSISTANT_SPEAK = [
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bbased on (the )?(information|context|data)\b/i,
  /\baccording to (my|the)\b/i,
  /\bi (cannot|can't|am unable to) (assist|help|provide)\b/i,
  /\bi'?m (just )?an? (ai|assistant)\b/i,
  /\bhere('| i)s (the|a|your)\b/i,
  /\blet me know if\b/i,
  /\bi hope (this|that) helps\b/i,
  /\bsure[,!]/i,
  /\bcertainly[,!]/i,
];

/**
 * Words a one-liner may legitimately capitalise, chiefly at a sentence start.
 * Anything capitalised and NOT in here (and not drawn from the answer or the
 * question) is treated as an invented name and the wording is discarded.
 * Erring toward rejection is free: the deterministic text is always ready.
 */
const SAFE_CAPS = new Set(
  ['Peter', 'I']
    .concat(
      ('a an the this that these those there here it its is are was were be been am ' +
       'you your yours he him his she her hers they them their we us our one ones ' +
       'what when where who whom whose why how which whatever whenever whoever ' +
       'yes no not never always already still yet soon later now then once again ' +
       'ask asked asking answer answered say said says speak spoken tell told ' +
       'know knew known think thought see saw seen look looked watch watched ' +
       'do does did done have has had will would can could should shall may might must ' +
       'some someone something nothing nobody anyone anything everyone everything ' +
       'more most less least much many few little enough only just even also too ' +
       'and but or so if because since although though while until before after ' +
       'in on at by for with without from into onto over under about against ' +
       'good bad better worse best worst true false right wrong close closer far ' +
       'name names word words card cards door doors light dark shadow shadows ' +
       'time times day days night nights year years moment moments ' +
       'quiet quietly silence silent listen listened wait waited patience patient ' +
       'certain certainly clear clearly obvious plain simple ' +
       'let leave left keep kept stop stopped begin began end ended finish finished ' +
       'come came go went give gave take took bring brought find found lose lost ' +
       'want wanted need needed like liked love loved fear feared trust trusted ' +
       'my mine me us ours theirs him her them himself herself themselves ' +
       'nothing everything anything something everywhere nowhere somewhere ' +
       'first second third last next another other others same different ' +
       'perhaps maybe possibly probably surely truly really indeed of to as at ' +
       'consider observe notice remember forget imagine picture watch ' +
       'somebody anybody nobody everybody ' +
       'relationships relationship feelings feeling hearts ' +
       'people matters truth truths lie choice choices path paths ' +
       'sometimes often rarely ' +
       'awaits arrives approaches turning darkness echo echoes')
        .split(/\s+/)
        .map((w) => w[0].toUpperCase() + w.slice(1))
    )
);

/**
 * Presentation wording must be a wrapper around the authoritative answer,
 * never a replacement for it.
 *
 * @param {object} args
 * @param {string} args.answer      the authoritative answer (operator's)
 * @param {string} args.question    the visitor's question
 * @param {string} args.presentation the model's proposed wording
 * @returns {{ok:boolean, reason?:string, text?:string}}
 */
export function verifyPresentation({ answer, question, presentation }) {
  let text = norm(presentation)
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\*\*/g, '')
    .trim();

  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > 200) return { ok: false, reason: 'too long' };

  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sentences.length > 3) return { ok: false, reason: 'too many sentences' };

  for (const rx of ASSISTANT_SPEAK) {
    if (rx.test(text)) return { ok: false, reason: 'assistant voice' };
  }

  // Prompt scaffolding echoed back by a small model.
  if (/\b(ANSWER|QUESTION|TONE|output|input)\s*:/i.test(text)) {
    return { ok: false, reason: 'echoed the prompt' };
  }

  // 1 — the authoritative answer must survive verbatim, exactly once.
  const needle = norm(answer).replace(/[.!?…]+$/, '');
  if (!needle) return { ok: false, reason: 'no authoritative answer' };
  const haystack = text.toLowerCase();
  const lowNeedle = needle.toLowerCase();
  if (!haystack.includes(lowNeedle)) {
    return { ok: false, reason: 'authoritative answer missing' };
  }
  // "It is Daniel. Daniel" — a small model repeating itself reads as a stutter.
  const occurrences = haystack.split(lowNeedle).length - 1;
  if (occurrences > 1) return { ok: false, reason: 'answer repeated' };

  // 2 — it must be the closing beat, not buried mid-sentence.
  const tailWindow = haystack.slice(haystack.lastIndexOf(lowNeedle) + lowNeedle.length);
  if (tailWindow.replace(/[\s.!?…"'’]/g, '').length > 0) {
    return { ok: false, reason: 'answer is not the last thing said' };
  }

  // 3 — a preamble that contradicts a definite answer.
  if (/\b(no information|cannot say|can'?t say|do not know|don'?t know|not sure|unable to)\b/i.test(text)) {
    return { ok: false, reason: 'preamble contradicts the answer' };
  }

  // 4 — no numbers that did not come from the answer or the question.
  const allowedDigits = new Set([...digits(answer), ...digits(question)]);
  for (const d of digits(text)) {
    if (!allowedDigits.has(d)) return { ok: false, reason: `invented number "${d}"` };
  }

  // 5 — no names that did not come from the answer or the question.
  //
  // The very first word of the line is capitalised because sentences are, so
  // it is exempt. Every other capitalised word is suspect — that is where an
  // invented name would land ("...decided. Michael knows this. Daniel").
  const allowedNames = new Set(
    [...words(answer), ...words(question)].map((w) => w.toLowerCase())
  );
  // Every capitalised word must be justified — including the first. "Michael
  // knows this too." opens a sentence exactly like "Consider what she said."
  // does, so position cannot tell them apart. Failing closed costs only a
  // fallback to the deterministic line; failing open puts an invented name in
  // front of an audience.
  for (const token of words(text)) {
    if (!/^\p{Lu}/u.test(token) || token === 'I') continue;
    if (SAFE_CAPS.has(token)) continue;
    if (allowedNames.has(token.toLowerCase())) continue;
    return { ok: false, reason: `invented name "${token}"` };
  }

  return { ok: true, text };
}
