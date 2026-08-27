/**
 * config.js — static configuration for the oracle.
 * Nothing here is secret; the operator's live settings live in state.js.
 */

/** The sentence the audience believes must be typed to summon Peter. */
export const DEFAULT_PETITION = 'Peter, please answer the following question:';

/** Default trigger character that arms the hidden petition mechanic. */
export const DEFAULT_TRIGGER = '.';

export const STORAGE_KEYS = {
  prefs: 'peter.prefs.v1',
  operator: 'peter.operator.v1',
  session: 'peter.session.v1',
};

/** Channels ("modes"). Each tints the palette and steers the wording. */
export const MODES = [
  {
    id: 'general', label: 'General', hint: 'Peter listens without preference.',
    petitionVerb: 'answer', greeting: 'Ask.', personality: 'calm',
  },
  {
    id: 'love', label: 'Love', hint: 'Matters of attachment. Peter is gentler here.',
    petitionVerb: 'answer', greeting: 'Careful with this one.', personality: 'calm',
  },
  {
    id: 'future', label: 'Future', hint: 'What has not happened yet is the least certain thing.',
    petitionVerb: 'reveal', greeting: 'Nothing here is fixed.', personality: 'cryptic',
  },
  {
    id: 'mind', label: 'Mind Reading', hint: 'Think of it clearly before you type.',
    petitionVerb: 'read', greeting: 'Hold the thought.', personality: 'mysterious',
  },
  {
    id: 'spirit', label: 'Spirit', hint: 'Ask quietly. Peter answers the same either way.',
    petitionVerb: 'answer', greeting: 'Someone is listening.', personality: 'mysterious',
  },
  {
    id: 'yesno', label: 'Yes / No', hint: 'Only binary answers are returned on this channel.',
    petitionVerb: 'answer', greeting: 'Yes or no. Nothing else.', personality: 'direct',
  },
  {
    id: 'secrets', label: 'Secrets', hint: 'Some answers are held back on purpose.',
    petitionVerb: 'answer', greeting: 'Not everything will be given.', personality: 'cryptic',
  },
  {
    id: 'tarot', label: 'Tarot', hint: 'Peter draws a card before speaking.',
    petitionVerb: 'draw for', greeting: 'The deck is cut.', personality: 'mysterious',
  },
  {
    id: 'dark', label: 'Dark', hint: 'Blunter. Colder. Still only a game.',
    petitionVerb: 'answer', greeting: 'You asked for this one.', personality: 'dark',
  },
];

export const MODE_IDS = MODES.map((m) => m.id);
export const getMode = (id) => MODES.find((m) => m.id === id) || MODES[0];

/**
 * Personalities wrap a raw answer. `{a}` is the answer text.
 * Templates are picked at random; the first is the safest fallback.
 */
/**
 * Personalities wrap a raw answer. `{a}` is the answer text.
 *
 * `templates`       read correctly whatever the answer is.
 * `phraseTemplates` only work when the answer is a short noun phrase
 *                   ("Daniel", "the nine of swords") — applying them to a
 *                   full sentence produces "The answer is Because they…".
 */
export const PERSONALITIES = {
  direct: {
    label: 'Direct',
    templates: ['{a}'],
    phraseTemplates: [],
  },
  calm: {
    label: 'Calm',
    templates: ['{a}'],
    phraseTemplates: ['The answer is {a}', 'It is {a}'],
  },
  mysterious: {
    label: 'Mysterious',
    templates: ['Peter says: {a}', '{a}'],
    phraseTemplates: [
      'You already know it. {a}',
      'What came through is {a}',
      '{a} — though you suspected as much.',
    ],
  },
  cryptic: {
    label: 'Cryptic',
    templates: [
      'Some doors open by themselves. {a}',
      'Ask no further. {a}',
      '{a}. That is all that is permitted.',
    ],
    phraseTemplates: ['The shape of it is {a}'],
  },
  dark: {
    label: 'Dark',
    templates: [
      'You may not like it. {a}',
      '{a}. Do with that what you will.',
      'Peter answers, reluctantly: {a}',
    ],
    phraseTemplates: ['It was always {a}'],
  },
};

export const PERSONALITY_IDS = Object.keys(PERSONALITIES);

/** Refusal / uncertainty lines, keyed loosely by tone. */
export const REFUSALS = [
  'I cannot answer that.',
  'Ask me something else.',
  'You already know the answer.',
  'I am uncertain.',
  'That question is not meant to be answered.',
  'The connection will not hold for this one.',
  'Not this. Not now.',
  'Peter declines.',
];

/** Peter's idle captions, shown under the avatar. */
export const CAPTIONS = {
  idle: [
    'Ask carefully.',
    'Peter is here.',
    'The channel is open.',
    'Peter waits.',
    'Say it plainly.',
  ],
  attentive: [
    'Peter is paying attention.',
    'Go on.',
    'Peter is reading.',
  ],
  processing: [
    'Peter is listening…',
    'Something is forming.',
    'Consulting the oracle…',
  ],
  answering: ['Peter has answered.'],
  refusing: ['Peter turns away.', 'The channel closed.'],
  paused: ['Peter is unavailable.'],
};

/** Fake analysis steps, shown one at a time before the reveal. */
export const SEQUENCE_STEPS = [
  { key: 'received',  label: 'Petition received',    weight: 0.10 },
  { key: 'listening', label: 'Peter is listening',   weight: 0.22 },
  { key: 'identify',  label: 'Identifying question', weight: 0.16 },
  { key: 'context',   label: 'Analysing context',    weight: 0.20 },
  { key: 'consult',   label: 'Consulting the oracle',weight: 0.22 },
  { key: 'ready',     label: 'Answer ready',         weight: 0.10 },
];

/** Status indicator vocabulary. */
export const STATUS_TEXT = {
  connected:  'Connection: Stable',
  listening:  'Connection: Listening',
  processing: 'Connection: Processing',
  answering:  'Connection: Answering',
  offline:    'Connection: Offline',
};

/** Default operator settings — every one of these is live-editable. */
export const OPERATOR_DEFAULTS = {
  target: '',
  secretAnswer: '',
  personality: 'calm',
  responseType: 'normal',       // normal | refusal | yes | no
  delay: 3.7,                   // seconds, base
  delayJitter: 1.6,             // +/- seconds of natural variation
  autoRespond: true,            // false = operator must press SEND ANSWER
  sessionMemory: true,
  voice: false,
  ambient: false,
  glitch: 0.35,                 // 0 - 1
  animation: 1.0,               // 0 - 1.5
  refusalChance: 0.06,          // odds of a spontaneous refusal
  trigger: DEFAULT_TRIGGER,
  petitionText: DEFAULT_PETITION,
  strictPetition: false,
  paused: false,
  shortcut: 'ctrl+shift+p',

  /* --- PETER's intelligent layer (operator-facing only) --- */
  model: '',               // '' = let the backend choose; otherwise a pinned model
  aiValidation: true,      // check operator input before it is used
  aiAutoCorrect: true,     // apply high-confidence corrections silently
  aiPresentation: true,    // let PETER word the answer he has already decided
};

/** Public preferences (audience-facing toggles). */
export const PREF_DEFAULTS = {
  mode: 'general',
  voice: false,
  ambient: false,
  reducedMotion: false,
  typewriter: true,
  sequence: true,
};
