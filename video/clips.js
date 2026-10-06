/* THE THREE CLIPS, scene by scene.

   A scene is a function that lays things out on a 540 x 960 stage and says
   how long each takes; see engine.js for the calls. It lasts as long as its
   drawing and writing, then holds long enough to read what it says (or for
   a.hold(seconds)).

   **Words in stars** are drawn in blue and are what the page or the phone
   actually says (or, once or twice, the one thing on screen to look for).
   The notifications (a.note) are the live server's own words. check_words.py
   holds both to sunday/index.html and server/worker.js.

   The example passenger is booked for 2 on North at Fountains Road by
   Stanley Close, timetabled 10:36; North leaves church at 10:05. Those names
   and times are written into the notifications below, and shots.mjs stops
   if the timetable no longer says them. */
(function () {
  const A = DOODLE, D = A.D;
  const CX = 30, CY = 96;
  const PH = { x: 135, y: 322, w: 270 };

  const head = (n, title) => A.label("Sunday Bus  ·  Part " + n + " of 3  ·  " + title, 270, 40, { size: 21 });
  const cap = (lines, o) => A.write(lines, CX, CY, Object.assign({ size: 34 }, o || {}));
  const phone = (name) => A.screen(name, PH.x, PH.y, PH.w);
  const when = (words) => A.write([words], CX, CY - 2, { size: 30, color: A.RED, read: true });

  /* A title card for each part. */
  function titleCard(n, words) {
    return (a) => {
      a.draw(D.road(20, 520, 790), 0.6, { pen: false });
      a.draw(D.church(360, 610, 1.05), 1.1);
      a.draw(D.bus(50, 680, 1.0), 1.2);
      a.write(["Sunday Bus"], 270, 190, { size: 72, anchor: "middle" });
      a.write(["Part " + n + " of 3"], 270, 262, { size: 32, anchor: "middle", color: a.SOFT });
      a.write([words], 270, 340, { size: 46, anchor: "middle", color: a.BLUE });
      a.draw(D.underline(110, 430, 358), 0.5, { pen: false });
      a.hold(1.6);
    };
  }
  /* The last card of a part: where to go next. */
  function nextCard(lines) {
    return (a) => {
      a.draw(D.tick(230, 250, 1.6), 0.6);
      a.write(lines, 270, 420, { size: 44, anchor: "middle", lh: 56 });
      a.draw(D.bus(170, 600, 1.0), 1.0);
      a.hold(2.2);
    };
  }
  /* A phone's lock screen, the notification on it, and the time it came. */
  function lock(clock, day) {
    A.draw(D.phone(70, 300, 400, 610), 0.8);
    A.label(clock, 270, 400, { size: 64, font: "Barlow", color: A.INK, weight: 300 });
    A.label(day, 270, 438, { size: 20, font: "Barlow", color: A.SOFT });
  }

  /* ======================================================================
     1. PUT IT ON YOUR PHONE
     ====================================================================== */
  A.clip("1", (scene) => {
    scene(titleCard(1, "Put it on your phone"));

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["Tap the Sunday Bus link", "sent on WhatsApp."]);
      a.draw(D.phone(100, 280, 340, 620), 0.8);
      a.draw(D.bubble(128, 380, 284, 170), 0.7, { pen: false });
      a.write(["Book your seat on", "the Sunday bus:"], 146, 420, { size: 26, read: false });
      a.write(["drolnstone.github.io/", "minibus-check/sunday/"], 146, 492, { size: 25, color: a.BLUE, read: false });
      a.draw(D.underline(146, 360, 499, a.BLUE), 0.3, { pen: false });
      a.draw(D.underline(146, 368, 529, a.BLUE), 0.3, { pen: false });
      a.draw(D.finger(372, 548), 0.6, { pen: false });
      a.hold(2.6);
    });

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["It opens in your browser.", "No app store. No password."]);
      phone("p-first");
      a.hold(3);
    });

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["To keep it, scroll to the", "bottom of the page and tap", "**Add to your phone**."]);
      const s = phone("p-foot");
      a.ringOn(s, "add", { pad: 4 });
      a.zoom(s, "foot", 40, 520, 460, { pad: 8, color: a.RED });
      a.hold(3.2);
    });

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["**Android:** tap **Install**.", "No Install button? Tap ⋮ at the", "top right, then **Install app**", "or **Add to Home screen**."], { size: 32 });
      const s = phone("p-install-android");
      a.ringOn(s, "go", { pad: 2 });
      a.ringOn(s, "menu", { pad: 2, color: a.BLUE });
      a.hold(3.4);
    });

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["**iPhone:** open the link in **Safari**.", "The page asks you to add it", "to your Home Screen.", "Tap **Show me how**."], { size: 32 });
      const s = phone("p-iphone-offer");
      a.ringOn(s, "go", { pad: 2 });
      a.hold(3);
    });

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["Tap **Share** (the square with", "an arrow), then **Add to Home**", "**Screen**, then **Add**."]);
      const s = phone("p-install-iphone");
      a.ringOn(s, "share", { pad: 2 });
      a.ringOn(s, "add", { pad: 2 });
      a.ringOn(s, "addBtn", { pad: 2 });
      a.hold(3.4);
    });

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["Now it is on your phone.", "Open **Sunday Bus** from your", "home screen, like any app."]);
      a.draw(D.phone(120, 300, 300, 600), 0.8);
      a.draw(D.homeGrid(140, 370, 260, [1, 1], 3), 1.0, { pen: false });
      const gap = 260 / 3, sz = gap * 0.62;
      const ix = 140 + gap + (gap - sz) / 2, iy = 370 + gap * 1.3;
      a.pic("../icon-sunday-180.png", ix, iy, sz, sz);
      a.label("Sunday Bus", ix + sz / 2, iy + sz + 18, { size: 17, font: "Barlow", color: a.INK });
      a.draw(D.ring(ix + sz / 2, iy + sz / 2 + 12, sz * 2.9, sz * 2.3), 0.6);
      a.hold(2.6);
    });

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["It asks **Turn on bus alerts?**", "Tap **Turn on**, then **Allow**."]);
      const s = phone("p-alerts-offer");
      a.ringOn(s, "go", { pad: 2 });
      a.hold(3);
    });

    scene((a) => {
      head(1, "Put it on your phone");
      cap(["With alerts on, your phone", "reminds you to book, and", "tells you when the bus is near."]);
      a.draw(D.bell(270, 450, 2.2), 1.4);
      a.write(["On an iPhone, alerts only work", "once Sunday Bus is on your", "Home Screen."], 270, 640, { size: 30, anchor: "middle", color: a.RED });
      a.hold(2.4);
    });

    scene(nextCard(["Next:", "book your seat"]));
  });

  /* ======================================================================
     2. BOOK YOUR SEAT
     ====================================================================== */
  A.clip("2", (scene) => {
    scene(titleCard(2, "Book your seat"));

    scene((a) => {
      head(2, "Book your seat");
      cap(["Pick your route: **North** or", "**South**. Each stop shows the", "time the bus is due there."]);
      const s = phone("p-stops");
      a.ringOn(s, "routes", { pad: 2 });
      a.zoom(s, "first", 40, 600, 460, { pad: 6 });
      a.hold(2.6);
    });

    scene((a) => {
      head(2, "Book your seat");
      cap(["Tap **your stop**."]);
      const s = phone("p-stops-mine");
      a.ringOn(s, "mine", { pad: 2 });
      a.zoom(s, "mine", 40, 690, 460, { pad: 6, color: a.RED });
      a.hold(2.6);
    });

    scene((a) => {
      head(2, "Book your seat");
      cap(["If it asks, type your", "**phone number**, then tap", "**Continue**."]);
      const s = phone("p-ask-typed");
      a.ringOn(s, "input", { pad: 2 });
      a.ringOn(s, "go", { pad: 2 });
      a.hold(2.8);
    });

    scene((a) => {
      head(2, "Book your seat");
      cap(["**How many of you?** Count", "yourself too. Tap **+** for each", "person, then **Confirm**."]);
      const s = phone("p-howmany-2");
      a.ringOn(s, "plus", { pad: 2 });
      a.ringOn(s, "save", { pad: 2 });
      a.hold(3);
    });

    scene((a) => {
      head(2, "Book your seat");
      cap(["Done! At the top it says", "**You are booked. 2 seats.**"]);
      const s = phone("p-booked");
      a.zoom(s, "booked", 40, 620, 460, { pad: 8, color: a.GREEN });
      a.draw(D.tick(440, 560, 1.2), 0.5);
      a.hold(2.6);
    });

    scene((a) => {
      head(2, "Book your seat");
      cap(["Plans changed? Tap **Not coming**,", "then **Yes, I am not coming**.", "That gives your seat back."], { size: 32 });
      const s = phone("p-notcoming");
      a.ringOn(s, "yes", { pad: 2 });
      a.hold(3);
    });

    scene((a) => {
      head(2, "Book your seat");
      cap(["You can book, change or", "cancel until **Sunday 09:30**."]);
      a.draw(D.clock(270, 440, 110, 9, 30), 1.4);
      a.write(["After 09:30 you can still tap", "**Not coming** if plans change."], 270, 640, { size: 32, anchor: "middle" });
      a.hold(2.4);
    });

    scene((a) => {
      head(2, "Book your seat");
      cap(["With alerts on, and no seat", "booked yet, you are reminded:"]);
      a.write(["Sunday 3–4pm and Wednesday 6–7pm"], CX, 236, { size: 26, color: a.RED, read: false });
      const n1 = a.note(30, 252, 480, "Book your seat for Sunday", "There is room on the bus. Bookings close Sunday 09:30. Tap to pick your stop.");
      a.wait(1.2);
      a.write(["Saturday 6–7pm"], CX, 268 + n1.h + 30, { size: 26, color: a.RED, read: false });
      const n2 = a.note(30, 284 + n1.h + 30, 480, "Last chance to book for Sunday", "Bookings close at 09:30 tomorrow. Tap to pick your stop.");
      a.wait(1.2);
      a.write(["Already booked? On Saturday", "evening you get this instead:"], CX, 330 + n1.h + n2.h + 60, { size: 28 });
      a.note(30, 400 + n1.h + n2.h + 50, 480, "You are booked for Sunday", "Fountains Road by Stanley Close, 10:36. 2 seats. Tap to change or cancel.");
      a.hold(6);
    });

    scene(nextCard(["Next:", "Sunday morning"]));
  });

  /* ======================================================================
     3. SUNDAY MORNING
     ====================================================================== */
  A.clip("3", (scene) => {
    scene(titleCard(3, "Sunday morning"));

    scene((a) => {
      head(3, "Sunday morning");
      when("Sunday, between 7:30 and 8:30");
      a.write(["With alerts on, your phone", "tells you your pick-up time."], CX, CY + 44, { size: 34 });
      lock("7:45", "Sunday 27 September");
      a.note(90, 480, 360, "Your bus today at 10:36", "Fountains Road by Stanley Close. Be at your stop a few minutes early.");
      a.hold(4);
    });

    scene((a) => {
      head(3, "Sunday morning");
      when("09:30  Bookings close");
      a.write(["The top of the page shows", "your stop: **Not set off yet**."], CX, CY + 44, { size: 34 });
      const s = phone("p-closed");
      a.zoom(s, "live", 40, 560, 460, { pad: 18 });
      a.hold(3);
    });

    scene((a) => {
      head(3, "Sunday morning");
      when("10:05  The bus leaves church");
      a.write(["Your phone tells you when", "to expect it at your stop."], CX, CY + 44, { size: 34 });
      lock("10:05", "Sunday 27 September");
      a.note(90, 480, 360, "Be at your stop in about 29 min", "Fountains Road by Stanley Close. Around 10:34. It has left church.");
      a.hold(4);
    });

    scene((a) => {
      head(3, "Sunday morning");
      cap(["The page counts down to", "your stop."]);
      const s = phone("p-left");
      a.zoom(s, "live", 40, 560, 460, { pad: 18 });
      a.hold(3);
    });

    scene((a) => {
      head(3, "Sunday morning");
      when("Bus 5 minutes late leaving?");
      a.write(["You are told that too."], CX, CY + 44, { size: 34 });
      lock("10:10", "Sunday 27 September");
      a.note(90, 480, 360, "No word yet that your bus has left church", "It was due to leave at 10:05. Yours is timetabled 10:36 at Fountains Road by Stanley Close.");
      a.hold(4);
    });

    scene((a) => {
      head(3, "Sunday morning");
      when("On the way");
      a.write(["As it picks people up before", "you, you may get a new time.", "You always hear when it leaves", "the last pick-up before yours."], CX, CY + 44, { size: 32 });
      A.draw(D.phone(70, 330, 400, 580), 0.8);
      A.label("10:24", 270, 420, { size: 60, font: "Barlow", color: A.INK, weight: 300 });
      a.note(90, 470, 360, "Be at your stop in about 11 min", "Fountains Road by Stanley Close. Around 10:35. It has just left Grace Road bus stop, Walton Vale.");
      a.hold(4.5);
    });

    scene((a) => {
      head(3, "Sunday morning");
      cap(["The page keeps up too:", "**6 min**, about 10:35."]);
      const s = phone("p-coming");
      a.zoom(s, "live", 40, 560, 460, { pad: 18 });
      a.hold(3);
    });

    scene((a) => {
      head(3, "Sunday morning");
      cap(["A minute or two away, it", "turns red: **Be at your stop**."]);
      const s = phone("p-now");
      a.zoom(s, "live", 40, 560, 460, { pad: 18, color: a.RED });
      a.hold(3);
    });

    scene((a) => {
      head(3, "Sunday morning");
      cap(["On board! The page shows", "**Picked up at 10:36**.", "Bus gone and you are not on it?", "Ring the transport group."], { size: 32 });
      const s = phone("p-picked");
      a.zoom(s, "live", 40, 560, 460, { pad: 18, color: a.GREEN });
      a.draw(D.tick(440, 500, 1.2), 0.5);
      a.hold(3.2);
    });

    scene((a) => {
      head(3, "Sunday morning");
      when("If a bus is called off");
      a.write(["You are told within minutes,", "whatever day it is."], CX, CY + 44, { size: 34 });
      lock("6:20", "Friday 25 September");
      a.note(90, 480, 360, "No bus to Fountains Road by Stanley Close on Sunday", "The North bus is not running this Sunday.");
      a.hold(3.6);
    });

    scene((a) => {
      head(3, "Sunday morning");
      when("After the service");
      a.write(["When the buses have finished", "(by 12 noon at the latest), the", "page moves on to **next Sunday**."], CX, CY + 44, { size: 32 });
      const s = phone("p-rolled");
      a.zoom(s, "back", 40, 620, 460, { pad: 10 });
      a.hold(3);
    });

    scene((a) => {
      head(3, "Sunday morning");
      when("Sunday, 3–4pm");
      a.write(["Not booked for next week yet?", "A reminder comes."], CX, CY + 44, { size: 34 });
      lock("3:10", "Sunday 27 September");
      a.note(90, 480, 360, "Book your seat for Sunday", "There is room on the bus. Bookings close Sunday 09:30. Tap to pick your stop.");
      a.hold(3.6);
    });

    scene((a) => {
      a.draw(D.road(20, 520, 700), 0.6, { pen: false });
      a.draw(D.church(360, 520, 1.05), 1.0);
      a.draw(D.bus(40, 590, 1.0), 1.0);
      a.write(["See you on the bus!"], 270, 250, { size: 54, anchor: "middle", color: a.BLUE });
      a.write(["RCCG Dominion Assembly", "Liverpool"], 270, 330, { size: 30, anchor: "middle", color: a.SOFT });
      a.hold(2.6);
    });
  });
})();
