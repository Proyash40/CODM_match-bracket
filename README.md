# MECHTRONICA CODM // Tactical Command

A zero-dependency, client-side tournament management dashboard designed specifically for Call of Duty Mobile esports events. Built with a militaristic, tactical HUD aesthetic, this tool allows tournament coordinators to manage squad rosters, generate knockout brackets, and track round-robin standings entirely within the browser.

##  Features

*    **War Room (Live Telemetry):** A broadcast-ready dashboard featuring a flashing Lobby Alert banner (Room ID, Password, and a 2-minute join countdown timer) and a live squad status lookup tool.
*    **Squad Roster & Seeding:** Manage up to 64 squads. Bulk-import squad names, edit in place, and arrange tournament seeding.
*    **Top 8 Tactical Bracket:** A fully interactive, single-elimination bracket tree. Click a squad's dossier card to advance them through the Quarter-Finals, Semi-Finals, and Grand Finals with dynamic, glowing connector lines.
*    **Round-Robin Matrix:** Automatically schedules matchday fixtures for odd or even squad counts. Input live scores to instantly recalculate points (2 for a win, 0 for a loss) and update the standings table.

##  Tech Stack & Architecture

This project is built for absolute simplicity and maximum deployment speed. 

*   **Zero Build Steps:** Pure HTML5, CSS3, and Vanilla ES6 JavaScript. No Node.js, no NPM, no bundlers, and no heavy frameworks (React/Vue).
*   **State Management:** All data (rosters, match results, lobby timers) is saved instantly to the browser's `localStorage`. You can refresh, close the tab, or lose internet connection without losing tournament progress.
*   **Modular Architecture:**
    *   `app.js`: Global state machine and tab navigation.
    *   `teams.js`: Roster logic and bulk deployment.
    *   `bracket.js`: Power-of-two slot calculations and tree rendering.
    *   `league.js`: Circle-method fixture scheduling and standings math.

##  Deployment (GitHub Pages)

Because this is a completely static, client-side web application, it can be hosted for free on GitHub Pages in under two minutes.

1. Create a new repository on GitHub and upload all 6 project files directly to the root folder (`index.html`, `styles.css`, `app.js`, `teams.js`, `bracket.js`, `league.js`).
2. Navigate to your repository **Settings**.
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment > Source**, select **Deploy from a branch**.
5. Select the `main` (or `master`) branch and set the folder to `/(root)`.
6. Click **Save**. 

Your tactical command deck will be live at `https://<your-username>.github.io/<repository-name>/` within 1-2 minutes.

##  Note on Local Storage & Sharing
Because tournament data is saved to `localStorage`, the data exists securely on **the coordinator's device**. If you share the GitHub Pages link with participants, they will load an empty, fresh instance of the dashboard. To share live updates with players, take screenshots of the War Room, Bracket, or Standings tabs and drop them into your captain communication channels.
