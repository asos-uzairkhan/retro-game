# Data-Tech Among Us Retro

A sprint retrospective disguised as a cooperative, Among Us–inspired browser game. Instead of a shared doc with sticky-note columns, your team explores a spaceship map, unlocks rooms by answering retro questions, hunts for hidden clues, and ends by voting out the "imposter" — a real teammate picked at random, not told to anyone in advance (including the host).

If your team's retros have gone stale — low energy, the same three people talking, sticky notes nobody re-reads — this is a drop-in replacement for your usual retro format. No install for players: it's a link opened in a browser, playable on any device with a screen and a keyboard.

**Play here: [https://asos-uzairkhan.github.io/retro-game/](https://asos-uzairkhan.github.io/retro-game/)**

> New to the game? Read this file. Want the full mechanics/rules spec? See [Design.md](Design.md).

---

## Why switch to this?

| Your current retro | This game |
|---|---|
| One doc, everyone typing into the same columns | Everyone explores independently, then reflects together |
| Same one or two voices dominate | Anonymous self-hints + a "whodunit" hook keep everyone engaged |
| Sticky notes nobody revisits | Built-in Markdown export of the whole retro, ready to paste into your wiki |
| Feels like a chore | Feels like a 20–30 minute game, with the retro output as a side effect |

The **retro output is identical in substance** to a normal retro — what went well, what didn't, improvements, risks, learnings, teamwork, mood — it's just collected through gameplay instead of a bare form, and grouped by category automatically at the end.

---

## What you need

- The website: [https://asos-uzairkhan.github.io/retro-game/](https://asos-uzairkhan.github.io/retro-game/)
- A **browser** — desktop or tablet (this is not optimized for phones).
- Ideally a **call or shared room** during the reflection/voting phases, since those are discussion-driven.

Nothing to install. No accounts — the game signs you in anonymously the moment you open the page.

---

## Host guide

The host creates the game, shares the code, and drives the retro forward. The host also plays and votes like everyone else — nobody, including the host, is told who the imposter is.

### 1. Create the game

1. Open the game link and click **Create Game**.
2. Fill in the setup form:
   - **Your name** and a **colour**.
   - **Grid size** (5×5 for a quick retro, 7×7 for a normal one, 9×9 for a big team or a long session).
   - **Room type mix** — the percentage of the map given to each retro category (what went well, what didn't, improvements, risks, learnings, teamwork, mood, and general/open-floor rooms). Defaults are an even split; adjust if you want to emphasize a category.
   - **Minimum hints per player** (1–20) — how many self-facts everyone must write about themselves before joining. More hints = a longer, more solvable whodunit; 3–5 is a good default.
   - **Vote timer** (1, 2, 3, or 5 minutes) — how long the final vote stays open.
3. Just like every player, you'll be asked to write your own self-hints and accept them (see [Player guide → Before you join](#before-you-join-writing-your-hints)) before you land in the lobby.
4. You'll get a **6-character game code** — share it with your team (chat, call, whatever).

### 2. Run the lobby

- Players join with the code, a name, and a colour (see below).
- The player list updates live as people arrive.
- You can **kick** a duplicate/ghost entry, or **disband the lobby** entirely if you need to restart, while still in this phase.
- When ready — even solo, if you're testing — click **Start Game**. This is the moment the imposter is secretly chosen at random from everyone who didn't opt out of sharing hints.

### 3. Gameplay

- You play like everyone else: move around the map, answer questions to unlock rooms, look for clues.
- Watch the HUD for rooms solved and clues found — there's no rush, but keep an eye on team energy.
- Optional background music is available (play/pause, track picker, volume) if your team likes ambience.
- When the timebox is up (or the map is done), click **End Gameplay**. It's fine to end with rooms still unsolved.

### 4. Reflection

- The map freezes and everyone sees the same synced view: every solved room's question, answer, and who answered it, grouped by retro category.
- As host, click through rooms to set a shared **highlighted room** — everyone's screen follows your pointer, so you can drive the discussion out loud (a call or same-room setup helps here).
- Optionally, type a short **action** against any discussed item — it's recorded and shown in the final summary as a dedicated Actions section.
- When discussion is done, click **Start Voting**.

### 5. Voting

- All discovered clues are revealed to everyone as plain hint text — nobody is told whose hints they are.
- Everyone, including you, picks exactly one suspected imposter. The phase auto-advances once everyone's voted or the timer runs out.

### 6. Reveal & End

- Click **Reveal imposter** for the dramatic countdown and result banner.
- Click **End Game** when everyone's seen the reveal — this opens the read-only summary for everyone, including the **Copy summary as Markdown** button to paste your retro output into the team wiki.

### Other host powers

- **Leave the game** at any point after the lobby — host duties automatically transfer to another (preferably online) player, or the game is deleted if you're the last one there.
- Late arrivals can still join mid-game (any phase except after the game has ended) and rejoining from the same browser restores your identity if you got disconnected.

---

## Player guide

### Before you join: writing your hints

Before you land in the lobby, you write a few true facts about **yourself** (at least the host's configured minimum, up to 20 total, free text). These only matter if you turn out to be the imposter — in which case they become the game's clues, scattered one-per-room across the map for the team to find and reason about. Nobody sees your hints unless you're picked.

- Don't want to share anything personal? Click **opt out** — you write no hints and are guaranteed never to be picked as the imposter. You'll see a private reminder not to mention that you opted out, so you still look like a normal suspect to everyone else.
- Once you've entered your hints (or opted out), you get a review step to check them before accepting — go back and edit if needed.

### Joining

1. Open the game link, click **Join Game**, and enter the code your host shared.
2. Pick a display name (unique per game) and a colour (taken colours are disabled).
3. Write your hints as above, then you're in the lobby.

### Playing

- Click an **accessible** room (lit up, adjacent to a solved room or the start hub) to preview its question and category.
- **Accept** to lock in and answer (free text, 1–500 characters) — the first submitted answer solves the room for everyone. **Go Back** at any point before submitting to release the room for someone else.
- You can **ping up to 3 teammates** from a room's preview if you think they'd answer it better — it flags the tile with their colour, visible to everyone.
- Hover any accessible or solved room to preview its question in a tooltip (answers stay hidden until reflection).
- Only one player can occupy an unsolved room at a time — if someone beats you to it, just pick another room.
- Finding a clue shows a "You found a clue!" toast — the text stays secret until voting. You'll never know the total number of clues in the game, only how many your team has found so far.

### Reflection & voting

- During reflection, follow the host's shared highlight as the team discusses each answer out loud.
- At voting, read every revealed clue carefully, then cast your one vote for who you think the imposter is. You can't change it once submitted, and the phase moves on once everyone's voted or the timer runs out.

### Leaving / rejoining

- You can leave the lobby (before the game starts) or leave mid-game via the HUD button — either releases any room you're occupying.
- Disconnected or closed the tab? Reopen the link on the same browser and you'll resume your identity and location.

---

## Tips for a good session

- **3–5 minimum hints** works well for most team sizes — enough to make deduction possible without turning voting into a slog.
- **7×7 grid** suits most sprint teams (roughly 5–10 people) in a 20–30 minute session; go smaller for a quick check-in, bigger for a lengthier retro or a bigger team.
- Keep the team on a **call or in the same room** for reflection and voting — those phases are meant to be talked through, not read silently.
- Use the **Actions** field during reflection to capture concrete follow-ups as you go, rather than trying to remember them all at the end.
- Export the **Markdown summary** at the end and paste it straight into your usual retro-notes location — nothing about your existing retro *documentation* process has to change, only how you *run* the session.

---

## FAQ

**Is this secure enough for sensitive feedback?** It's designed for a friendly internal team game, not a security-sensitive product — see Design.md §13.2 for the accepted trust model (a player who opens dev tools could technically read hidden state early). Don't use it for anything beyond normal sprint-retro content.

**What if we don't finish all the rooms?** That's fine — the host ends gameplay whenever the timebox is up; unsolved rooms just don't contribute answers or clues.

**Can the host also be a suspect?** Yes, and always is — the host has no advance knowledge of who the imposter is and votes exactly like everyone else.
