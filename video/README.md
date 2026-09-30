# The passenger videos

The scripts that make the three Sunday Bus doodle videos for passengers:
photographs of the real passenger page, the animation, and a check that holds
the words to the code. One command turns this folder into three MP4s.

1. **Put it on your phone** (about 1:30): the WhatsApp link, Add to your
   phone on Android and iPhone, opening it from the home screen, turning
   alerts on.
2. **Book your seat** (about 1:20): route, stop, phone number, how many,
   booked, Not coming, the 09:30 cutoff, and the booking reminders.
3. **Sunday morning** (about 1:50): every message and every state of the page
   from the 7:30 message to Picked up, then next Sunday opening and the
   Sunday afternoon reminder.

Captions only, no voice. Portrait, 1080 x 1920, each under 5 MB, so they send
on WhatsApp as they are.

**Nothing from the spreadsheet is needed or kept here.** The stops come from
`tests/browser/real.json`, which is already in the repository; the other
passengers' seat counts are invented, and the phone number typed in is
07700 900123, from the range Ofcom keeps for examples. The photographs, the
fetched fonts and the videos go in `video/build/`, which git ignores. The
finished MP4s are not committed: they are made, like the manual's PDF.

## What it needs

- Node 22 and Chromium with `playwright-core`, as for `tests/browser`.
- npm, to fetch rough.js and the two typefaces (Patrick Hand, Barlow) the
  first time.
- Python 3, for the word check, and to fetch an ffmpeg from PyPI the first
  time if this machine has none with H.264.

## Making it

1. `video/build.sh preview`. About two minutes: the word check, the
   photographs, and a still of every scene, fully drawn, in
   `video/build/preview/` (`clip1-01.png` and so on). Look at those first.
2. `video/build.sh`. The same, then the three videos, about eight minutes
   more, into `video/build/out/`.

To remake only one: `video/build.sh 3`. If only captions or timing changed,
`NOSHOTS=1` keeps last time's photographs.

## The files

| File | What it does |
|---|---|
| `build.sh` | Runs everything below, in order, after fetching rough.js, the fonts and ffmpeg once. |
| `check_words.py` | Holds every blue phrase to `sunday/index.html` and every notification to `server/worker.js`. Must end `unexplained after the hand-read list: 0`. |
| `shots.mjs` | The passenger page at each stage, one scene each, on the real page with a stand-in for the live server. Records where every ringed button is (`build/shots/marks.json`). |
| `clips.js` | The three videos, scene by scene: every caption, every notification, every ring and close-up. **This is the file to edit.** |
| `engine.js` | The drawing: rough.js shapes drawn stroke by stroke, handwriting that writes itself, the pencil, phones, rings, close-ups and notification cards. |
| `stage.html` | The 540 x 960 page the videos are drawn on. |
| `render.mjs` | Photographs the stage frame by frame and hands the frames to ffmpeg. Stops on a page error or a caption line running off the edge. |

## Editing

- **A caption.** In `clips.js`, `cap([...])` takes the lines as they will be
  written, one string each; the stage fits about 30 characters a line at the
  usual size. `**Words in stars**` come out blue and must be what the page
  says, or the word check fails. `video/build.sh preview` shows the result.
- **Timing.** A scene lasts as long as its drawing and writing, then holds for
  reading: about one second for every 17 characters on it, or
  `a.hold(seconds)` to set it.
- **A new screen.** Add a scene to `shots.mjs` that gets the page into that
  state and names the things to ring (`marks`), then a scene in `clips.js`
  that shows it with `phone("name")`, `a.ringOn(...)` and `a.zoom(...)`.
- **When the app changes,** run `video/build.sh preview` and look at every
  still. The word check catches wording the page or server no longer uses;
  it cannot catch a behaviour that changed, so read the table below against
  what changed.
- **When the timetable changes,** `shots.mjs` stops and says which stop
  differs from the example (North, Fountains Road by Stanley Close, 10:36,
  leaving church at 10:05). Change `EXPECT` and the trips there, and the
  stop names and times in the notifications in `clips.js`.

## What the videos say, and where it comes from

The times are the ones set in `config.js` and the server at app v1.87.0,
server w2.27.0. If one of these changes, change the video.

| The video says | Where |
|---|---|
| Add to your phone is at the foot of the page | `sunday/index.html`, `idInstall`. The page also offers it by itself on a first visit, but that offer and the alerts question race each other on timers (600 and 500 ms), so the video teaches the link, which is always there. |
| iPhone alerts only work once it is on the Home Screen | `sunday/index.html`, `pushCanAsk` and the note in the install steps. |
| Book, change or cancel until Sunday 09:30; Not coming still works after | `BOOKING_CUTOFF_*` in `server/worker.js`; the page's cancel box after the cutoff. |
| Reminders Sunday 3–4pm and Wednesday 6–7pm if not booked; Saturday 6–7pm "Last chance", or "You are booked" if booked | `booking.windows` in `config.js`; `wakeBookingReminders` and `seatWords` in `server/worker.js`. |
| 7:30 to 8:30 on Sunday: "Your bus today at ..." | `wakeMorning`, and `passenger.morningMessage` in `config.js`. |
| When the bus leaves church: "Be at your stop in about ..." | `wakeDeparture`; a route with a departure time has an estimate from the moment it leaves. |
| 5 minutes after it was due, if it has not left: "No word yet ..." | `wakeNotLeft`. |
| A new time as it picks up before you; always after the last pick-up before yours | `wakeAfterTap`, and `passenger.resendMinutes` in `config.js`. |
| The page turns red a minute or two away | `TRIP_IMMINENT_MINUTES`; the page's `paintLive`. |
| A bus called off is told within minutes, any day | `offWords`, sent by `wakeCancelled` on the five-minute sweep. |
| Next Sunday opens when the buses have finished, by 12 noon at the latest | `runComplete` and `RUN_BACKSTOP_HOUR` in `server/worker.js`. |
