/**
 * answers.js — Peter's voice.
 *
 * Every answer is produced locally. The priority order is:
 *   1. the operator's secret answer (typed into the petition, or queued in the console)
 *   2. an operator-forced response type (refusal / yes / no)
 *   3. a spontaneous refusal (rare, configurable)
 *   4. a mode-appropriate generated answer
 *
 * Nothing here is a real prediction. It is stagecraft.
 */

import { PERSONALITIES, REFUSALS } from '../core/config.js';
import { pick, pickDistinct } from '../core/dom.js';

/* ------------------------------------------------------------------ banks */

const YES = ['Yes.', 'Yes — clearly.', 'Yes, without much doubt.', 'It is so.', 'Yes. You knew that.'];
const NO  = ['No.', 'No — not this time.', 'No, and you sensed it.', 'It is not so.', 'No. Let it go.'];
const MAYBE = ['Ask again later.', 'Not yet decided.', 'The answer is still forming.', 'Both, depending on you.'];

const BANKS = {
  general: {
    yesno: [...YES, ...NO, ...MAYBE],
    open: [
      'Sooner than you expect.',
      'The one you thought of first.',
      'Nothing is hidden from someone who is paying attention.',
      'It has already begun.',
      'Look at what you avoided saying out loud.',
      'The answer is smaller than the question.',
      'Three things must happen first. You control the first one.',
      'It depends on a choice you have not made yet.',
    ],
    why: [
      'Because {who} decided long before you asked.',
      'Because nobody said the true thing at the right time.',
      'Because you were looking in the wrong direction.',
      'Because it costs {who} less than telling the truth.',
    ],
  },
  love: {
    yesno: ['Yes — more than they show.', 'Yes, quietly.', 'No, though they are fond of you.',
            'Not in the way you mean.', 'Yes. It frightens them.', 'Ask again when you are calmer.'],
    open: [
      'They think about it more than they admit.',
      'Someone is waiting for you to speak first.',
      'Affection is there. Timing is not.',
      'The distance is protective, not cold.',
      'You already have the answer. You want a second opinion.',
      'It ends kindly, if you let it.',
    ],
    why: [
      'Because {who} is protecting something fragile.',
      'Because saying it would make it real.',
      'Because {who} trusts you more than they trust themselves.',
      'Because affection is easier to hide than to explain.',
    ],
  },
  future: {
    yesno: ['Yes — but later than you want.', 'No. Something replaces it.',
            'Yes, after one refusal.', 'The path bends before it arrives.'],
    open: [
      'Within the season, not the week.',
      'Twice. The second time will matter.',
      'A door opens where you stopped knocking.',
      'It arrives disguised as an inconvenience.',
      'Not as planned. Better, and later.',
      'The version of you who sees it will be different.',
    ],
    why: [
      'Because the sequence has not finished.',
      'Because {who} still has a decision to make.',
      'Because what you want and what you are ready for are not the same date.',
    ],
  },
  mind: {
    yesno: ['Yes — that is what you were thinking.', 'No. You changed it at the last moment.',
            'Yes. The first thing, not the second.', 'You held two. I took the quieter one.'],
    open: [
      'You pictured it before you finished reading this.',
      'The thing you almost typed instead.',
      'It has a colour attached to it. You know which.',
      'A name with two syllables.',
      'You were thinking of a person, not a thing.',
      'The number you rejected for being too obvious.',
    ],
    why: [
      'Because you rehearsed it before you asked.',
      'Because {who} is already in the room in your head.',
      'Because the second thought is always the honest one.',
    ],
  },
  spirit: {
    yesno: ['Yes. You are not being ignored.', 'No — that is your own fear speaking.',
            'Yes, though not in words.', 'Something answered. Not me.'],
    open: [
      'You are being accompanied, not watched.',
      'Say the name out loud. That is the whole ritual.',
      'What you felt on the stairs was nothing. What you felt after was not.',
      'Forgiveness was already given. You never asked for it.',
      'Leave the light on tonight. Not for them.',
    ],
    why: [
      'Because {who} never got to finish the sentence.',
      'Because grief keeps a channel open long after the line is dead.',
      'Because you have not put it down yet.',
    ],
  },
  yesno: {
    yesno: [...YES, ...NO],
    open: [...YES, ...NO],
    why: ['Yes.', 'No.'],
  },
  secrets: {
    yesno: ['Yes — and you are not the only one who knows.', 'No. The rumour is wrong.',
            'Yes. It was never as hidden as they think.', 'That one is sealed.'],
    open: [
      'Two people know. One of them told you already, indirectly.',
      'It is written somewhere you have access to.',
      'The secret is not the fact. It is who kept it.',
      'You were told once and chose not to hear it.',
      'Some doors should remain unopened.',
    ],
    why: [
      'Because {who} would lose more by saying it than by hiding it.',
      'Because a secret is only useful while it is one.',
      'Because you would have to act on it.',
    ],
  },
  tarot: {
    yesno: ['The card says yes.', 'The card says no.', 'The card is reversed — not yet.',
            'The card refuses to settle.'],
    open: [
      'The Tower. What falls was already leaning.',
      'The Star. Quietly, and for a long time.',
      'The Hermit. The answer needs solitude, not advice.',
      'The Wheel. It turns whether you push or not.',
      'The Moon, reversed. Someone is not lying, but is not clear either.',
      'Two of Swords. You are refusing to choose, and that is the choice.',
      'The Ace of Cups. Begin it.',
      'Death. An ending you will later call a relief.',
    ],
    why: [
      'Because the card beneath it was {who}.',
      'Because the spread answered a different question honestly.',
      'Because what you drew is what you brought.',
    ],
  },
  dark: {
    yesno: ['Yes. You already suspected, and asked anyway.', 'No. And that is the better outcome.',
            'Yes — you will wish you had not confirmed it.', 'No. Stop checking.'],
    open: [
      'You may not like what you discover.',
      'The person you trust least is right about this.',
      'It is not malice. That would be easier.',
      'You are asking to be told it is not your fault. It is partly your fault.',
      'Nothing is watching you. That is the part that unsettles you.',
      'The answer changes nothing, and you will ask again anyway.',
    ],
    why: [
      'Because {who} has nothing to gain from your version of events.',
      'Because people protect comfort before they protect you.',
      'Because you keep giving it another chance.',
    ],
  },
};

/** Very rare responses. Deliberately unexplained. */
export const RARE_LINES = [
  'That question has been asked here before.',
  'Someone else is also asking this, right now.',
  'I answered this the last time you were here.',
  'You are the third person tonight.',
];

const UNAVAILABLE = 'Peter is unavailable.';

/* -------------------------------------------------------------- analysis */

const LEADING = new Set([
  'is','are','am','was','were','do','does','did','will','would','can','could',
  'should','shall','has','have','had','may','might','must','if','isnt','arent',
]);
const STOP_CAPS = new Set([
  'Does','Do','Did','Is','Are','Am','Was','Were','Will','Would','Can','Could',
  'Should','Shall','Has','Have','Had','May','Might','Must','How','Why','What',
  'When','Where','Who','Which','The','A','An','My','I','If','Peter','Am',
]);

/** Pull likely names out of a question, for follow-up continuity. */
export function extractEntities(text) {
  const found = String(text).match(/\b[A-Z][a-zA-Z'’-]{1,18}\b/g) || [];
  const out = [];
  for (const w of found) {
    if (STOP_CAPS.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const FOLLOW_STARTS = /^(why|how come|and|but|so|then|what about|really|are you sure|how|when|who else|and why)\b/i;

export function analyse(question, history = []) {
  const q = String(question).trim();
  const lower = q.toLowerCase().replace(/^[^\w]+/, '');
  const words = lower.split(/\s+/).filter(Boolean);
  const first = words[0]?.replace(/[^a-z]/g, '') || '';

  const isYesNo = LEADING.has(first);
  const isWhy = /^why\b/.test(lower) || /^how come\b/.test(lower);
  const isFollowUp =
    (words.length <= 6 && FOLLOW_STARTS.test(lower)) ||
    (words.length <= 3 && /^(really|and|so|then)\b/.test(lower));

  const entities = extractEntities(q);
  let referent = null;
  if (isFollowUp && history.length) {
    for (let i = history.length - 1; i >= 0; i--) {
      const e = extractEntities(history[i].question);
      if (e.length) { referent = { entities: e, entry: history[i] }; break; }
      if (!referent) referent = { entities: [], entry: history[i] };
    }
  }

  return { text: q, lower, words, isYesNo, isWhy, isFollowUp, entities, referent };
}

/* ------------------------------------------------------------- composing */

const ENDS_SENTENCE = /[.!?…]$/;

function tidy(str) {
  let s = String(str).trim().replace(/\s+/g, ' ');
  if (!s) return s;
  s = s[0].toUpperCase() + s.slice(1);
  // An embedded phrase can land after a sentence break: "You already know it. daniel."
  s = s.replace(/([.!?…]\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
  if (!ENDS_SENTENCE.test(s)) s += '.';
  return s;
}

/**
 * Is this answer a short noun phrase that can be embedded in a sentence?
 *
 * "Daniel" and "the nine of swords" are. "No." is not — it is already a
 * complete statement, and "It is No." reads badly. Nor is a long sentence.
 */
function isPhrase(value) {
  if (/[.!?…]$/.test(value)) return false;          // already a statement
  if (/[.!?…]/.test(value)) return false;           // more than one sentence
  const words = value.split(/\s+/).filter(Boolean);
  return words.length <= 5;
}

/** Wrap a raw answer in a personality template. */
export function compose(raw, personalityId, lastTemplate = null) {
  const value = String(raw).trim();
  if (!value) return { text: '', template: null };

  const personality = PERSONALITIES[personalityId] || PERSONALITIES.calm;
  const pool = isPhrase(value)
    ? [...personality.templates, ...(personality.phraseTemplates || [])]
    : personality.templates;

  const template = pickDistinct(pool.length ? pool : ['{a}'], lastTemplate);

  if (template === '{a}') return { text: tidy(value), template };

  // Embedded: drop a trailing full stop so the sentence reads cleanly.
  const inner = value.replace(/\.$/, '');
  return { text: tidy(template.replace('{a}', inner)), template };
}

/* --------------------------------------------------------------- picking */

function bankFor(mode) {
  return BANKS[mode] || BANKS.general;
}

/**
 * Choose a raw (un-styled) answer for a question.
 * @returns {{raw:string, kind:string}}
 */
export function generate({ question, mode, history = [], last = null }) {
  const bank = bankFor(mode);
  const info = analyse(question, history);

  if (info.isWhy || (info.isFollowUp && /^why|^how come/.test(info.lower))) {
    const who =
      info.referent?.entities?.[0] ||
      info.entities[0] ||
      pick(['they', 'the other person', 'someone close to it']);
    const tpl = pickDistinct(bank.why, last);
    return { raw: tpl.replace('{who}', who), kind: 'auto' };
  }

  if (info.isFollowUp && !info.isWhy) {
    // "really?", "and?", "are you sure?" — reinforce rather than restate.
    const reinforce = [
      'I said what I said.',
      'Nothing has changed since you asked.',
      'Ask it properly and I will answer properly.',
      'The same answer, in the same order.',
    ];
    if (Math.random() < 0.55) return { raw: pickDistinct(reinforce, last), kind: 'auto' };
  }

  if (mode === 'yesno' || info.isYesNo) {
    return { raw: pickDistinct(bank.yesno, last), kind: 'auto' };
  }
  return { raw: pickDistinct(bank.open, last), kind: 'auto' };
}

export function refusal(last = null) {
  return pickDistinct(REFUSALS, last);
}

export const UNAVAILABLE_LINE = UNAVAILABLE;
export { YES as YES_LINES, NO as NO_LINES };
