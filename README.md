# Unpopular Opinion

A party game for friends, played from everyone's phone in the browser (no app to install).

1. Someone taps **Create a room** and shows the QR code / 4-letter code.
2. Everyone joins, then secretly writes as many unpopular opinions as they want.
3. The host starts. One opinion is drawn at random, you discuss, everyone votes on their phone.
4. Right guess: the author is revealed. Wrong guess: the author stays hidden forever.
5. Points: +1 for voting for the real author, +2 to an author whose opinion survives
   (points from hidden opinions are only revealed in the final scores).

Interface in English, French and Arabic.

## How it's built

- Static site (`index.html`, `app.js`, `styles.css`, `i18n.js`) hosted on GitHub Pages.
- Live rooms run on Supabase (project `unpopular-opinion`). All game logic and the secret
  "who wrote what" live in a private `game` schema; the site only talks to it through
  token-checked database functions, so nobody can peek at authors from the browser.
- `.github/workflows/keepalive.yml` pings the backend every 3 days so the free
  Supabase project never goes to sleep.

Testing tip: add `?slot=2` (or any word) to the URL to play as a separate player in another tab.
