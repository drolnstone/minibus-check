/* PDF REPORTS, from v1.95.0.

   Lays out a report the sheet has gathered (Code.gs pdfReport) as an A4 PDF:
   the logo, the title and period, each section as a table, and on every page
   "Contains names" and "Page x of y". The words are real text, so they can be
   selected, searched and read aloud. jspdf.umd.min.js beside this file does
   the writing; nothing here reaches the network.

   reportPdf(report, opt) hands back the jsPDF document.
     opt.logo    a JPEG data URL, or nothing
     opt.logoW   its width over its height
     opt.church  the name at the top
     opt.made    when, as it is to be printed
     opt.who     the coordinator who made it */

(function (root) {
  "use strict";

  /* The PDF's own fonts know Latin-1 and no more. Anything else is put into
     its nearest plain form, so no word silently loses a letter. */
  var SWAP = [[/[‘’‛′]/g, "'"], [/[“”″]/g, '"'],
              [/[–—−]/g, "-"], [/[·•]/g, "-"], [/…/g, "..."],
              [/[   ]/g, " "]];
  function clean(s) {
    s = String(s == null ? "" : s);
    SWAP.forEach(function (x) { s = s.replace(x[0], x[1]); });
    return s.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
  }

  /* What each report is called on paper, and what it covers, so somebody
     outside the transport team can tell what they are holding. */
  var TITLES = {
    outstanding: ["Minibus: outstanding actions",
                  "Buses stopped, renewals due, open defects, garage bookings, rota gaps and rota requests waiting."],
    fleet: ["Minibus: fleet and safety record",
            "Each bus's due dates, walkaround checks, defects, Vehicle Log work and recorded changes."],
    sunday: ["Minibus: Sunday service transport report",
             "The rota, each route's run, stops, seats booked, walkaround checks and defects for one Sunday."],
    summary: ["Minibus: transport summary for the period",
              "Sundays, runs, seats booked, checks, defects and costs, by route and by driver."]
  };

  var M = 14;            /* margin, mm */
  var FOOT = 10;         /* room kept at the bottom for the footer */
  var PAD = 1.4;         /* inside each cell */
  var SIZE = 8.5;        /* table text, pt */
  var LINE = SIZE * 0.3528 * 1.25;

  /* Column widths that fit the page: each column gets what its widest line
     needs if all of them fit, and otherwise an even share first, with what is
     left going to the columns that want more. */
  function widths(doc, cols, rows, avail) {
    var n = cols.length;
    var want = cols.map(function (c, i) {
      doc.setFont("helvetica", "bold");
      var w = doc.getTextWidth(clean(c));
      doc.setFont("helvetica", "normal");
      rows.forEach(function (r) {
        String(clean(r[i])).split("\n").forEach(function (l) { w = Math.max(w, doc.getTextWidth(l)); });
      });
      return w + 2 * PAD + 0.5;
    });
    var total = want.reduce(function (a, b) { return a + b; }, 0);
    if (total <= avail) return want.map(function (w) { return w * avail / total; });
    var share = avail / n;
    var got = want.map(function (w) { return Math.min(w, share); });
    var left = avail - got.reduce(function (a, b) { return a + b; }, 0);
    var need = want.map(function (w, i) { return w - got[i]; });
    var needAll = need.reduce(function (a, b) { return a + b; }, 0);
    return got.map(function (g, i) { return g + (needAll ? left * need[i] / needAll : 0); });
  }

  function reportPdf(rep, opt) {
    opt = opt || {};
    var J = root.jspdf.jsPDF;
    var land = rep.name === "fleet";
    var doc = new J({ orientation: land ? "landscape" : "portrait", unit: "mm", format: "a4", compress: opt.compress !== false });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var avail = W - 2 * M;
    var named = TITLES[rep.name] || [rep.title, ""];
    var title = clean(named[0]), what = clean(named[1]), period = clean(rep.period);
    doc.setProperties({ title: title + " - " + period, subject: "Contains names",
                        author: clean(opt.church || ""), creator: "Minibus coordinator app" });

    /* ---- the top of the first page: the app's own banner, then the title,
       what the report covers, its period, and who made it ---- */
    var bh = 24, lh = 16, tx = M;
    doc.setFillColor(27, 34, 44);
    doc.rect(0, 0, W, bh, "F");
    if (opt.logo) {
      try {
        var lw = lh * (Number(opt.logoW) || 1);
        doc.addImage(opt.logo, "JPEG", M, (bh - lh) / 2, lw, lh);
        tx = M + lw + 4;
      } catch (e) {}
    }
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(clean(opt.church || "RCCG Dominion Assembly"), tx, bh / 2 - 0.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(190);
    doc.text(clean(opt.place || "Liverpool - Transport"), tx, bh / 2 + 5);
    doc.setTextColor(0);
    var y = bh + 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    doc.text(title, M, y);
    y += 6;
    if (what) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60);
      var wl = doc.splitTextToSize(what, avail);
      doc.text(wl, M, y);
      y += wl.length * 4.6;
      doc.setTextColor(0);
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(period, M, y + 0.5);
    y += 4.8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
    doc.text(clean("Made " + (opt.made || "") + (opt.who ? " by " + opt.who : "")), M, y);
    doc.setTextColor(0);
    y += 3;
    doc.setDrawColor(150); doc.setLineWidth(0.4); doc.line(M, y, W - M, y);
    y += 6;

    var bottom = H - M - FOOT;
    function newPage() { doc.addPage(); y = M; }

    function rowHeight(cells, ws) {
      var most = 1;
      cells.forEach(function (c, i) { most = Math.max(most, doc.splitTextToSize(clean(c), ws[i] - 2 * PAD).length); });
      return most * LINE + 2 * PAD;
    }
    function drawRow(cells, ws, bold, fill) {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      var h = rowHeight(cells, ws);
      if (fill != null) { doc.setFillColor(fill); doc.rect(M, y, avail, h, "F"); }
      var x = M;
      cells.forEach(function (c, i) {
        var lines = doc.splitTextToSize(clean(c), ws[i] - 2 * PAD);
        doc.text(lines, x + PAD, y + PAD + LINE * 0.78, { lineHeightFactor: 1.25 });
        x += ws[i];
      });
      doc.setDrawColor(210); doc.setLineWidth(0.15); doc.line(M, y + h, W - M, y + h);
      y += h;
    }

    (rep.sections || []).forEach(function (sec) {
      var cols = (sec.cols || []).map(clean);
      var rows = (sec.rows || []).map(function (r) { return r.map(function (c) { return clean(c); }); });
      doc.setFontSize(SIZE);
      var ws = widths(doc, cols, rows, avail);
      var first = rows.length ? rowHeight(rows[0], ws) : LINE;
      if (y + 8 + rowHeight(cols, ws) + first > bottom) newPage();
      doc.setFont("helvetica", "bold"); doc.setFontSize(11.5);
      doc.text(clean(sec.head), M, y + 4);
      y += 7;
      doc.setFontSize(SIZE);
      if (!rows.length) {
        doc.setFont("helvetica", "normal"); doc.setTextColor(90);
        doc.text(clean(sec.empty || "None."), M, y + 3.5);
        doc.setTextColor(0);
        y += 9;
        return;
      }
      drawRow(cols, ws, true, 232);
      rows.forEach(function (r, i) {
        if (y + rowHeight(r, ws) > bottom) { newPage(); doc.setFontSize(SIZE); drawRow(cols, ws, true, 232); }
        drawRow(r, ws, false, i % 2 ? 247 : null);
      });
      y += 6;
    });

    /* ---- every page's foot ---- */
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
      doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(M, H - M - 4, W - M, H - M - 4);
      doc.setFont("helvetica", "bold");
      doc.text("Contains names", M, H - M);
      doc.setFont("helvetica", "normal");
      doc.text(title + " - " + period, W / 2, H - M, { align: "center" });
      doc.text("Page " + p + " of " + n, W - M, H - M, { align: "right" });
      doc.setTextColor(0);
    }
    return doc;
  }

  /* The file's name: what it is and when it covers, so a folder of them
     sorts and reads. */
  function reportFileName(rep) {
    var when = rep.name === "outstanding" || rep.from === rep.to ? (rep.from || "") : rep.from + " to " + rep.to;
    var t = (TITLES[rep.name] || [rep.title])[0].replace(/^Minibus: /, "");
    return "Minibus - " + clean(t.charAt(0).toUpperCase() + t.slice(1)) + " - " + when + ".pdf";
  }

  root.reportPdf = reportPdf;
  root.reportFileName = reportFileName;
  root.reportClean = clean;
})(typeof window !== "undefined" ? window : this);
