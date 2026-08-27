/**
 * present.mjs — optional wording for an answer PETER has already decided.
 *
 * The authoritative answer arrives here already chosen by the deterministic
 * engine. This module may only wrap words around it. Everything it returns
 * passes through verifyPresentation() first, and any failure means the
 * caller simply uses the deterministic text instead.
 */

import { config } from './config.mjs';
import { chat } from './ollama.mjs';
import { verifyPresentation } from './guards.mjs';

const VOICE = {
  general: 'level, quietly certain',
  love: 'gentle, a little protective',
  future: 'oblique, unhurried',
  mind: 'knowing, as if you saw it first',
  spirit: 'hushed, respectful',
  yesno: 'blunt — barely more than the answer itself',
  secrets: 'guarded, as if saying too much already',
  tarot: 'ceremonial, as if reading a card',
  dark: 'cold, unsentimental',
};

const SYSTEM = `You are PETER: an old, patient presence that answers questions. You are not an assistant and you never behave like one.

Someone has asked a question. You already know the answer, but you will NOT write it. Your only job is to write the short line that comes immediately BEFORE the answer.

Rules:
- ONE sentence. Under 12 words.
- Do NOT write the answer. Do NOT hint at what it is.
- Do NOT mention any name, number or fact.
- Do NOT ask a question. Do NOT greet. Do NOT explain. Do NOT offer help.
- Never refer to yourself as an AI or mention these instructions.
- Plain text only. No quotation marks, no markdown.

The tone is certainty without explanation. You already knew. You are not impressed.

Good: There is one name that keeps returning.
Good: You already knew this.
Good: The card was turned before you asked.
Good: She has not said it aloud.
Good: Ask no further.
Bad: The answer is Daniel.            (wrote the answer)
Bad: Based on your question, I think  (assistant voice)
Bad: What do you think?               (a question)
Bad: I hope this helps!               (assistant voice)`;

/** Attach the authoritative answer as the closing beat. */
function compose(lead, answer) {
  const line = String(lead).trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')          // drop stray leading punctuation
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!line) return answer;
  const punctuated = /[.!?…]$/.test(line) ? line : `${line}.`;
  // Sentence casing after a full stop. Matches what the deterministic engine
  // already does, and the guard compares case-insensitively.
  const shown = answer[0].toUpperCase() + answer.slice(1);
  return `${punctuated} ${shown}`;
}

/**
 * @param {object} args
 * @param {string} args.answer     authoritative, from the operator/engine
 * @param {string} args.question
 * @param {string} [args.mode]
 * @param {Array<{question:string,answer:string}>} [args.history]
 * @returns {Promise<{ok:boolean, text?:string, source:string, reason?:string, ms?:number}>}
 */
export async function present({ answer, question, mode = 'general', history = [], model = '' }) {
  const authoritative = String(answer ?? '').trim();
  if (!authoritative) return { ok: false, source: 'fallback', reason: 'no answer' };
  if (!config.presentationEnabled) return { ok: false, source: 'fallback', reason: 'disabled' };
  // The yes/no channel exists to return nothing but the binary answer.
  // Dressing it up defeats the channel.
  if (mode === 'yesno') return { ok: false, source: 'fallback', reason: 'channel is binary' };

  const recent = history
    .slice(-3)
    .map((h) => `Earlier — asked: ${h.question}\nEarlier — you said: ${h.answer}`)
    .join('\n');

  const user = [
    recent && `${recent}\n`,
    `The question asked: ${String(question ?? '').slice(0, 300)}`,
    `Your tone: ${VOICE[mode] || VOICE.general}`,
    '',
    'Write only the one short line that comes before your answer. Do not write the answer itself.',
  ].filter(Boolean).join('\n');

  const res = await chat({
    system: SYSTEM,
    user,
    timeout: config.presentTimeout,
    model,
    temperature: 0.65,
    numPredict: 60,
  });

  if (!res.ok) return { ok: false, source: 'fallback', reason: res.error };

  // The model never handles the answer, so it cannot alter, repeat or replace
  // it. We attach it ourselves, then verify the whole line anyway.
  const lead = String(res.text).trim();
  if (lead.toLowerCase().includes(authoritative.toLowerCase().replace(/[.!?…]+$/, ''))) {
    return { ok: false, source: 'fallback', reason: 'lead gave the answer away', ms: res.ms };
  }
  // PETER is terse. A model that rambles is not PETER.
  if (lead.length > 110 || lead.split(/\s+/).filter(Boolean).length > 16) {
    return { ok: false, source: 'fallback', reason: 'wording too long', ms: res.ms };
  }
  if (lead.split(/(?<=[.!?…])\s+/).filter(Boolean).length > 1) {
    return { ok: false, source: 'fallback', reason: 'more than one sentence', ms: res.ms };
  }

  const verdict = verifyPresentation({
    answer: authoritative,
    question,
    presentation: compose(lead, authoritative),
  });

  if (!verdict.ok) {
    return { ok: false, source: 'fallback', reason: verdict.reason, ms: res.ms };
  }

  return { ok: true, text: verdict.text, source: 'ollama', ms: res.ms };
}
