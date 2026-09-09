# GrokUsage

A small [Cinnamon](https://github.com/linuxmint/Cinnamon) desklet for Linux Mint that shows SuperGrok **weekly usage** and the **reset time**.

![GrokUsage](screenshot.png)

It uses the same figure as `/usage` in the Grok TUI.

## Requirements

Install and sign in to **Grok CLI** first. The desklet does not have its own login.

```bash
grok login
```

That writes a session to `~/.grok/auth.json`. Without it, the desklet cannot read usage.

## How it gets usage

On each refresh (every 5 minutes, or when you click the desklet) it:

1. Reads the current Grok CLI session from `~/.grok/auth.json`
2. Calls the same billing endpoint the Grok TUI uses for `/usage`:
   `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`
3. Displays weekly used percent and the period end time

No API key, cookie, or extra account setup is required beyond a normal `grok login`.

## Session lifetime

The desklet **reuses** the Grok CLI session. It does not refresh tokens on its own.

While Grok is running, the CLI keeps `auth.json` current and the desklet keeps working. Access tokens last a few hours. If Grok has not been running, the session can expire and the desklet will show **Token expired**. Open Grok, or run `grok login` again, and click the desklet to reload.

## Install

Cinnamon loads desklets from `~/.local/share/cinnamon/desklets/`. The folder name must match the UUID `grok-weekly@greyster1`.

```bash
mkdir -p ~/.local/share/cinnamon/desklets
git clone https://github.com/greyster1/GrokUsage.git ~/.local/share/cinnamon/desklets/grok-weekly@greyster1
```

Then open **System Settings → Desklets → Installed** and enable **Grok Weekly**.

Desklets sit on the wallpaper, behind open windows. Use show-desktop (`Super+D`) if you cannot see it, then drag it where you want.

## License

[GPL-3.0-or-later](LICENSE)
