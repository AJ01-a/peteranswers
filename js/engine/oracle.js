/**
 * oracle.js — decides what Peter says.
 * Pure logic: takes the question plus the current operator settings and
 * returns the finished line. The UI layer handles all the theatre.
 */

import { generate, compose, refusal, RARE_LINES, UNAVAILABLE_LINE, YES_LINES, NO_LINES } from './answers.js';
import { session } from './session.js';
import { getMode } from '../core/config.js';
import { pick, pickDistinct } from '../core/dom.js';

/** Odds of a rare unexplained line surfacing on any given question. */
const RARE_CHANCE = 0.012;
const UNAVAILABLE_CHANCE = 0.004;

/**
 * @param {object} args
 * @param {string} args.question
 * @param {string} args.secret     answer captured from the petition, if any
 * @param {object} args.operator   live operator settings
 * @returns {{text:string, kind:'secret'|'auto'|'refusal'|'rare'|'unavailable', raw:string, personality:string}}
 */
export function consult({ question, secret, operator }) {
  const mode = getMode(operator.modeId || 'general');
  const personality = operator.personality || mode.personality || 'calm';
  const history = operator.sessionMemory ? session.history() : [];

  // 1 — operator forced a response type
  if (operator.responseType === 'refusal') {
    const raw = refusal(session.lastRaw);
    session.lastRaw = raw;
    return { text: raw, kind: 'refusal', raw, personality };
  }
  if (operator.responseType === 'yes' || operator.responseType === 'no') {
    const raw = pickDistinct(operator.responseType === 'yes' ? YES_LINES : NO_LINES, session.lastRaw);
    session.lastRaw = raw;
    const { text, template } = compose(raw, personality, session.lastTemplate);
    session.lastTemplate = template;
    return { text, kind: 'auto', raw, personality };
  }

  // 2 — the operator's secret answer wins over everything generated
  const forced = String(secret || operator.secretAnswer || '').trim();
  if (forced) {
    const { text, template } = compose(forced, personality, session.lastTemplate);
    session.lastTemplate = template;
    session.lastRaw = forced;
    return { text, kind: 'secret', raw: forced, personality };
  }

  // 3 — rare unexplained states
  if (Math.random() < UNAVAILABLE_CHANCE) {
    return { text: UNAVAILABLE_LINE, kind: 'unavailable', raw: UNAVAILABLE_LINE, personality };
  }
  if (Math.random() < RARE_CHANCE) {
    const raw = pick(RARE_LINES);
    return { text: raw, kind: 'rare', raw, personality };
  }

  // 4 — spontaneous refusal
  if (Math.random() < (operator.refusalChance ?? 0)) {
    const raw = refusal(session.lastRaw);
    session.lastRaw = raw;
    return { text: raw, kind: 'refusal', raw, personality };
  }

  // 5 — generated answer for the channel
  const { raw } = generate({
    question,
    mode: mode.id,
    history,
    last: session.lastRaw,
  });
  session.lastRaw = raw;
  const { text, template } = compose(raw, personality, session.lastTemplate);
  session.lastTemplate = template;
  return { text, kind: 'auto', raw, personality };
}

/** Total think-time in ms for one consultation, with natural variation. */
export function thinkTime(operator) {
  const base = Math.max(0, Number(operator.delay) || 0);
  const jitter = Math.max(0, Number(operator.delayJitter) || 0);
  const swing = (Math.random() * 2 - 1) * jitter;
  return Math.max(400, (base + swing) * 1000);
}
