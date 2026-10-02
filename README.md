# Wildlands

A painted, anime-style free-roam game in the browser (three.js): the **Wildlands** lake valley and the town of **Sakuragawa 桜川**.

## Install on Windows (recommended)

1. Download **`Install-Wildlands.bat`** and double-click it.
2. Choose an install folder (default `%LOCALAPPDATA%\Wildlands`).
3. The repository is private, so the first run asks for a GitHub token:
   create one at <https://github.com/settings/personal-access-tokens/new> with
   *Repository access → Only select repositories → chnwax/Wildlands* and *Permissions → Contents → Read-only*.
   It is stored encrypted for your Windows account only.
4. The game files are downloaded and a **Wildlands** shortcut is added to the Desktop and Start Menu.

**Play:** the *Wildlands* shortcut (or `Play-Wildlands.bat`). It checks GitHub for updates, then starts a small
built-in web server on `http://localhost:8765` and opens the game in your browser. No Python needed.

**Update:** accept the update prompt when you start the game, or run *Start Menu → Wildlands → Update Wildlands*
(`Install-Wildlands.bat` in the install folder). Updates are incremental: only files that changed on GitHub are
downloaded, and files that were removed from the repository are removed locally.

Options: `Install-Wildlands.bat -Branch <name>` follows a specific branch (default: the newest of `main` and the
development branch), `-ResetToken` forgets the saved token, `Play-Wildlands.bat -NoUpdate` skips the update check.

## Run from a copy of the repository

`Start.bat` (needs Python) serves the folder on `http://localhost:8765`; any static web server works
(`python -m http.server 8765`). Browsers cannot run the game from `file://` because it uses ES modules.

## Controls

WASD to move, mouse to look, Shift to run, Space to jump, C to crouch, F to fly, `[` / `]` to change the time of day,
T to pause time, H to hide the HUD, M to mute, 1–5 for quality presets (low, medium, high, ultra, extreme — Extreme is for high-end PCs: 8k shadows, supersampling and the densest grass and far forests).

## World editor

Double-click `Editor.bat` (or run `npm run editor`; needs Node.js 18+). It starts a small local server and opens the
editor at `http://localhost:5180/editor.html?map=town` (`?map=nature` for the lake valley). Changes are saved to
`world/<map>/edits/` and the game loads them (the game also runs on that server: `http://localhost:5180/?map=town`).
Press `?` in the editor for every shortcut. The world files are described in [WORLD_FORMAT.md](WORLD_FORMAT.md).
