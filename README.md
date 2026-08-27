# PETER

A dark, atmospheric interface where an entity appears to listen to a question,
consider it, and answer. Behind it sits a deterministic secret-answer mechanism
the performer controls, and — optionally — a locally hosted Ollama model that
proof-reads the performer's input and phrases the reply.

**This is an entertainment illusion.** PETER has no supernatural ability, no
prediction and no access to anyone's data. Nothing leaves the machine it runs
on: the browser talks only to a local backend, and that backend talks only to
a local Ollama.

---

## Running it

No build step, no framework, no npm dependencies — Node's standard library only.

```bash
cp .env.example .env      # optional; sensible defaults without it
node server/index.mjs     # → http://127.0.0.1:8080
PORT=3000 node server/index.mjs
```

The server does two jobs: it serves the site, and it is the only thing that
talks to Ollama. ES modules need a real HTTP origin, so opening `index.html`
off disk will not work.

### With Ollama

`ollama serve` is a **foreground process that never returns** — do not chain
anything after it. On Windows and macOS the installer already runs it in the
background, so you normally only need to pull a model:

```bash
ollama list               # if this works, the service is already up
ollama pull llama3.2      # any chat model works
npm start
```

Only if `ollama list` reports it cannot connect do you need to start it, in a
terminal of its own:

```bash
ollama serve              # leave this window open, then use another one
```

PowerShell 5.1 note: `&&` is not a statement separator there. Run the commands
on separate lines, or use `;`.

On start-up the server prints whether Ollama answered and which model it
chose. Nothing needs to be configured: if `OLLAMA_MODEL` is empty it discovers
the installed models and picks the first suitable one.

**Running the server inside WSL while Ollama runs on Windows?** WSL2 has its
own network namespace, so `127.0.0.1` inside WSL is not the Windows machine.
Point the backend at the Windows host instead:

```bash
export OLLAMA_URL="http://$(ip route show default | awk '{print $3}'):11434"
npm start
```

Ollama must also be listening on more than loopback for that to work — set
`OLLAMA_HOST=0.0.0.0` on the Windows side. The server detects this situation
and prints the address to try. Simplest alternative: run `npm start` from
PowerShell instead of WSL, and leave `OLLAMA_URL` at its default.

### Without Ollama

Start the server and use it. Everything works; the intelligent layer simply
reports `OFFLINE` in the operator console and steps aside. No visitor can tell
the difference.

---

## The mechanic (how the trick works)

The petition field is the trick, exactly as in the original.

1. The field behaves like an ordinary text input. Anyone typing normally just
   types normally — nothing about the illusion is visible.
2. The moment you type the **trigger character** (default `.`), the field is
   *armed*. The trigger itself is swallowed — nothing appears.
3. While armed, every keystroke is intercepted. Instead of the character you
   pressed, the **next character of the petition sentence** is written to the
   screen. To the audience it looks like you are simply typing
   *"Peter, please answer the following question:"*.
4. Meanwhile the characters you actually pressed are collected as the **secret
   answer**. Typing the trigger a **second time** ends the capture — after
   that, further keystrokes still spool out the petition, so you can finish
   the sentence by mashing any keys.
5. Backspace unwinds all of it symmetrically; backspacing to empty disarms.

### If you forget the closing trigger

This is the mechanism's one sharp edge. Miss the second `.` and capture stays
open, so every filler keystroke used to finish the sentence is appended to the
answer. The petition still looks perfect on screen, and PETER answers
*"Danielqqqqqqqqqqqq"*.

PETER now handles it:

- **Live cue.** While capture is open the hairline under the petition field
  runs amber instead of accent-coloured. Meaningless to an audience,
  unmistakable to you.
- **Local repair** (works with Ollama off). If capture was left open, a
  trailing run of four or more identical characters, or a short block repeated
  three or more times, is stripped. Answers with a properly closed capture are
  never touched, so `.Aaaa.` survives intact.
- **Intelligent repair.** When the filler is more varied than that, the raw
  capture is sent for a truncation-only check that runs *during* the analysis
  sequence, so it costs the performance nothing. The result must be a prefix
  of what you typed — the model can shorten, never invent.
- **Reported.** The console's live readout shows `left open · trimmed "qqqq…"`.

### Worked example

| You type | Screen shows | Hidden answer |
|---|---|---|
| `.` | *(nothing)* | *(armed)* |
| `Daniel` | `Peter,` | `Daniel` |
| `.` | `Peter,` | `Daniel` (capture closed) |
| `qqqqq…` | `Peter, please answer the following question:` | `Daniel` |

Then type the question and press **Ask Peter**. After the analysis sequence,
Peter answers `Daniel`, styled by the current response personality.

### Improvements over the original

None of these change the trick:

- Works on touch keyboards, not just desktop (`beforeinput` plus an
  input-diff reconciler for soft keyboards that fire non-cancelable events).
- If the field already contains a prefix of the petition when you arm it, the
  sentence continues from there instead of restarting.
- Paste is decomposed into individual characters.
- The trigger character and the petition sentence are both configurable.
- A **Secret answer** field in the operator console does the same job without
  typing live, for anyone who finds the keyboard method stressful.

The secret is single-use: after one question it is cleared, so the next
question falls through to a generated answer.

---

## Deploying

The site is static, so any static host works. Pushed to GitHub with Pages
enabled it lives at `https://<user>.github.io/<repo>/`.

**What works on a static host:** everything the audience sees — the petition
mechanic, all nine channels, session memory, the reveal, voice, ambient audio,
and the full operator console.

**What does not:** the Ollama layer. `server/` is a Node process and GitHub
Pages cannot run one. That is the correct outcome rather than a limitation:
Ollama is a local service and must never be exposed to the internet. The
console simply reports `NO BACKEND` and PETER runs on its own engine.

An ordinary visitor to a static deployment makes **zero** requests to the API —
the client only probes for a backend on localhost, a private network, or an
origin where one was found before. Nothing about the intelligent layer appears
in a visitor's network log or console.

To get the Ollama layer, run `npm start` locally. That is also where you would
perform from.

> The repository is public, so its source is readable — including
> `js/engine/petition.js`, which explains the trick in full. The method is
> widely documented anyway, but if you would rather it were not one click from
> the site, keep the repo private and deploy the built site separately.

---

## The intelligent layer

Ollama is an enhancement bolted to the side of the mechanism, never in the
path of it:

```
        operator input
              |
     [ 1 ] local normalise      always runs, no model needed
              |
     [ 2 ] the model            spelling / obvious typing mistakes
              |
     [ 3 ] guards               veto anything that changes meaning
              |
      normalised input
              |
      PETER's own engine        deterministic. decides the answer.
              |
     [ 4 ] wording (optional)   phrases an answer already decided
              |
        public answer
```

**The operator is always the authority.** The model may repair spelling,
spacing, duplicated words and punctuation. It may never change a name into a
different name, alter a number, reword meaning, or invent an answer. Anything
that would do so is discarded and the original stands.

### Architecture

```
browser  ──▶  node backend  ──▶  ollama (127.0.0.1:11434)
              /api/peter/status
              /api/peter/validate
              /api/peter/present
```

Ollama is never reachable from the browser and there is no passthrough proxy —
three narrow endpoints, each with its own body cap, rate limit and validation.
The Ollama URL, the prompts and the timeouts are never sent to the client.

### Confidence and when PETER asks

| Confidence | What happens |
|---|---|
| ≥ 95% | Corrected silently. The operator sees what changed. |
| 70–95% | **ACCEPT CORRECTION** / **KEEP ORIGINAL**. Nothing is applied until you choose. |
| < 70% | *"PETER couldn't confidently determine what you intended"* → **EDIT INPUT**. No guess is made. |

Names get extra care. `Stcy → Stacy` (no vowels — plainly mistyped) and
`Stacyy → Stacy` (a stutter) are applied. `Stacy → Stacey` and `Sara → Sarah`
are *not* — both originals are perfectly good names, so PETER asks.

### Punctuation is mechanism-aware

Two parts of the engine are punctuation-sensitive, so punctuation is not
normalised blindly:

1. **The trigger character** (default `.`) closes the hidden capture while the
   operator types live. A secret answer containing it is physically untypable,
   so PETER never adds one and warns you when your answer contains it.
2. **`isPhrase()` in `engine/answers.js`** treats a value ending in terminal
   punctuation as a finished statement and skips the phrase templates.
   `Daniel` becomes *"The answer is Daniel."*; `Daniel.` stays bare.

So a full sentence may gain a final full stop, and a short answer may not —
PETER strips one if you type it, and tells you why.

### Wording

Once the answer is decided, PETER may phrase it:

```
authoritative answer :  Daniel
public response      :  "There is one name that keeps returning. Daniel."
```

The authoritative answer must survive verbatim. The wording is checked twice —
once on the server, once in the browser — for a missing answer, an invented
name, an invented number, assistant boilerplate, or excessive length. Any
failure and the deterministic text is shown instead.

The request is fired the moment the answer is known, so it runs *underneath*
the analysis sequence rather than adding to it. If it has not returned by the
time the reveal is due, it is abandoned. **Model latency never changes the
pace of the performance.**

### When Ollama is not there

Ollama down, model missing, request timed out, HTTP error, malformed JSON,
prose instead of JSON, connection dropped mid-request — every one of these
falls back to the deterministic engine, and the local normaliser still fixes
spacing, duplicated words and punctuation. The operator sees the reason in the
console. The visitor sees nothing at all.

### Configuration

Everything lives in `.env` (see `.env.example`); real environment variables
win over the file. Nothing is hard-coded.

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Where Ollama listens. Never sent to the browser. |
| `OLLAMA_MODEL` | *(empty)* | Pin a model, or leave empty to auto-discover. |
| `OLLAMA_MODEL_PREFERENCE` | `llama3.2,llama3.1,…` | Order used when auto-discovering. |
| `PETER_VALIDATION` | `true` | Input checking on/off. |
| `PETER_PRESENTATION` | `true` | Response wording on/off. |
| `PETER_AUTO_APPLY_CONFIDENCE` | `0.95` | At or above this, corrections apply silently. |
| `PETER_CONFIRM_CONFIDENCE` | `0.70` | Below this, PETER asks rather than guessing. |
| `OLLAMA_VALIDATE_TIMEOUT` | `12000` | ms. |
| `OLLAMA_PRESENT_TIMEOUT` | `9000` | ms. |
| `PETER_LOG_TEXT` | `false` | Keep false: operator text is never logged. |

---

## Operator console

Hidden by default. Its DOM is not even built until it is first opened, so
nothing about it is discoverable in the page source of a running show.

**Ways in**

- `Ctrl` + `Shift` + `P` (configurable in the console's *System* tab)
- Tap the **connection status dot five times** — for phones and tablets
- `?op=1` or `#operator` on the URL
- The Konami code (`↑ ↑ ↓ ↓ ← → ← → B A`) with no field focused

**Tabs**

| Tab | Contents |
|---|---|
| **Answer** | Target, secret answer, PETER petition, **Check with PETER**, the correction panel, connection status, response style, response type, channel, delay + natural variation, automatic/manual response, live readout, and Send / Clear / Glitch / Refusal |
| **Mind** | Connection status, model picker, confidence meter, validation, auto-correction, response wording, and the rules PETER is held to |
| **Effects** | Voice, ambient sound, typewriter, analysis sequence, reduced motion, glitch intensity, Peter animation intensity, spontaneous-refusal odds, pause Peter |
| **System** | Petition sentence, trigger character, strict petition, session memory, reset session, clear all state, console shortcut, restore defaults |
| **Keys** | Every shortcut, a reminder of how the mechanic works, and the house rules |

**Manual mode** — turn *Automatic response* off and Peter will run the whole
analysis sequence and then keep thinking indefinitely until you press
**Send answer** (or `Ctrl`+`Enter`). Useful when you need to read the room
before committing.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl` `Shift` `P` | Open / close the operator console |
| `Esc` | Close the console, or stop Peter speaking |
| `Ctrl` `Enter` | Send the queued answer / release a held answer |
| `Ctrl` `Shift` `R` | Reset the session |
| `Ctrl` `Shift` `G` | Trigger a glitch |
| `Ctrl` `Shift` `X` | Trigger a refusal |
| `Ctrl` `Shift` `Z` | Pause / resume Peter |
| `Enter` | Ask (from the question box) |
| `Shift` `Enter` | Newline in the question box |

> Chrome reserves `Ctrl`+`Shift`+`R` for a hard reload in some builds. If it
> reloads instead of resetting, use the **Reset session** button in the
> console's *System* tab, or the **Clear** button on the history panel.

---

## Features

- **Nine channels** — General, Love, Future, Mind Reading, Spirit, Yes/No,
  Secrets, Tarot, Dark. Each re-tints the whole palette, changes Peter's
  greeting, and draws from its own answer bank and default personality.
- **Five personalities** — Direct, Calm, Mysterious, Cryptic, Dark. Templates
  that need a noun phrase are only applied to short answers, so you never get
  *"The answer is Because they decided…"*.
- **Session memory** — questions and answers persist in `sessionStorage` for
  the tab. Follow-ups work: ask *"Does Sarah like John?"*, then *"Why?"*, and
  Peter answers about Sarah.
- **Refusals** — occasional and configurable, plus a manual trigger.
- **Cinematic sequence** — six analysis steps with weighted, wobbled timing so
  no two consultations feel identical. Presentation only; nothing is analysed.
- **Reveal** — page dims, Peter focuses, the answer types itself out with a
  cadence that slows at punctuation.
- **Voice** — Web Speech, low and slow, chunked at punctuation so Peter
  breathes. Absent gracefully where unsupported.
- **Ambient audio** — fully synthesised with the Web Audio API (no files):
  a detuned drone, filtered pink noise, and short interface cues. The context
  is not created until you switch it on, so autoplay policies are never hit.
- **Easter eggs** — meta questions (*"how does this work?"*, *"who are you?"*,
  *"42"*), rare unexplained lines, a very rare "Peter is unavailable" state,
  a long-press whisper on Peter, and the console entry points above.
- **Accessibility** — skip link, full keyboard navigation, labelled controls,
  live regions on the status and answer, visible focus rings, and both an
  automatic (`prefers-reduced-motion`) and a manual reduced-motion mode that
  stops the particles, drift, glitches and typewriter.

---

## Privacy

- No third-party requests. No analytics, no cookies, no external fonts, scripts
  or images. The only network traffic is browser → local backend → local Ollama.
- The backend binds to `127.0.0.1` by default and blocks `/​.env`, `/server/`
  and path traversal.
- `localStorage` holds only interface preferences and operator settings.
- Operator text is sent to the local backend for checking and is never written
  to disk or to the log (`PETER_LOG_TEXT=false` by default).
- `sessionStorage` holds the current session transcript and dies with the tab.
- Both are wrapped so that private-browsing modes which throw on access fall
  back to in-memory storage instead of breaking the page.
- The operator console is a local UI mechanism, not a backdoor: it mutates
  local state only and has no server side.

---

## Architecture

```
index.html
css/
  tokens.css     design tokens + the nine channel palettes
  base.css       reset, typography, focus, utilities
  layout.css     atmosphere, shell, stage grid, responsive
  avatar.css     Peter and his states
  panels.css     glass panels, fields, answer, history, settings
  console.css    the operator console
  effects.css    keyframes, glitch, reduced motion
server/
  index.mjs      static files + the three /api/peter endpoints
  config.mjs     env loading; decides what the browser may see
  ollama.mjs     the only code that talks to Ollama
  validate.mjs   input checking + the punctuation policy
  present.mjs    response wording
  guards.mjs     meaning preservation + anti-hallucination
.env.example
js/
  services/peterAI.js      the browser's only link to the backend
  main.js                  orchestration
  core/      config, state, bus, storage, dom helpers
  engine/    petition (the trick), answers, oracle, session
  components/ PeterAvatar, StatusIndicator, ModeSelector,
              ProcessingSequence, AnswerDisplay, SessionHistory,
              SettingsPanel, OperatorConsole, Toasts
  audio/     AudioManager (procedural), VoiceManager
  fx/        ParticleBackground, glitch
  easterEggs.js
```

State lives in `core/state.js` and changes broadcast over `core/bus.js`, so
components stay decoupled. `window.__peter` is exposed for manual QA in the
browser console.

---

## House rules

Keep it harmless. Peter is a party trick:

- Don't claim he is real, psychic, or reading anyone's data.
- Don't put threats, harassment, or claims about someone's actual private
  information into the secret answer.
- Don't target people who haven't opted into being part of the show.
