/* THE OVERVIEW VIDEO, for showing the whole system to someone new: what it
   is for, the three apps, the server and the sheet behind them, one Sunday
   from booking to Church, and what it achieves. About two and a half minutes.

   Built the same way as clips.js and clips-driver.js (see engine.js for the
   calls), from the same photographs: the passenger page from shots.mjs and
   the driver app from shots-driver.mjs, both on stand-in data (Bro Sample,
   the example number 07700 900123, invented seat counts). The coordinator
   app is drawn, not photographed. No star words, so check_words.py has
   nothing to hold here; the notification titles are the server's own. */
(function () {
  const A = DOODLE, D = A.D;
  const CX = 30, CY = 96;
  const PH = { x: 135, y: 322, w: 270 };
  const NAVY = "#1E3260", INDIGO = "#4b3fa8";
  const P = { app: "Sunday Bus", icon: "../icon-sunday-180.png" };
  const DR = { app: "Driver", icon: "../icon-driver-180.png" };

  let title = "";
  const head = () => A.label(title, 270, 40, { size: 21 });
  const cap = (lines, o) => A.write(lines, CX, CY, Object.assign({ size: 34 }, o || {}));
  const phone = (name) => A.screen(name, PH.x, PH.y, PH.w);
  const box = (x, y, w, h, c, fill) => A.rc.rectangle(x, y, w, h, A.O({ stroke: c || A.INK, strokeWidth: 3, fill: fill || undefined, fillStyle: "hachure", hachureGap: 9, fillWeight: 1.2 }));

  A.clip("overview", (scene) => {
    /* ---- title ----------------------------------------------------------- */
    scene((a) => {
      a.draw(D.road(20, 520, 790), 0.6, { pen: false });
      a.draw(D.church(360, 610, 1.05), 1.1);
      a.draw(D.bus(50, 680, 1.0), 1.2);
      a.write(["Sunday Bus"], 270, 190, { size: 70, anchor: "middle" });
      a.write(["Getting people to Church"], 270, 270, { size: 40, anchor: "middle", color: a.BLUE });
      a.write(["A transport system in three apps"], 270, 326, { size: 30, anchor: "middle", color: a.SOFT });
      a.draw(D.underline(90, 450, 350), 0.5, { pen: false });
      a.hold(1.8);
    });

    /* ---- the problem ------------------------------------------------------ */
    scene((a) => {
      title = "The job";
      head();
      cap(["Every Sunday two minibuses,", "North and South, collect", "people from 17 stops and", "bring them to Church by 11:00."]);
      a.draw(D.road(20, 520, 700), 0.5, { pen: false });
      a.draw(D.bus(40, 580, 0.8), 0.9);
      a.draw(D.bus(300, 580, 0.8), 0.9);
      a.label("North", 120, 690, { size: 26, color: a.INK });
      a.label("South", 380, 690, { size: 26, color: a.INK });
      a.draw(D.person(90, 780, 0.8), 0.4);
      a.draw(D.person(160, 780, 0.8), 0.4);
      a.draw(D.person(380, 780, 0.8), 0.4);
      a.draw(D.stopSign(460, 760), 0.4);
      a.hold(2.4);
    });

    scene((a) => {
      head();
      cap(["Each week it needs:"]);
      const rows = ["who is coming, from which stop", "a driver for each route", "each bus checked before it runs", "passengers told when to be out", "everyone at Church on time"];
      rows.forEach((r, i) => {
        a.draw(D.tick(40, 200 + i * 110, 0.8), 0.35, { pen: false });
        a.write([r], 100, 236 + i * 110, { size: 31 });
      });
      a.hold(2.2);
    });

    /* ---- the pieces ------------------------------------------------------- */
    scene((a) => {
      title = "How it fits together";
      head();
      cap(["Three apps, each on the", "phone's Home Screen.", "No app store."]);
      const icons = [["../icon-sunday-180.png", "Passenger", a.GREEN], ["../icon-driver-180.png", "Driver", NAVY], ["../alt-indigo-180.png", "Coordinator", INDIGO]];
      icons.forEach((ic, i) => {
        const x = 50 + i * 165;
        a.draw(D.phone(x, 330, 130, 230), 0.5);
        a.pic(ic[0], x + 33, 400, 64, 64);
        a.write([ic[1]], x + 65, 610, { size: 28, anchor: "middle", color: ic[2] });
      });
      a.write(["Book a seat.", "Check the bus.", "Run the stops.", "See it all."], 270, 700, { size: 30, anchor: "middle", color: a.SOFT, lh: 40 });
      a.hold(2.4);
    });

    scene((a) => {
      head();
      cap(["Behind them, a server and", "a Google Sheet."]);
      [["../icon-sunday-180.png", 95], ["../icon-driver-180.png", 270], ["../alt-indigo-180.png", 445]].forEach((ic) => a.pic(ic[0], ic[1] - 28, 220, 56, 56, { with: true }));
      a.wait(0.4);
      [95, 270, 445].forEach((x) => a.draw(D.arrow(x, 290, 270 + (x - 270) * 0.3, 380), 0.3, { pen: false }));
      a.draw(box(70, 390, 400, 150, a.BLUE), 0.8);
      a.write(["The server"], 270, 436, { size: 34, anchor: "middle", color: a.BLUE });
      a.write(["sign-ins, bookings, alerts,", "live times on the run"], 270, 478, { size: 26, anchor: "middle", lh: 30 });
      a.draw(D.arrow(270, 550, 270, 620), 0.3, { pen: false });
      a.draw(box(70, 630, 400, 190, a.GREEN), 0.8);
      a.write(["The Google Sheet"], 270, 676, { size: 34, anchor: "middle", color: a.GREEN });
      a.write(["drivers, buses, stops, rota,", "checks, defects, mileage,", "MOT and insurance dates"], 270, 718, { size: 26, anchor: "middle", lh: 30 });
      a.hold(3.2);
    });

    /* ---- the week --------------------------------------------------------- */
    scene((a) => {
      title = "One Sunday  ·  in the week";
      head();
      cap(["Passengers book a seat:", "route, stop, phone number,", "how many. No names kept."]);
      phone("p-booked");
      a.hold(2.6);
    });

    scene((a) => {
      head();
      cap(["Anyone not booked is", "reminded on Sunday, Wednesday", "and Saturday."]);
      a.draw(D.phone(70, 300, 400, 610), 0.8);
      a.label("18:00", 270, 400, { size: 64, font: "Barlow", color: a.INK, weight: 300 });
      a.label("Saturday", 270, 438, { size: 20, font: "Barlow", color: a.SOFT });
      a.note(90, 480, 360, "Book your seat(s) for Sunday", "Bookings close on Sunday morning 09:30.", P);
      a.hold(2.4);
    });

    /* ---- Sunday morning --------------------------------------------------- */
    scene((a) => {
      title = "One Sunday  ·  07:30";
      head();
      cap(["At 07:30 everyone booked,", "and each driver on the rota,", "gets an alert."]);
      a.draw(D.phone(70, 300, 400, 610), 0.8);
      a.label("7:30", 270, 400, { size: 64, font: "Barlow", color: a.INK, weight: 300 });
      a.label("Sunday", 270, 438, { size: 20, font: "Barlow", color: a.SOFT });
      a.note(90, 480, 360, "Your bus today at 10:36", "Meadow Road by Willow Close.", P);
      a.note(90, 620, 360, "You are driving today", "North. Vehicle check 09:45. Depart 10:05.", DR);
      a.hold(2.4);
    });

    scene((a) => {
      title = "One Sunday  ·  the driver";
      head();
      cap(["The driver signs in with a", "PIN and checks the bus first."]);
      phone("d-hub");
      a.hold(2.0);
    });

    scene((a) => {
      head();
      cap(["Each item: Fine, Advisory", "or Defect. A Defect needs a", "photo. Some stop the bus."]);
      phone("d-crit");
      a.hold(2.6);
    });

    /* ---- the run ---------------------------------------------------------- */
    scene((a) => {
      title = "One Sunday  ·  the run";
      head();
      cap(["Start trip. The stops in order,", "with who is booked at each.", "The postcode opens the map."]);
      phone("d-running");
      a.hold(2.6);
    });

    scene((a) => {
      head();
      cap(["At each stop: Picked up or", "Nobody here. Call passenger", "is one tap."]);
      phone("d-popup");
      a.hold(2.6);
    });

    scene((a) => {
      title = "One Sunday  ·  the passenger";
      head();
      cap(["The passenger's page counts", "down, from the bus's own", "location and Google traffic."]);
      phone("p-coming");
      a.hold(2.4);
    });

    scene((a) => {
      head();
      cap(["Their phone tells them", "when to be at the stop."]);
      a.draw(D.phone(70, 300, 400, 610), 0.8);
      a.label("10:30", 270, 400, { size: 64, font: "Barlow", color: a.INK, weight: 300 });
      a.label("Sunday", 270, 438, { size: 20, font: "Barlow", color: a.SOFT });
      a.note(90, 480, 360, "Be at your stop in about 6 min", "Meadow Road by Willow Close.", P);
      a.hold(2.4);
    });

    scene((a) => {
      head();
      cap(["Picked up."]);
      phone("p-picked");
      a.hold(1.8);
    });

    /* ---- Church ----------------------------------------------------------- */
    scene((a) => {
      title = "One Sunday  ·  Church";
      head();
      cap(["Heading to Church. Back in", "the grounds, the run ends", "by itself."]);
      phone("d-church");
      a.hold(2.2);
    });

    scene((a) => {
      head();
      cap(["After the afternoon run the", "driver keys in the parked", "mileage. It goes to the sheet."]);
      phone("d-park");
      a.hold(2.4);
    });

    /* ---- the coordinator -------------------------------------------------- */
    scene((a) => {
      title = "The coordinator";
      head();
      cap(["The coordinator app sees", "every run, booking and alert."]);
      a.draw(D.phone(110, 250, 320, 640), 0.8);
      a.pic("../alt-indigo-180.png", 140, 300, 48, 48);
      a.write(["Coordinator"], 200, 334, { size: 30, color: INDIGO });
      const items = ["Rota", "Bookings", "Send a message", "Hand over a run", "Checks and defects", "Emergency calls", "Alerts"];
      items.forEach((t, i) => {
        a.draw(A.rc.rectangle(140, 380 + i * 68, 260, 52, A.O({ stroke: INDIGO, strokeWidth: 2 })), 0.25, { pen: false });
        a.write([t], 156, 416 + i * 68, { size: 28 });
      });
      a.hold(2.6);
    });

    scene((a) => {
      head();
      cap(["Book a seat for someone,", "move a run to another driver,", "message drivers or passengers."]);
      a.draw(D.bus(60, 420, 0.9), 0.9);
      a.draw(D.arrow(260, 470, 340, 470, INDIGO), 0.4, { pen: false });
      a.draw(D.person(400, 420, 1.1), 0.5);
      a.draw(D.bell(270, 700, 1.4), 0.7);
      a.hold(2.4);
    });

    /* ---- what it achieves ------------------------------------------------- */
    scene((a) => {
      title = "What it achieves";
      head();
      const rows = ["Every seat known before", "the bus leaves.", "Every bus checked before", "it runs.", "Passengers told when to", "be at their stop.", "Records kept, and dates", "like MOT watched.", "Coordinators see it all", "in one app."];
      for (let i = 0; i < rows.length; i += 2) {
        const y = 150 + (i / 2) * 150;
        a.draw(D.tick(30, y - 30, 0.8), 0.35, { pen: false });
        a.write([rows[i], rows[i + 1]], 90, y, { size: 32, lh: 40 });
      }
      a.hold(3.0);
    });

    scene((a) => {
      a.draw(D.road(20, 520, 790), 0.6, { pen: false });
      a.draw(D.church(360, 610, 1.05), 1.1);
      a.draw(D.bus(130, 680, 1.0), 1.0);
      a.write(["Sunday Bus"], 270, 230, { size: 70, anchor: "middle" });
      a.write(["Passenger  ·  Driver  ·  Coordinator"], 270, 300, { size: 28, anchor: "middle", color: a.SOFT });
      a.write(["Everyone at Church", "on time."], 270, 400, { size: 44, anchor: "middle", color: a.BLUE, lh: 52 });
      a.hold(2.4);
    });
  });
})();
