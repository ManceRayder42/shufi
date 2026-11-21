---
name: shufi-setup
description: Launch the local setup page to configure the Shufi memory hub
allowed-tools:
  - Bash(sh:*)
---

Launch the Shufi setup server and hand the user its URL.

If the user would rather not click through a page ("just do it", "set it up
for me"), use the `setup-for-me` skill instead: it runs the same steps from
the terminal via `setup/agent.mjs`.

## Task

1. Run:
   ```
   sh "${CLAUDE_PLUGIN_ROOT}/bin/shufi-node" "${CLAUDE_PLUGIN_ROOT}/setup/server.mjs"
   ```
   `bin/shufi-node` uses the Node.js on the computer or the private copy that
   `shufi start` installs, so nothing has to be installed first.
2. The server binds `127.0.0.1` on an OS-assigned port, mints a one-time
   token, and prints a single `http://127.0.0.1:<port>/?t=<token>` URL to
   stdout before it starts listening. Read that URL from the command output.
3. Tell the user to open the URL in their browser. Do not try to open it for
   them or fetch it yourself — it's a page they interact with directly (hub
   path, feature toggles).
4. The server is self-managing: it heartbeats with the open tab, exits on its
   own once the tab closes or after 10 minutes idle, and is a child of this
   terminal session. Nothing else to start, stop, or clean up.
5. If the command fails to start (port bind error, etc.), show the actual
   error to the user rather than guessing at a fix. If it says Shufi found no
   Node.js, tell them to run `shufi start` in a terminal (the one-line
   installer is in the README); it installs everything that is missing.

Do not run this server in the background and move on — its whole job is a
short-lived interactive setup, so wait for the user to confirm they've
finished (or tell you to cancel) before continuing with anything else.
