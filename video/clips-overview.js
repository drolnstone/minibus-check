/* THE OVERVIEW VIDEO, for showing the whole system to someone new: the
   RCCG Dominion Assembly Liverpool Transportation Management System from A
   to Z. The job, the three apps, the live server and the sheet behind them,
   the rota and the people, a passenger's week, one Sunday from the vehicle
   check to Church, the records and the coordinator's week, the jobs that run
   by themselves, and what it all achieves. About four minutes.

   Built the same way as clips.js and clips-driver.js (see engine.js for the
   calls). The screens are the real apps: the passenger page from shots.mjs,
   the driver app from shots-driver.mjs and the coordinator app from the
   coordinator browser checks (tests/browser/coordinator.mjs, copied in as
   c-*.png by build.sh). All of it on invented people, the example numbers
   07700 900xxx, the made-up stops of fake-stops.json and made-up bus
   registrations (mask.mjs). No star words, so check_words.py has nothing to
   hold here; the notification titles and bodies are the server's own. */
(function () {
  const A = DOODLE, D = A.D;
  const CX = 30, CY = 96;
  const PH = { x: 135, y: 322, w: 270 };
  const NAVY = "#1E3260", INDIGO = "#4b3fa8";
  const P = { app: "Sunday Bus", icon: "../icon-sunday-180.png" };
  const DR = { app: "Driver App", icon: "../icon-driver-180.png" };

  let title = "";
  const head = () => A.label(title, 270, 40, { size: 21 });
  const cap = (lines, o) => A.write(lines, CX, CY, Object.assign({ size: 34, speed: 42 }, o || {}));
  const phone = (name) => A.screen(name, PH.x, PH.y, PH.w, { frameDur: 0.6, dur: 0.5 });
  /* Two screens side by side, each named under it in its app's colour. */
  function two(left, right) {
    const a = A.screen(left[0], 42, 300, 200, { frameDur: 0.45, dur: 0.4 });
    A.write([left[1]], 142, 790, { size: 26, anchor: "middle", color: left[2] });
    const b = A.screen(right[0], 298, 300, 200, { frameDur: 0.45, dur: 0.4 });
    A.write([right[1]], 398, 790, { size: 26, anchor: "middle", color: right[2] });
    return [a, b];
  }
  const DRV = (n) => [n, "Driver App", NAVY], CO = (n) => [n, "Coordinator App", INDIGO], PA = (n) => [n, "Sunday Bus", A.GREEN];
  function lock(clock, day) {
    A.draw(D.phone(70, 300, 400, 610), 0.8);
    A.label(clock, 270, 400, { size: 64, font: "Barlow", color: A.INK, weight: 300 });
    A.label(day, 270, 438, { size: 20, font: "Barlow", color: A.SOFT });
  }
  const box = (x, y, w, h, c) => A.rc.rectangle(x, y, w, h, A.O({ stroke: c || A.INK, strokeWidth: 3 }));

  A.clip("overview", (scene) => {
    /* ---- title ----------------------------------------------------------- */
    scene((a) => {
      a.draw(D.road(20, 520, 800), 0.6, { pen: false });
      a.draw(D.church(360, 620, 1.05), 1.1);
      a.draw(D.bus(50, 690, 1.0), 1.1);
      a.write(["RCCG Dominion Assembly", "Liverpool"], 270, 170, { size: 48, anchor: "middle", lh: 56 });
      a.write(["Transportation", "Management System"], 270, 320, { size: 44, anchor: "middle", color: a.BLUE, lh: 52 });
      a.draw(D.underline(90, 450, 390), 0.5, { pen: false });
      a.write(["Sunday Bus  ·  Driver App  ·  Coordinator App"], 270, 450, { size: 24, anchor: "middle", color: a.SOFT });
      a.hold(1.9);
    });

    /* ---- the job ----------------------------------------------------------- */
    scene((a) => {
      title = "The job";
      head();
      cap(["Every Sunday two minibuses,", "North and South, collect", "people from 17 stops and", "bring them to Church by 11:00."]);
      a.draw(D.road(20, 520, 700), 0.5, { pen: false });
      a.draw(D.bus(40, 580, 0.8), 0.8);
      a.draw(D.bus(300, 580, 0.8), 0.8);
      a.label("North", 120, 690, { size: 26, color: a.INK });
      a.label("South", 380, 690, { size: 26, color: a.INK });
      a.draw(D.person(90, 780, 0.8), 0.3);
      a.draw(D.person(160, 780, 0.8), 0.3);
      a.draw(D.person(380, 780, 0.8), 0.3);
      a.draw(D.stopSign(460, 760), 0.3);
      a.hold(1.8);
    });

    scene((a) => {
      head();
      cap(["Every week that takes:"]);
      const rows = ["seats booked, stop by stop", "a driver and a bus per route", "each bus checked and road legal", "passengers told when to be out", "everyone at Church on time", "a record of all of it"];
      rows.forEach((r, i) => {
        a.draw(D.tick(40, 186 + i * 100, 0.8), 0.3, { pen: false });
        a.write([r], 100, 222 + i * 100, { size: 31 });
      });
      a.hold(1.6);
    });

    /* ---- the pieces ------------------------------------------------------- */
    scene((a) => {
      title = "How it fits together";
      head();
      cap(["Three apps, each added to", "the phone's Home Screen.", "No app store."]);
      const icons = [["../icon-sunday-180.png", "Sunday Bus", a.GREEN, "Passengers"], ["../icon-driver-180.png", "Driver App", NAVY, "Drivers"],
                     ["../alt-indigo-180.png", "Coordinator App", INDIGO, "Coordinators"]];
      icons.forEach((ic, i) => {
        const x = 50 + i * 165;
        a.draw(D.phone(x, 330, 130, 230), 0.45);
        a.pic(ic[0], x + 33, 400, 64, 64);
        a.write([ic[1]], x + 65, 610, { size: 25, anchor: "middle", color: ic[2] });
        a.write([ic[3]], x + 65, 645, { size: 23, anchor: "middle", color: a.SOFT });
      });
      a.write(["The driver and passenger apps", "keep working without signal."], 270, 740, { size: 28, anchor: "middle", lh: 36 });
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["Behind them, a live server", "and a Google Sheet."]);
      [["../icon-sunday-180.png", 95], ["../icon-driver-180.png", 270], ["../alt-indigo-180.png", 445]].forEach((ic) => a.pic(ic[0], ic[1] - 28, 220, 56, 56, { with: true }));
      a.wait(0.4);
      [95, 270, 445].forEach((x) => a.draw(D.arrow(x, 290, 270 + (x - 270) * 0.3, 380), 0.25, { pen: false }));
      a.draw(box(60, 390, 420, 170, a.BLUE), 0.7);
      a.write(["The live server"], 270, 436, { size: 34, anchor: "middle", color: a.BLUE });
      a.write(["runs the Sunday: bookings, taps,", "PINs, alerts and live times.", "Its clock ticks every minute."], 270, 476, { size: 25, anchor: "middle", lh: 29 });
      a.draw(D.arrow(250, 572, 250, 640), 0.25, { pen: false });
      a.draw(D.arrow(290, 640, 290, 572), 0.25, { pen: false });
      a.draw(box(60, 650, 420, 150, a.GREEN), 0.7);
      a.write(["The Google Sheet"], 270, 696, { size: 34, anchor: "middle", color: a.GREEN });
      a.write(["the record. Every change", "reaches it within seconds."], 270, 736, { size: 25, anchor: "middle", lh: 29 });
      a.hold(2.4);
    });

    scene((a) => {
      title = "The record";
      head();
      cap(["Each part of the system", "has its own tab. History", "keeps each change to a bus", "or defect: who, when, why."]);
      const x0 = 50, y0 = 300, w = 440, h = 440, cols = 4, rows = 9;
      a.draw(box(x0, y0, w, h, a.INK), 0.6, { pen: false });
      const lines = [];
      for (let r = 1; r < rows; r++) lines.push(A.rc.line(x0, y0 + r * h / rows, x0 + w, y0 + r * h / rows, A.O({ strokeWidth: 1.2, stroke: "#9aa3ab" })));
      for (let c = 1; c < cols; c++) lines.push(A.rc.line(x0 + c * w / cols, y0, x0 + c * w / cols, y0 + h, A.O({ strokeWidth: 1.2, stroke: "#9aa3ab" })));
      a.draw(lines.reduce((g, l) => { g.appendChild(l); return g; }, document.createElementNS("http://www.w3.org/2000/svg", "g")), 0.6, { pen: false });
      a.draw(A.rc.rectangle(x0, y0, w, h / rows, A.O({ stroke: "none", fill: "#dcf8c6", fillStyle: "solid" })), 0.2, { pen: false });
      const tabs = ["Drivers", "Buses", "Bus Stops", "Rota", "Rota Requests", "Bus Bookings", "Trip Events", "Checks", "Defects", "Vehicle Log", "History"];
      tabs.forEach((t, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        a.write([t], 60 + col * 150, 790 + row * 36, { size: 24, color: a.GREEN, speed: 60 });
      });
      a.hold(2.1);
    });

    /* ---- the people ------------------------------------------------------- */
    scene((a) => {
      title = "Drivers and the rota";
      head();
      cap(["The rota fills itself weeks", "ahead: who drives North and", "South, and in which bus."]);
      phone("c-rota");
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["A driver asks for cover and", "a coordinator approves. On", "the day a run can be handed", "over, even to a hired bus."]);
      phone("c-cover");
      a.hold(2.1);
    });

    scene((a) => {
      head();
      cap(["One register of drivers and", "coordinators. Each has their", "own PIN, kept scrambled on", "the server."]);
      two(CO("c-drivers"), CO("c-wrong-pin"));
      a.hold(2.1);
    });

    /* ---- the week ---------------------------------------------------------- */
    scene((a) => {
      title = "The week  ·  passengers";
      head();
      cap(["Passengers open Sunday Bus:", "both routes, every stop and", "how many are booked."]);
      phone("p-first");
      a.hold(1.8);
    });

    scene((a) => {
      head();
      cap(["A seat takes a phone number", "and how many are coming.", "No names are kept."]);
      const [l, r] = two(PA("p-ask-typed"), PA("p-booked"));
      a.ringOn(r, "booked", { pad: 2 });
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["Anyone not booked is", "reminded in the week.", "Bookings close Sunday 09:30."]);
      lock("18:00", "Saturday");
      a.note(90, 480, 360, "Book your seat(s) for Sunday 27 Sep", "Bookings close on Sunday morning 09:30.", P);
      a.hold(1.8);
    });

    scene((a) => {
      head();
      cap(["Coordinators see every", "booking, and book, change", "or cancel for anyone who", "rings."]);
      phone("c-bookings");
      a.hold(1.9);
    });

    /* ---- Sunday morning --------------------------------------------------- */
    scene((a) => {
      title = "Sunday  ·  07:30";
      head();
      cap(["At 07:30 each passenger", "booked and each driver on", "the rota gets an alert."]);
      lock("7:30", "Sunday");
      a.note(90, 480, 360, "Your bus today at 10:36", "Meadow Road by Willow Close. Be at your stop a few minutes early.", P);
      a.note(90, 640, 360, "You are driving today", "North. Vehicle check 09:45. Depart 10:05.", DR);
      a.hold(1.9);
    });

    scene((a) => {
      title = "Sunday  ·  the vehicle check";
      head();
      cap(["The driver signs in and", "sees the duty: route, check", "time and departure."]);
      const s = phone("d-hub");
      a.ringOn(s, "duty", { pad: 2 });
      a.hold(1.6);
    });

    scene((a) => {
      head();
      cap(["37 items, after the DVSA", "walkaround check. Each one", "Fine, Advisory or Defect."]);
      phone("d-stage");
      a.hold(1.8);
    });

    scene((a) => {
      head();
      cap(["A Defect needs a photo. One", "that stops the bus waits for", "a coordinator to authorise it."]);
      two(DRV("d-crit"), CO("c-stopped"));
      a.hold(2.1);
    });

    scene((a) => {
      head();
      cap(["Mileage and fuel at every", "check. Jobs to arrange, like", "fuel or a wash, go straight", "to the coordinators."]);
      two(DRV("d-prep"), CO("c-home"));
      a.hold(2.1);
    });

    /* ---- the run ---------------------------------------------------------- */
    scene((a) => {
      title = "Sunday  ·  the run";
      head();
      cap(["Start trip. Only the booked", "stops, the next on top. The", "postcode opens the map."]);
      const s = phone("d-running");
      a.ringOn(s, "map", { pad: 2 });
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["At each stop: Picked up or", "Nobody here, and a Call", "button for each number."]);
      const s = phone("d-popup");
      a.ringOn(s, "picked", { pad: 2 });
      a.hold(1.9);
    });

    scene((a) => {
      title = "Sunday  ·  the passenger";
      head();
      cap(["Passengers watch it come.", "The time is worked out from", "the bus's own location and", "Google traffic."]);
      const s = phone("p-coming");
      a.ringOn(s, "live", { pad: 2 });
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["Their phone tells them", "when to be at the stop."]);
      lock("10:29", "Sunday");
      a.note(90, 480, 360, "Be at your stop in about 6 min",
             "Meadow Road by Willow Close. Around 10:35. It has just left Rowan Road bus stop, Maple Vale.", P);
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["Picked up."]);
      phone("p-picked");
      a.hold(1.4);
    });

    scene((a) => {
      title = "Sunday  ·  Church";
      head();
      cap(["Back in the Church grounds", "with every booked stop done,", "the run ends by itself. The", "server or a coordinator can", "end it too."]);
      a.draw(D.road(20, 520, 800), 0.5, { pen: false });
      a.draw(D.church(330, 560, 1.15), 1.0);
      const fence = [];
      for (let x = 250; x <= 510; x += 26) fence.push(A.rc.line(x, 735, x, 790, A.O({ strokeWidth: 2 })));
      fence.push(A.rc.line(244, 750, 516, 750, A.O({ strokeWidth: 2 })));
      fence.push(A.rc.line(244, 772, 516, 772, A.O({ strokeWidth: 2 })));
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      fence.forEach((f) => g.appendChild(f));
      a.draw(g, 0.7, { pen: false });
      a.draw(D.bus(30, 690, 0.95), 0.9);
      a.draw(D.tick(440, 470, 1.1), 0.4, { pen: false });
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["After the afternoon run the", "driver records the parked", "fuel and mileage."]);
      const s = phone("d-park");
      a.ringOn(s, "box", { pad: 4 });
      a.hold(1.8);
    });

    /* ---- the records and the week --------------------------------------- */
    scene((a) => {
      title = "The coordinator's week";
      head();
      cap(["Every tap is on the run", "record, early or late against", "the time passengers were", "given."]);
      phone("c-runs");
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["A defect stays open until a", "coordinator records what", "was done."]);
      phone("c-defects");
      a.hold(1.8);
    });

    scene((a) => {
      head();
      cap(["Each bus's MOT, service,", "insurance and parking permit.", "Coordinators are told 60, 30", "and 7 days before each is due."]);
      phone("c-bus");
      a.hold(2.1);
    });

    scene((a) => {
      head();
      cap(["Fuel bought, repairs and", "renewals go in the Vehicle", "Log."]);
      phone("c-fuel");
      a.hold(1.6);
    });

    scene((a) => {
      head();
      cap(["Messages to coordinators,", "drivers or passengers, and", "who takes the emergency", "calls."]);
      two(CO("c-message"), CO("c-calls"));
      a.hold(1.9);
    });

    scene((a) => {
      head();
      cap(["Have a look: seats, who has", "alerts on, who is tapping,", "and is everything working."]);
      phone("c-look");
      a.hold(1.8);
    });

    /* ---- by itself -------------------------------------------------------- */
    scene((a) => {
      title = "By itself";
      head();
      cap(["Without anyone asking:"]);
      const rows = ["duty reminders, 7 and 2", "days before a driver's Sunday", "a summary every Sunday", "evening", "a tidy-up at 3am", "", "an email if the live server", "stops answering"];
      for (let i = 0; i < rows.length; i += 2) {
        const y = 196 + (i / 2) * 116;
        a.draw(D.tick(30, y - 30, 0.8), 0.3, { pen: false });
        a.write(rows[i + 1] ? [rows[i], rows[i + 1]] : [rows[i]], 90, y, { size: 31, lh: 38 });
      }
      a.draw(D.clock(150, 760, 70, 3, 0), 0.8);
      a.draw(A.rc.rectangle(300, 710, 160, 105, A.O({ fill: "#ffffff", fillStyle: "solid" })), 0.4);
      a.draw(A.rc.linearPath([[300, 710], [380, 770], [460, 710]], A.O()), 0.3, { pen: false });
      a.hold(1.9);
    });

    /* ---- what it achieves ------------------------------------------------- */
    scene((a) => {
      title = "What it achieves";
      head();
      const rows = ["Every seat known before", "the bus leaves.", "Every bus checked and", "road legal.", "Passengers told when to", "be at their stop.", "Drivers, cover and buses", "arranged ahead.", "Every run, check and", "defect on record."];
      for (let i = 0; i < rows.length; i += 2) {
        const y = 140 + (i / 2) * 140;
        a.draw(D.tick(30, y - 30, 0.8), 0.3, { pen: false });
        a.write([rows[i], rows[i + 1]], 90, y, { size: 32, lh: 40 });
      }
      a.hold(2.2);
    });

    scene((a) => {
      a.draw(D.road(20, 520, 800), 0.6, { pen: false });
      a.draw(D.church(360, 620, 1.05), 1.0);
      a.draw(D.bus(130, 690, 1.0), 1.0);
      a.write(["RCCG Dominion Assembly", "Liverpool"], 270, 170, { size: 46, anchor: "middle", lh: 54 });
      a.write(["Transportation", "Management System"], 270, 310, { size: 40, anchor: "middle", color: a.SOFT, lh: 48 });
      a.write(["Everyone at Church", "on time."], 270, 450, { size: 44, anchor: "middle", color: a.BLUE, lh: 52 });
      a.hold(2.1);
    });
  });
})();
