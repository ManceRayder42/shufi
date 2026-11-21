# Shufi: onboarding steps for an AI agent

You are an AI agent (Claude Code or similar) on the user's own computer. The user asked you to set up
Shufi, a memory that follows them into every Claude Code session. Do the steps below in order, with your
Bash tool. They take 2 to 5 minutes, mostly downloading. The user does not need to know what Node.js is
and must not have to install anything.

Rules for the whole job:

- No `sudo`. Do not install anything with Homebrew, nvm or a package manager. The launcher installs
  what is missing, and only inside `~/.shufi` and `~/.local/bin`.
- Do not ask the user to paste a key, token or password into the chat.
- If a step fails, stop, show the exact error line to the user in plain words, and do not improvise a
  workaround. A message that says `CHECKSUM MISMATCH` means a download was refused on purpose: do not retry
  it from another source and do not skip the check.
- Use the absolute path `~/.local/bin/shufi` below. The shell you are in has not re-read the user's shell
  startup file yet, so plain `shufi` may not be found.

## Steps

1. **Check the system.** Run `uname -sm`. macOS (`Darwin`) and Linux work. On anything else, stop and tell the user
   (Windows users can use WSL).

2. **Install the launcher.** This only copies a small script to `~/.local/bin` and, if needed, adds one
   `PATH` line to the user's shell startup file. It starts nothing.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/ManceRayder42/shufi/master/install.sh | SHUFI_NO_START=1 sh
   ```

   Expected: the output ends with `Next: ~/.local/bin/shufi start` (with the real home path). Note which
   shell startup file it says it changed, for step 6.

3. **Install what is missing and open the setup screen.** Run it in the background, or with a long timeout
   (300000 ms): the first run downloads Node.js (about 60 MB) only if the computer has none, then installs
   the Shufi plugin. The `--background` flag makes it return as soon as the setup screen is up, while the
   screen itself stays open until the user closes the browser tab.

   ```bash
   ~/.local/bin/shufi start --background
   ```

   On success the last lines look like this. Keep both values for step 4:

   ```
   Setup screen: http://127.0.0.1:53271/?t=<token>
   Server pid: 35299 (it closes itself when the tab is closed; log: ~/.shufi/setup.log)
   Plugin root: /Users/<user>/.claude/plugins/cache/shufi/shufi/<version>
   ```

   The setup server opens the user's browser by itself. If the exit code is not 0:

   | Exit | Meaning | What to do |
   |---|---|---|
   | 3 | Claude Code is installed but not signed in | Do not try to sign in for them. Tell the user: open a terminal, run `claude`, sign in, close it, then tell you to continue. Then repeat step 3. (If you are running inside Claude Code the user is already signed in; then report that the `claude` in the shell sees a different account or config.) |
   | 4 | Node.js could not be downloaded or verified | If the message says `CHECKSUM MISMATCH`, stop and report it. Otherwise it is usually the network: retry once, then report. |
   | 5 | Claude Code could not be installed | Show the error; the manual steps are at https://claude.com/claude-code. |
   | 6 | The plugin could not be installed or the setup server did not start | Show the error and the log path it names. |
   | 1, 2 | Other failure or bad usage | Show the error. |

4. **Verify. All three checks must pass.**

   a. The setup page answers. Use the `Setup screen:` URL from step 3 (quote it):

      ```bash
      curl -s -o /dev/null -w '%{http_code}\n' '<Setup screen URL>'
      ```

      Expected: `200`.

   b. The doctor is clean:

      ```bash
      ~/.local/bin/shufi doctor
      ```

      Expected: lines for `node`, `claude`, `login` (`signed in`), `plugin` and `hook` (`ok: session-start through the shim, exit 0`), then `all good`.

   c. A hook runs through the Node.js resolver the way Claude Code will run it. Use the `Plugin root:` value from step 3:

      ```bash
      echo '{}' | sh "<Plugin root>/bin/shufi-node" --hook "<Plugin root>/hooks/session-start.mjs"; echo "exit=$?"
      ```

      Expected: `exit=0`, and a line that starts with `[shufi]` (or the user's memory, if it was already set up).

5. **Hand the screen to the user.** The setup page is already open in their browser. If it did not open
   (for example over SSH), give them the `Setup screen:` URL. Tell them to click through it. Hooks and skills
   load when Claude Code starts, so the user must restart Claude Code afterwards (`/exit`, then `claude`).

6. **Report back in plain words, in the user's language** (the language of their last message), in a few short sentences,
   without jargon, logs or file paths unless they ask. Say:
   - what is now installed: the `shufi` command, the Shufi plugin and, only if the computer had no Node.js, a
     private copy of it that Shufi keeps to itself;
   - what they do next: finish the page that opened in the browser, then restart Claude Code, and say
     "done" at the end of every work session so it gets remembered;
   - how to open the page again (`shufi start` in a terminal; a new terminal window may be needed first if
     step 2 changed a startup file) and how to undo (`shufi uninstall-runtime` removes the private Node.js;
     `claude plugin uninstall shufi` removes the plugin);
   - anything that failed, in one sentence, with the one thing they can do about it.

## Already installed?

If `~/.local/bin/shufi` exists, skip step 2 and run `~/.local/bin/shufi update`, then `~/.local/bin/shufi doctor`.
