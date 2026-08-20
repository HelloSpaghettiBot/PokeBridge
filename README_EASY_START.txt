TCP BRIDGE LAB - EASY WINDOWS START
===================================

1. Extract the entire ZIP to a normal folder.
2. Double-click START_BOT.bat.
3. The launcher will:
   - verify Node.js 22 or newer;
   - locate a full JDK 17 or newer;
   - find the running PokeMMO client, or start it from the standard install folder;
   - pass the correct process ID and JDK folder into the control panel;
   - open the Training & Hunt Bot GUI.
4. Select the activity in the GUI and click START.

REQUIREMENTS
------------
- Windows 10 or Windows 11
- Node.js 22 or newer
- A full JDK 17 or newer; JDK 21 is recommended
- PokeMMO installed, normally at C:\Program Files\PokeMMO\PokeMMO.exe

You do not need to run npm install. This project has no npm dependencies.

TROUBLESHOOTING
---------------
"Node.js 22 or newer is required"
Install a current Node.js LTS release, close the launcher, and run START_BOT.bat again.

"A full JDK 17 or newer is required"
Install a full Temurin/OpenJDK JDK, not only a Java Runtime Environment. JDK 21 is recommended.

"PokeMMO.exe was not found"
Start PokeMMO manually and leave it open, then run START_BOT.bat again.

"Could not attach ... agent"
Make sure the game and START_BOT.bat are running under the same Windows user. Do not run only one of them as Administrator. Check the captures folder for the related agent log.

Use this tooling only with systems and accounts you own or are authorized to test. Game automation may violate a game's rules or terms.
