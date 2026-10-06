/* THE DRIVER VIDEO, scene by scene: Sunday morning to the end of the run.

   Built the same way as clips.js (see engine.js for the calls). **Words in
   stars** are what the driver app says, and check_words.py holds them to
   index.html; the notifications are the live server's own words, held to
   server/worker.js.

   The example driver is on North in NH56 FWP. North leaves church at 10:05
   and its first pick-up is Scarisbrick Drive at 10:15; shots-driver.mjs stops
   if the timetable no longer says so. */
(function () {
  const A = DOODLE, D = A.D;
  const CX = 30, CY = 96;
  const PH = { x: 135, y: 322, w: 270 };
  const TITLE = "Driver  ·  Sunday morning";
  const APP = { app: "Driver", icon: "../icon-driver-180.png" };

  const head = () => A.label(TITLE, 270, 40, { size: 21 });
  const cap = (lines, o) => A.write(lines, CX, CY, Object.assign({ size: 34 }, o || {}));
  const phone = (name) => A.screen(name, PH.x, PH.y, PH.w);
  const when = (words) => A.write([words], CX, CY - 2, { size: 30, color: A.RED, read: true });
  function lock(clock, day) {
    A.draw(D.phone(70, 300, 400, 610), 0.8);
    A.label(clock, 270, 400, { size: 64, font: "Barlow", color: A.INK, weight: 300 });
    A.label(day, 270, 438, { size: 20, font: "Barlow", color: A.SOFT });
  }

  A.clip("driver", (scene) => {
    scene((a) => {
      a.draw(D.road(20, 520, 790), 0.6, { pen: false });
      a.draw(D.church(360, 610, 1.05), 1.1);
      a.draw(D.bus(50, 680, 1.0), 1.2);
      a.write(["The Driver app"], 270, 190, { size: 64, anchor: "middle" });
      a.write(["Sunday morning"], 270, 270, { size: 44, anchor: "middle", color: a.BLUE });
      a.write(["to the end of the run"], 270, 330, { size: 36, anchor: "middle", color: a.SOFT });
      a.draw(D.underline(110, 430, 360), 0.5, { pen: false });
      a.hold(1.8);
    });

    /* ---- the morning ---------------------------------------------------- */
    scene((a) => {
      head();
      when("Sunday, between 7:30 and 8:30");
      a.write(["With alerts on, your phone", "tells you your route and time."], CX, CY + 44, { size: 34 });
      lock("7:45", "Sunday 27 September");
      a.note(90, 480, 360, "You are driving today", "North. Depart 10:05 after vehicle check.", APP);
      a.hold(3.6);
    });

    scene((a) => {
      head();
      cap(["Open **Driver** and choose", "your name."]);
      const s = phone("d-name");
      a.ringOn(s, "pick", { pad: 2 });
      a.hold(2.4);
    });

    scene((a) => {
      head();
      cap(["Type your four-digit **PIN**.", "It goes in by itself on the", "last digit."]);
      const s = phone("d-pin");
      a.ringOn(s, "pin", { pad: 2 });
      a.zoom(s, "pick", 40, 620, 460, { pad: 10 });
      a.hold(2.6);
    });

    /* ---- the check ------------------------------------------------------ */
    scene((a) => {
      head();
      cap(["Before you drive, tap", "**Vehicle check**."]);
      const s = phone("d-hub");
      a.ringOn(s, "check", { pad: 2 });
      a.hold(2.2);
    });

    scene((a) => {
      head();
      cap(["Tap your bus. **Yours today**", "shows the one on the rota.", "Then **Continue**."]);
      const s = phone("d-bus");
      a.ringOn(s, "bus", { pad: 2 });
      a.hold(2.6);
    });

    scene((a) => {
      head();
      cap(["Type the **Mileage now** and tap", "the **Fuel showing**, then", "**Start the check**."]);
      const s = phone("d-prep");
      a.ringOn(s, "miles", { pad: 2 });
      a.zoom(s, "fuel", 40, 650, 460, { pad: 6 });
      a.hold(2.8);
    });

    scene((a) => {
      head();
      cap(["Walk round the bus. On every", "item tap **Fine**, **Advisory** or", "**Defect**."]);
      const s = phone("d-stage");
      a.zoom(s, "choose", 40, 620, 460, { pad: 6 });
      a.hold(2.8);
    });

    scene((a) => {
      head();
      cap(["A **Defect** on an item marked", "**Stops the bus** means the bus", "does not run. Ring the", "coordinator."], { size: 32 });
      const s = phone("d-crit");
      a.zoom(s, "dash", 40, 640, 460, { pad: 0, color: a.RED });
      a.hold(3.2);
    });

    scene((a) => {
      head();
      cap(["Every **Defect** needs a photo.", "Tap **Add photo**: take one,", "or pick one from your photos."]);
      const s = phone("d-photo-ask");
      a.ringOn(s, "add", { pad: 2 });
      a.zoom(s, "count", 40, 700, 460, { pad: 4, color: a.RED });
      a.hold(3);
    });

    scene((a) => {
      head();
      cap(["The photo shows on the item.", "An **Advisory** can have one", "too. Then **Next stage**."]);
      const s = phone("d-photo-done");
      a.ringOn(s, "pic", { pad: 2, color: a.GREEN });
      a.hold(2.8);
    });

    scene((a) => {
      head();
      cap(["At the end, type your name", "and tap **Sign and send**."]);
      const s = phone("d-review");
      a.ringOn(s, "sign", { pad: 2 });
      a.ringOn(s, "send", { pad: 2 });
      a.hold(2.6);
    });

    scene((a) => {
      head();
      cap(["**Check complete**. Tap", "**Start your run**."]);
      const s = phone("d-sent");
      a.zoom(s, "title", 40, 610, 460, { pad: 8, color: a.GREEN });
      a.ringOn(s, "go", { pad: 2 });
      a.hold(2.6);
    });

    /* ---- the run -------------------------------------------------------- */
    scene((a) => {
      head();
      when("10:05  Time to leave church");
      a.write(["Your phone says when it", "is time to go."], CX, CY + 44, { size: 34 });
      lock("10:05", "Sunday 27 September");
      a.note(90, 480, 360, "Time to set off", "Your North run is due to leave church at 10:05. Tap Start as you pull away.", APP);
      a.hold(3.6);
    });

    scene((a) => {
      head();
      cap(["As you pull away, tap", "**Start trip ·** NH56 FWP."]);
      const s = phone("d-ready");
      a.ringOn(s, "start", { pad: 2 });
      a.hold(2.6);
    });

    scene((a) => {
      head();
      cap(["Your next booked stop sits in", "the middle of the screen.", "No scrolling."]);
      const s = phone("d-running");
      a.ringOn(s, "next", { pad: 0 });
      a.hold(2.8);
    });

    scene((a) => {
      head();
      cap(["About a minute away, the stop", "comes up. **Call passenger**", "rings their phone."]);
      const s = phone("d-popup");
      a.ringOn(s, "call", { pad: 2 });
      a.hold(3);
    });

    scene((a) => {
      head();
      cap(["On board? Tap **Picked up**.", "Nobody there? Tap", "**Nobody here**."]);
      const s = phone("d-popup");
      a.ringOn(s, "picked", { pad: 2, color: a.GREEN });
      a.ringOn(s, "nobody", { pad: 2 });
      a.hold(2.8);
    });

    scene((a) => {
      head();
      cap(["While the bus moves, the", "buttons wait. Pull up first."]);
      const s = phone("d-popup-moving");
      a.zoom(s, "moving", 40, 640, 460, { pad: 6, color: a.RED });
      a.hold(2.8);
    });

    scene((a) => {
      head();
      cap(["Tapped the wrong one? Tap the", "other answer under the stop."]);
      const s = phone("d-marked");
      a.ringOn(s, "other", { pad: 2 });
      a.hold(2.8);
    });

    scene((a) => {
      head();
      cap(["Or tap **Undo**. It asks first:", "**Keep it** or **Undo**."]);
      const s = phone("d-undo");
      a.ringOn(s, "keep", { pad: 2, color: a.BLUE });
      a.ringOn(s, "yes", { pad: 2 });
      a.hold(2.8);
    });

    scene((a) => {
      head();
      cap(["Back at church, tap", "**End trip, arrived at church**."]);
      const s = phone("d-arrived");
      a.ringOn(s, "end", { pad: 2 });
      a.hold(2.6);
    });

    scene((a) => {
      head();
      cap(["**Trip finished.** Done for", "this Sunday."]);
      const s = phone("d-finished");
      a.zoom(s, "done", 40, 620, 460, { pad: 4, color: a.GREEN });
      a.draw(D.tick(440, 560, 1.2), 0.5);
      a.hold(2.6);
    });

    scene((a) => {
      a.draw(D.road(20, 520, 700), 0.6, { pen: false });
      a.draw(D.church(360, 520, 1.05), 1.0);
      a.draw(D.bus(40, 590, 1.0), 1.0);
      a.write(["Thank you for driving!"], 270, 250, { size: 50, anchor: "middle", color: a.BLUE });
      a.write(["RCCG Dominion Assembly", "Liverpool"], 270, 330, { size: 30, anchor: "middle", color: a.SOFT });
      a.hold(2.6);
    });
  });
})();
