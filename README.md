# Möbius Worlds

People from different Möbius instances meet in the **Worlds Lobby**, a 3D
night-time island built in Game Studio (game `g-qovj6o`), and hang out there together.

- **Lobby screen**: start a session, join with an invite (`@handle/ABCDE`,
  using the host's Möbius ID), and see open sessions from friends you've added by
  @ID. Dress your ghost: colour, face, hat, neck and a held item, including
  Möbius merch.
- **The Worlds Lobby**: walk your ghost with the stick, arrows or WASD, and
  press Space to jump. Everyone else in the session walks there too, with their name above
  them. Chat and emotes pop up as speech bubbles. The scene is exactly as made
  in the studio: the Möbius crystal, the Chat Café, the App Store stand, the
  lighthouse, the bridge to the party island with its dance floor and dancing
  hologram ghosts, and the DJ set, where you tap to open the beat machine.
- **App Store stand**: tap it, or walk up to it, to open a card of apps from the
  Möbius App Store, by shelf. An app you already have opens straight away; any
  other one opens on its App Store page, where you can install it. Their icons
  float in a ring above the stand. `python3 tools/bundle_store.py` refreshes the
  apps (`store_featured.js`) from the Store's catalog.
- **Kart Stand**: tap it, or walk up to it, to open Möbius Kart. Anyone in the
  session can join the race lobby until someone presses Start. Each racer drives
  their own copy (made in Game Studio) and sees the others live. Finishing times
  land on a shared best-times board.

## How the lobby gets here

`python3 tools/bundle_lobby.py [studio-app-id] [game-id]` copies the scene's
game file into `lobby_game.js` and every model it places into `lobby/models/`,
which ship as packaged assets (served at `/app-assets/by-id/<app>/models/…`), and
keeps `static_assets` in `mobius.json` in step. Publishing the lobby from Game
Studio (`publish_game.py 12 g-qovj6o`, which remembers it goes into Worlds)
runs this tool and applies the app.

`ui/LobbyWorld.jsx` runs the scene in a sandboxed frame with Game Studio's
runtime (`kart_runtime.js`) and adds, at run time only:

1. a player object, your ghost, which the scene runtime walks and follows with
   its camera as in the studio's Play mode;
2. the `worlds-bridge` scene script (`lobby_bridge.js`), which dresses your
   ghost, reports its position (`move {x, y, z, r}`), draws the other players
   from each snapshot, shows bubbles, and says when you are near the Kart Stand.

The Kart Stand's `launch: mobius-kart` tap arrives as `studio:open-game`.
`python3 tools/bundle_kart.py` refreshes Möbius Kart (`kart_game.js`).

## Sessions

A session lives on the Möbius of whoever started it (`service.py`, `rooms.py`,
`world.py`). Guests on other instances are relayed through their own Worlds
service to the host's public door (`/api/app-services/mobius-worlds/public/`).
The host keeps who is where (each player's own game keeps them on the ground)
and the Kart race, and sets each guest's sync pace to stay inside the public
request budget. `identity.py` resolves Möbius ID handles through the platform
identity bridge (read-only). Without a Möbius account, plain addresses
(`host.example/ABCDE`) still work.

Ghost models are built with Game Studio's shape tools (`tools/build_models.py`)
and bundled in `models_ghosts.js`.

Tests: `APP_STORAGE_DIR=$(mktemp -d) python3 test_worlds.py`. End-to-end:
`tools/guest_bot.py <host-origin> <minutes>` (a guest walking the lobby) and
`tools/race_bot.py` (a racer).

## Camera, collisions and fireworks

`lobby_bridge.js` steers a Second Life style chase camera (close behind your ghost,
drag to look round). `ui/LobbyWorld.jsx` makes three small, exact edits to the
studio's game code so the bridge can hook in: the camera controls, a collision
step (benches, street lamps, the bridge rails and a fence round the crystal push you
back out) and the fireworks. When the DJ set's fireworks go off, the camera pulls back
and tilts up at the sky for everyone on the party island; the show is shared as the
`fireworks` emote. If the studio's code changes shape, an edit is skipped with a
console warning and the lobby still runs.
