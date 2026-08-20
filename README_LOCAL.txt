POKEBRIDGE — LOCAL WINDOWS BUILD
================================

Start
-----
1. Extract the complete PokeBridge folder.
2. Double-click PokeBridge.exe.
3. Log into a character in the official PokeMMO client.
4. Choose an activity and click START AUTOMATION.

No separate Node.js, Java JDK, .NET runtime, PowerShell script, process ID,
or command-line setup is required. Keep the runtime and app folders next to
PokeBridge.exe; they are part of the application.

Automation state and decisions come only from client memory and verified game
packets. The release does not contain screenshot matching, screen capture, or
fixed-coordinate mouse automation. If memory or packet calibration is not
available for the installed client revision, automation stops with an error.

Modes
-----
Training routes to recorded encounters in the chosen level range and battles.
Choose Auto for the lowest-level living party member to receive EXP, or select
a specific party slot.
Hunt routes to the selected species, weakens it, and uses a Poke Ball.
Shiny hunting trains normally but attempts to catch every shiny encounter.
Explore and map expands the verified walk graph and encounter database.
Kanto badge campaign keeps a resumable eight-gym plan, trains the party below
each obedience cap, maps unknown routes, and routes to learned city and gym
landmarks. Badge completion is accepted only from confirmed live progress; just
entering a gym or ending an ordinary trainer battle never fabricates a badge.

All modes defend mandatory trainer battles. If damaging PP is exhausted, the
bot flees wild encounters and routes to a verified Pokémon Center when one is
reachable. Catch mode can switch away from an overleveled lead before weakening
a target. Trainer battles compare live move and Pokémon types and switch when a
healthy party member has a materially better matchup. Runtime maps, encounter
data, status, and logs are stored under:

  %LOCALAPPDATA%\PokeBridge\data

The official PokeMMO client must be installed. If it is in a custom folder,
set POKEMMO_HOME to that folder or start the client before PokeBridge.
