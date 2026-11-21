<p align="center">
  <img src="assets/shufi.jpg" alt="Shufi, the felt owl" width="200">
</p>

<h1 align="center">Shufi</h1>

<p align="center">
  <b>Claude Code forgets you between conversations. This fixes that.</b><br>
  A memory that follows you into any project, plus skills that keep it up to date on their own.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="21 skills" src="https://img.shields.io/badge/skills-21-blue.svg">
  <img alt="API keys required: 0" src="https://img.shields.io/badge/API%20keys%20required-0-brightgreen.svg">
  <img alt="Telemetry: none" src="https://img.shields.io/badge/telemetry-none-lightgrey.svg">
  <a href="https://github.com/ManceRayder42/shufi/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/ManceRayder42/shufi?style=flat"></a>
</p>

> **Upgrading from the plugin's old id?** The three commands are in [CHANGELOG.md](CHANGELOG.md) under Unreleased.
> Your existing memory folder and config stay as they are; nothing to migrate.

## Quick start

No account, no API key, nothing to pay for, and no Node.js to install: Shufi brings its own
when the computer has none.

**The easy way: let Claude do it.** Paste this into any Claude Code session:

```
Set up Shufi for me: follow https://github.com/ManceRayder42/shufi/blob/master/docs/onboarding.md step by step.
```

**Or paste one line in a terminal** (macOS or Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/ManceRayder42/shufi/master/install.sh | sh
```

It puts a small `shufi` launcher in `~/.local/bin`, then runs `shufi start`, which installs
whatever is missing and opens the setup screen in your browser: Node.js (a private copy in
`~/.shufi`, checked against its published checksum, only if you have none), Claude Code (Anthropic's own
installer, only if missing) and the Shufi plugin. No sudo, no Homebrew. If Claude Code asks you
to sign in, run `claude` once, sign in, and run `shufi start` again. Run `shufi start` any time
to reopen the setup screen; `shufi doctor` checks that everything is in place.

When the page is done, restart Claude Code. Rather skip the page? Restart Claude Code and say
"set me up": Claude creates your memory folder, turns on the default skills and connects the free
tools. It asks once before installing any software, and leaves you only what needs a person: a key
or a sign-in.

**Already have Claude Code and Node.js, and prefer to install the plugin yourself?** Run:

```bash
claude plugin marketplace add ManceRayder42/shufi
claude plugin install shufi
```

One step on Claude Code 2.1.275 or later: `/plugin install shufi --marketplace ManceRayder42/shufi`.
Restart Claude Code and say "set me up", or type `/shufi-setup` for the checklist page. (Without
Node.js the hooks do nothing and tell you to run `shufi start`; they never break a session.)

<p align="center">
  <img src="assets/setup.png" alt="The /shufi-setup page: Shufi the owl on the left, the skills tree with a branch per topic on the right" width="760">
</p>

## Works with Claude Code, Codex and Cursor

Same memory folder, same skills, same tools. Claude Code is the full experience;
Codex and Cursor get the same three things through their own config files, with
the gaps listed in [details](docs/details.md#codex-and-cursor).

| | Install |
|---|---|
| **Claude Code** | the prompt or the one line above |
| **Codex CLI** | `shufi host codex`, then run `/hooks` once inside Codex and trust the hook |
| **Cursor** | `shufi host cursor`, then `shufi host cursor --print-user-rule` and paste the output into Customize > Rules (older builds: Cursor Settings > Rules > User Rules) |

`shufi` comes from the one-line install above. `shufi host` keeps its copy of Shufi in
`~/.shufi/app`, so it needs neither git nor Node.js. It backs up any file it edits and never
overwrites yours. Undo: `shufi host codex --uninstall` (or `cursor`).

## What you actually get

Claude Code normally starts every conversation from nothing — it doesn't
remember what you told it yesterday, or in a different project folder. This
plugin gives it a **memory** (technically a "hub": just one folder on your
computer, created for you during setup, that Claude reads at the start of
every conversation no matter which project you're in).

On top of that memory, it adds a set of **skills** — extra abilities Claude
picks up automatically when they're relevant. A few examples: closing out a
work session properly so nothing is forgotten, researching a topic with
citations, or turning a long explanation into a simple visual page instead of
a wall of text. [The full list](docs/details.md#the-full-skill-list) is in the details.

## It keeps your memory honest

A fact in memory (a path, a version, "this is broken") is true the day you write it, not forever.
Twice you get help without doing anything:

- **Stale facts are caught.** About once a day, at the start of a session, a quick check looks for
  paths that no longer exist, index lines that point nowhere and files the index forgot. If it finds
  something you see one line, and a report is written to `reports/` in your memory folder. Nothing
  is changed until you say "fix them". Clean memory means silence.
- **Corrections become rules.** Tell Claude "no, I said..." or "לא, אמרתי..." and it saves the rule
  to your memory right then and says so in one line. Say "undo" and it is gone. The same correction
  twice raises a counter on the same rule instead of making a second one.

Both are on by default, finish well under 200 ms, and never block a session. Switches and details:
[Memory hygiene](docs/details.md#memory-hygiene).

## One command builds the whole memory system

Say **"set up memory"** (or "תגדיר זיכרון") and Claude runs `memory-setup`. From an empty computer it
creates, and only what is missing: a short block in your `~/.claude/CLAUDE.md` that points at your
notes, a `knowledge/` folder (pack convention + index), a `raw/` inbox and a `wiki/` with an index,
the memory index with its rules, and it checks that the two hygiene hooks above are wired. It never
overwrites a file you wrote: in an existing `CLAUDE.md` it only touches its own marked block.
Run it again any time: it says "nothing to do". `--dry-run` shows the plan without writing.
Details: [Memory setup](docs/details.md#memory-setup).

## The one thing you have to remember

**Say "done" (or type `/done`) when you finish working.**

That's the only habit this asks of you. Memory loading and skills happen
automatically. Saying "done" tells Claude to
write down what happened and fold it into your memory's history, so your
*next* conversation actually knows about it.

Skip it, and nothing breaks — but nothing new gets remembered either, and you
won't see an error telling you so. That invisible failure is exactly why it's
worth turning into a habit. **If you take one thing from this page, take
this one.**

## What this is not

- **Not a copy of one person's personal setup.** Nothing here is tied to
  someone else's projects or preferences — you fill in your own memory as you
  use it.
- **Not a replacement for Claude Code's own project memory.** That's a
  different, narrower feature; the two work fine side by side.
- **Not going to tell you how to work.** A couple of routing/workflow
  defaults ship with a stated reason, never as "the one correct way."

## More

[How it works, the full skill list, optional skills, the phone assistant and licenses](docs/details.md).

### Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security
matters are in [SECURITY.md](SECURITY.md).

### License

MIT — see [LICENSE](LICENSE).
