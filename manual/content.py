"""The Minibus Driver's Manual.

Words in **double stars** are exactly what the app shows; check_quotes.py
holds every one of them to the code. __Double underscores__ are ordinary
bold. {COORD}, {PHONE}, {OTHER} and {LEADS} are filled in from the
spreadsheet download (see kit.md), so no name or number of the coordinator's
is written here. Written for app v1.87.0; read it against the release before
each rebuild, above all "New since the last manual"."""
import json, os
from kit import *

S = []                      # the story
def add(*fl):
    for f in fl:
        if isinstance(f, list): S.extend(f)
        else: S.append(f)

def part(n, title, newpage=True):
    name = ("%s  %s" % (n, title)) if n else title
    if newpage: add(PageBreak())
    add(Section(name), heading(("%s %s" % (n, title)) if n else title, H1, 0))
def sec(n, title):
    add(CondPageBreak(60), heading("%s %s" % (n, title), H2, 1))
def sub(title): add(CondPageBreak(40), P(title, H3))
def p(t): add(P(t))
def bl(*items): add(bullets(list(items)))
def nl(*items): add(numbered(list(items)))
def imp(t): add(box("important", t))
def good(t): add(box("good", t))
def coord(t): add(box("coord", t))

CL = json.load(open(os.path.join(BUILD, "checklist.json")))
REAL = json.load(open(os.path.join(BUILD, "real.json")))
SHARE = open(os.path.join(SHOTS, "share.txt")).read()

# ============================================================== cover
class Cover(Flowable):
    def wrap(self, aw, ah): return (PAGE_W, PAGE_H)
    def draw(self):
        c = self.canv
        top = PAGE_H * 0.63
        c.setFillColor(DARK); c.rect(0, top - 30, PAGE_W, PAGE_H - top + 30, stroke=0, fill=1)
        c.setFillColor(YELLOW); c.roundRect(ML, PAGE_H - 92, 74, 22, 3, stroke=0, fill=1)
        c.setFillColor(DARK); c.setFont("Carlito-Bold", 11); c.drawCentredString(ML + 37, PAGE_H - 85, "DRIVER")
        c.setFillColor(colors.white); c.setFont("Carlito-Bold", 27)
        c.drawString(ML, PAGE_H - 132, "Minibus")
        c.drawString(ML, PAGE_H - 162, "Driver’s Manual")
        c.setFont("Carlito", 9.5); c.setFillColor(colors.HexColor("#d1d5db"))
        c.drawString(ML, PAGE_H - 186, "RCCG Dominion Assembly Liverpool · Transport")
        c.setFont("Carlito", 8); c.setFillColor(colors.HexColor("#9ca3af"))
        c.drawString(ML, PAGE_H - 206, "Every screen, every button and every message in the driver app,")
        c.drawString(ML, PAGE_H - 216, "for regular drivers and for anyone covering.")
        ph = Phone("hub-cover", 112, marks=False)
        w, h = ph.wrap(0, 0)
        ph.canv = c
        c.saveState(); c.translate(PAGE_W - MR - w, PAGE_H - 250 - h); ph.draw(); c.restoreState()
        y = PAGE_H - 262
        c.setFont("Carlito-Bold", 8.4); c.setFillColor(TEXT)
        for t in ["Before your first Sunday", "Signing in", "The home screen", "The vehicle check",
                  "Stops and bookings, and the run", "The driving rota", "No signal", "For coordinators",
                  "Every message, A to Z", "When something goes wrong", "The checklist, and the routes"]:
            c.drawString(ML, y, t); y -= 15
        c.setFont("Carlito", 7.2); c.setFillColor(MUTED)
        c.drawString(ML, 64, "For the driver app at drolnstone.github.io/minibus-check")
        c.drawString(ML, 54, "Written for " + VERSION)
        c.drawString(ML, 44, __import__("datetime").date.today().strftime("%B %Y"))

add(NextPageTemplate("cover"), Cover(), NextPageTemplate("body"))

# ============================================================== how to use
part("", "How to use this manual")
p("This is the manual for the minibus driver app, the one you open on your phone to check the bus, run the route "
  "and see the rota. It is written for every driver on the register, whether you drive most Sundays or are covering "
  "for somebody once.")
p("Read Parts 1 to 5 before your first Sunday. After that, keep it for looking things up: Part 9 lists every message "
  "the app can show you, with what it means and what to do, and Part 10 goes through the things that can go wrong.")
sub("How the manual is written")
bl("Words in **dark bold** are exactly what the app shows. The phone shows many buttons and headings in CAPITALS; this "
   "manual writes them normally, so **Vehicle check** on the page is VEHICLE CHECK on your phone.",
   "The pictures are the real app, photographed with the real buses, stops and times. The driver in them is **Bro "
   "Sample**, who does not exist. The faults, readings and bookings are examples.",
   "A red number on a picture matches the numbered note beside it.",
   "Boxes headed **Coordinators** are for the Coordinator, the Assistant Coordinator and the Minister in Charge only. "
   "Nobody else sees those buttons.")
sub("The one number you need")
p("The coordinator is **{COORD}**, on **{PHONE}**. Whenever the app tells you to ring the coordinator, this is who "
  "it means, and its **Call** buttons ring this number. The app takes his name and number from the Drivers tab of the "
  "coordinator’s spreadsheet, so if the coordinator ever changes, the app changes with him.")
imp("A critical defect stops the bus. If the check finds one, nobody boards until the coordinator has been rung. Nobody "
    "will be upset with you for stopping the bus.")
sub("New since the last manual")
p("If you read the manual for app v1.74.9, these are the changes:")
add(bullets(["Two more checklist items, 37 in all, and a grey **DVSA daily check** tag (section 4.4).",
             "One time on each stop: __bold__ is when the bus is now expected, plain is the timetable (section 5.5).",
             "The running line says **2 minutes behind schedule** (section 5.5).",
             "**Time to set off** on your phone at the departure time (section 5.10).",
             "A covering driver can reopen a run the app ended, even after closing the app (section 5.6)."], SMALL))

# ============================================================== contents
add(PageBreak(), Section("Contents"), P("Contents", H1), toc())

# ============================================================== 1
part("1", "Before your first Sunday")
sec("1.1", "What the app does")
p("The app does three jobs, and each has its own button on the home screen.")
add(table(["Button", "What it is for"], [
    ["**Vehicle check**", "The walkaround you do at the bus before anyone gets on. It goes on the record in your name, with "
     "the time and where you were. A fault that makes the bus unsafe stops the bus."],
    ["**Stops and bookings**", "How many have booked, at which stop, on which route. On Sunday it is also where you start "
     "the run, mark each stop as you leave it, and end the run at church."],
    ["**Driving rota**", "Who drives which route on which Sunday, with the bus for each. It is also where you ask the "
     "coordinator for a change."]], [1, 2.6]))
p("Your taps during the run do more than keep a record. Passengers who have booked watch the bus come on their own "
  "phones, and their page moves on each time you mark a stop. When every run that had bookings has ended, the morning "
  "closes and next Sunday opens for booking.")
sec("1.2", "Opening the app")
p("The app is a web page. Open it in Chrome on an Android phone or Safari on an iPhone:")
p("__drolnstone.github.io/minibus-check__")
p("There is nothing to download from an app store. Once it has opened once, it keeps working when you have no signal. "
  "Section 1.3 puts it on your home screen like any other app.")
sec("1.3", "Add it to your phone")
p("The first time you open the app it offers to put itself on your home screen. Do it. It then opens full screen like "
  "any other app, and on an iPhone it is the only way to get reminders.")
add(figure("install-android", "The offer on an Android phone", [
    P("The sheet shows the steps for your kind of phone. The steps for other phones are folded underneath."),
    P("__On an Android phone__"),
    *numbered(["Tap the **⋮** menu, top right.", "Tap **Install app**, or **Add to Home screen**.", "Tap **Install**."]),
    P("Some phones show an **Install** button at the top of the sheet. That does the same thing in one tap.")]))
add(figure("install-iphone", "The offer on an iPhone", [
    P("__On an iPhone or iPad__"),
    *numbered(["Tap the **Share** button, the square with an arrow coming out of the top.",
               "Scroll down and tap **Add to Home Screen**.", "Tap **Add**."]),
    P("This only works in Safari. In Chrome, Firefox or Edge on an iPhone the sheet says **Open this address in Safari "
      "first. On an iPhone only Safari can do this.**"),
    P("__On a computer:__ in Chrome or Edge, look in the address bar for the install icon, or open the **⋮** menu, "
      "and choose **Install**.")]))
p("The sheet appears by itself only once on each phone. When it pops up by itself its button says **Not now**; when you "
  "open it yourself it says **Done**. Until the app is installed, the first screen has an **Add to your phone** link at "
  "the very bottom that opens the same sheet.")
sec("1.4", "Your PIN")
p("Every driver has a four digit PIN. The coordinator sets it and tells you what it is. You key it each time you open "
  "the app, because the check and the run are recorded in your name and the PIN is what shows it was you.")
bl("Nobody can read your PIN, not even the app. The phone sends what you type to be checked and gets back yes or no.",
   "Once your PIN has been checked on a phone, that phone can check it again with no signal.",
   "Forgotten it? The app says **Forgotten your PIN? Ask the coordinator.** That is the only way to get it.",
   "If a driver has no PIN in the spreadsheet, the app does not ask him for one.")
sec("1.5", "Reminders")
p("The app can send your phone a reminder to end the trip if the run is still open after the bus should be back at "
  "church, and a few other things on a Sunday morning (section 5.10). It is worth turning on: a run left open keeps the "
  "passenger page showing a bus on the road and holds back next Sunday’s bookings.")
add(figure("remind-offer", "The offer, on the home screen", [
    P("The first time you reach the home screen each time you open the app, it asks **Remind you to end the trip?** "
      "Tap **Turn on**."),
    P("Your phone then asks whether to allow notifications. Choose **Allow**. The app says **Reminders on.**"),
    P("**Not now** closes the offer. It asks again next time you open the app. Until reminders are on, the home screen "
      "also shows **Remind me to end the trip. Turn on**."),
    P("The offer never appears over the vehicle check.")]))
add(figure("remind-bell", "Reminders on: the bell", [
    "The bell appears beside the heading once reminders are on. Tap it any time to send yourself a test.",
    ] ))
p("The app says **Asking…**, then **Sent. Give it a few seconds.** and the test arrives: **Alerts are working · "
  "Nothing has happened to the bus.** **Not sent:** followed by a reason means the reminder service refused. Try "
  "**Turn on** again, or show the coordinator. **Could not ask for a test.** means no signal, or reminders were never "
  "set up on this phone.")
sub("On an iPhone")
p("Apple only lets an app send reminders once it is on the Home Screen. Until then the offer reads **Add this app to "
  "your Home Screen** with a **Show me how** button, and the home screen says **Add this app to your Home Screen to get "
  "reminders.** Add it (section 1.3), open it from the Home Screen, and the ordinary **Turn on** offer appears.")
add(figures([("iphone-offer", "iPhone in Safari: the offer"), ("iphone-line", "iPhone in Safari: the line on the home screen")]))
sub("If it will not turn on")
bl("**Not turned on.** You said no when the phone asked. If you chose **Block**, the offer disappears from this phone. To "
   "change your mind, allow notifications for the app in your phone’s settings.",
   "**Could not turn reminders on.** Usually no signal. Try again with signal.")
good("Turn reminders on with your own name signed in, on the phone you carry on a Sunday. They are sent for the runs the "
     "rota gives that name.")
sec("1.6", "Appearance")
p("At the bottom of the first screen are five buttons: **Auto**, **Light**, **Dark**, **Green** and **Navy**. **Auto** "
  "follows your phone’s own light or dark setting. The choice is kept on this phone only.")
add(figures([("theme-dark", "Dark"), ("theme-green", "Green"), ("theme-navy", "Navy")]))
sec("1.7", "Hold the phone upright")
p("The app works with the phone upright. Turned on its side, it covers itself with **Turn your phone upright.** Turn it "
  "back and carry on; nothing is lost.")
sec("1.8", "Which version you have")
p("The very bottom of the first screen shows the version, for example **" + VERSION + "**. If the coordinator asks which "
  "version you have, read him this line. Tap it to see the three numbers in a box.")
p("The app updates itself. When a new version arrives while it is open, the page reloads once on its own. Your name is "
  "kept for the rest of the day; your PIN is not, so key it again.")

# ============================================================== 2
part("2", "Signing in")
p("The app always opens on **Who is driving?**. Choosing your name and keying your PIN here is what lets the app put the "
  "check and the run in your name.")
sec("2.1", "Who is driving?")
add(figure("first-screen", "The first screen", [
    "**Driver name**. Tap it and choose your name from the list. Only drivers on the register are listed.",
    "**Name missing? Ring the coordinator before taking a bus out.** If your name is not in the list, you are not on "
    "the register yet.",
    "Appearance: **Auto**, **Light**, **Dark**, **Green**, **Navy** (section 1.6).",
    "The version line (section 1.8).",
    "**Add to your phone**, until the app is installed (section 1.3).",
    "**Continue** goes to the home screen. The small line above it says what is still missing: **Choose your name**, "
    "or **PIN not keyed yet**."]))
sub("The very first time on a new phone")
add(figure("first-open", "Before the list of names has arrived", [
    "The list of names comes from the Drivers tab, with the rota. Until a phone has had it once, the name is a box to "
    "type in, **Your full name**, with **No driver register has been set up yet.** under it."
    ]))
p("With signal, the list arrives a second or two later and the box turns into the list. If it stays a box, the phone "
  "has no signal: find signal and open the app again, so that you can choose your name from the list. After the first "
  "time the phone keeps its own copy, so this does not happen again on that phone.")
sec("2.2", "Keying your PIN")
add(figure("pin-box", "Name chosen: the PIN box opens", [
    "Your name.",
    "**PIN**. Type your four digits. There is no button to press: the app checks as soon as the fourth digit is in.",
    "The line under your name. It says **Forgotten your PIN? Ask the coordinator.** until there is something else to say."]))
p("When the PIN is right, the app goes on to the home screen by itself about half a second later. You do not need to "
  "press **Continue**. While it checks, the line reads **Checking…**. Everything else it can say is in this table.")
add(table(["The line says", "What it means", "What to do"], [
    ["**That PIN is not right.**", "The PIN does not match.", "Key it again, carefully."],
    ["**That PIN is not right. 2 more tries before it pauses.**", "Wrong, and it is counting.", "Stop and check the number before trying again."],
    ["**Too many wrong tries. Wait 5 minutes, or ring the coordinator.**", "Three wrong tries in a row pause that name for five minutes.", "Wait, or ring the coordinator."],
    ["**Checked against this phone’s own copy.**", "No signal, but this phone has checked your PIN before, and it matches.", "Nothing. Carry on."],
    ["**No signal to check the PIN. Carry on: the record will show it was not checked.**", "No signal, and this phone has never checked your PIN.", "Carry on. The record will say the PIN was not checked."],
    ["**That PIN has been changed. Key the new one.**", "The phone accepted your old PIN from its own copy, then the record said it has changed.", "Key your new PIN. Ask the coordinator if you do not know it."]],
    [1.25, 1.2, 1]))
add(figures([("pin-wrong", "A wrong PIN"), ("hub-nopin", "Signed in, PIN not keyed")]))
p("You can go on to the home screen without keying your PIN. You can read the rota and the stops, but **Vehicle check** "
  "stays faded until the PIN is in (section 3.2), and starting the run or marking a stop will ask for it (section 5.4).")
sec("2.3", "The line under your name")
p("Sometimes a second line appears under your name on the first screen:")
bl("**Rota has Bro Adebola on North and Bro Tunde on South this Sunday.** You are not on the rota for this Sunday. If "
   "you think you should be, ring the coordinator.",
   "**Your North run is still open. End trip when you are back.** You started a run on this phone today and have not "
   "ended it. It shows when you come back to this screen from **Stops and bookings** (section 5.7).")
sec("2.4", "What the phone remembers")
bl("__Your name, until midnight.__ Close the app and open it again the same day and your name is already chosen. The next "
   "day it is gone, so the phone never files anything under yesterday’s driver.",
   "__Never your PIN.__ You key it each time you open the app. It is also cleared when you finish a check and tap "
   "**Done** (or **Check another bus**, **Do the check**, or **Back** on **Waiting to send**), so the next check is keyed "
   "again. It is answered at once, even with no signal, because the phone keeps its own check of it.",
   "__Its own copy of the rota, the list of names, the stops and the bookings__, and the coordinator’s name and "
   "number, so every screen draws straight away and works with no signal. Each is refreshed whenever the phone can reach "
   "the record.")
sec("2.5", "Changing driver")
p("To hand the phone to another driver, tap **Change driver** at the bottom of the home screen, or **Not you?** on "
  "**Stops and bookings**. Both go back to **Who is driving?**. Choosing a different name clears the PIN, so the new "
  "driver keys his own.")
imp("Two drivers sharing a phone must each choose their own name. Whatever is done on the phone is recorded under the "
    "name that is chosen.")

# ============================================================== 3
part("3", "The home screen")
p("After **Who is driving?** comes the home screen, headed **What are you doing?**. Everything else starts here.")
sec("3.1", "What are you doing?")
add(figure("hub", "The home screen", [
    "**Signed in as Bro Sample**. Your name. If it says **Nobody signed in**, go back and choose it.",
    "The reminders line (section 1.5). Once reminders are on it goes, and a bell appears beside the heading.",
    "**Driving rota**. Part 6.",
    "**Stops and bookings**. Part 5.",
    "**Vehicle check**. Part 4. The filled button is the one you most likely want.",
    "**Works with no signal. Checks send themselves when you are back in range.**",
    "**Change driver** goes back to **Who is driving?**."]))
p("One button is filled in, the rest are outlined. Normally the filled one is **Vehicle check**. Once the phone knows "
  "bookings have closed for the day, **Stops and bookings** becomes the filled one instead, because that is what you "
  "want next.")
coord("A coordinator’s home screen has one more button, **Coordinator**, on a line of its own above **Driving rota**. "
      "It opens the coordinator’s app (section 8.6). Drivers never see it.")
sec("3.2", "When Vehicle check is faded")
p("A check is recorded in your name, so it needs your name and your PIN. Until it has both, **Vehicle check** is faded "
  "and a line says why:")
bl("**PIN not keyed. Vehicle check needs it. Key it now.** Tap **Key it now** and the app goes back to the first screen "
   "with the PIN box ready.",
   "**Nobody signed in. Vehicle check needs a name. Choose yours.** Tap **Choose yours** to pick your name.")
p("Tapping the faded button does the same thing and says **Key your PIN first.** or **Choose your name first.**")
add(figures([("hub-pinline", "PIN not keyed"), ("hub-nobody", "Nobody signed in"), ("hub-waiting", "A check waiting to send")]))
sec("3.3", "Checks waiting to send")
p("If a check could not be sent, for example because there was no signal at the bus, the phone keeps it and sends it "
  "later by itself. While it waits:")
bl("A banner across the top of every screen says **1 check not sent yet.** with a **Send now** button.",
   "The home screen has an extra amber button, **1 waiting to send**, beside **Vehicle check**.")
p("Section 4.9 explains what to do. In short: nothing, except keep the app and let it send once you have signal.")
sec("3.4", "The bar across the top")
p("The dark bar at the top of every screen is the bus’s instrument panel. It shows which bus you are checking and how "
  "far you have got.")
add(strip("bar-none", "No bus chosen yet"))
add(strip("bar-checking", "Checking NH56 FWP: nothing found so far"))
add(strip("bar-amber", "A defect or advisory noted: amber"))
add(strip("bar-red", "A critical defect: red, with Do not run and the Call button"))
bl("The plate shows the registration of the bus you chose. Before you choose one it reads **Fleet**.",
   "The heading says what you are doing: **Vehicle check**, the registration, or during the walkaround **3 of 37 checked**.",
   "The line under it gives the bus’s name, or once you have found something, **1 defect noted**, **1 advisory note** "
   "or **1 critical defect**.",
   "Three lamps on the right. Green when every item is answered and nothing was found. Amber for a defect or advisory. "
   "Red for a critical defect.",
   "A thin line under the bar fills as you go through the checklist.")
p("When the check finds a critical defect, the whole bar turns red and a second part opens under it: **Do not run**, the "
  "item that failed, **Ring the coordinator before anyone boards.**, and a button **Call {COORD} · {PHONE}** "
  "that rings him. It stays on every screen until you tap **Done** at the end of the check. Section 4.8 says what to do.")

# ============================================================== 4
part("4", "The vehicle check")
p("The vehicle check is the walkaround you do at the bus before anyone gets on. It is the part of the app that matters "
  "most. It goes on the record in your name, with the time, the mileage and where you were, and it is what shows the bus "
  "was fit to carry people that morning.")
bl("Do it at the bus, before the first pick up, with the keys in your hand.",
   "It takes about ten minutes. You answer 37 items in four stages, then sign.",
   "It works with no signal. A check that cannot send is kept on the phone and sends itself later.",
   "Anyone doing the check must be signed in with their PIN keyed (Part 2).")
p("Start it from the home screen with **Vehicle check**.")
sec("4.1", "Choosing the bus")
add(figure("vehicles", "Which one today?", [
    "**Hello Bro Sample**. Your name, so you know whose check this is.",
    "A card for each bus: the plate, the model and its details. **Yours today** marks the bus the rota gives your route. "
    "On a weekday it says **Yours this Sunday**.",
    "The other bus carries its route instead: **South today** or **South this Sunday**.",
    "**Continue** goes on once you have tapped a bus. Until then the line above it says **Choose a vehicle**."]))
p("The bus the rota gives you is always at the top. Tap the card of the bus you are standing at, then **Continue**. A "
  "card can also show:")
bl("**Renewal due soon** in amber: its MOT, service, insurance or parking permit runs out within 30 days.",
   "**Renewal overdue** in red: one of those dates has already passed. Tell the coordinator.")
imp("Tapping a bus card starts that bus’s check afresh, even the one already chosen. Any mileage and answers you had "
    "entered are cleared. Choose once, then use **Continue**.")
sec("4.2", "Not the bus you were given")
add(figure("bus-ask", "The question, when you choose the other bus", [
    P("If the rota has given your route one bus and you tap the other, the app asks once, under **Today’s bus**: "
      "**Not the bus you were given** and **The rota has NH56 FWP for North today.**"),
    P("**Stay with YS70 PWE** keeps the bus you chose. **Take NH56 FWP** switches to the rota’s bus."),
    P("Either button carries on to the next screen. There is often a good reason to take the other bus, and the app does "
      "not stop you. Tap outside the sheet to go back and choose again.")]))
sec("4.3", "Before you start")
add(figure("prep", "Before you start", [
    "The bus you are checking: registration and model.",
    "**Still open on this bus**. Faults reported on earlier checks that nobody has closed yet. Read them first: they are "
    "what to look at hardest.",
    "**Mileage now**. Type what the dashboard shows.",
    "The last reading on the record, to compare with.",
    "**Fuel showing**. Tap the part of the bar that matches the fuel gauge.",
    "**Where you are**. The phone takes one location for the record."]))
p("At the bottom: **Back** to choose another bus, and **Start the check**, which goes on once the mileage and fuel are in.")
sub("Renewals")
add(figure("prep-renewal", "A renewal coming up, with a phone away from the buses", [
    "**Renewal coming up**, or **Renewal overdue** in red.",
    "Where you are when the phone is not at the buses (see below)."]))
p("When the MOT, service, insurance or parking permit is due within 30 days, a box at the top lists it: for example "
  "**Parking permit**, **Due in 21 days · 18/10/2026**. Other wordings are **Due today** and **Expired 3 days ago**. "
  "The dates come from the Buses tab of the coordinator’s spreadsheet.")
p("The box does not stop the check. If anything says expired, tell the coordinator before you drive.")
sub("Still open on this bus")
p("Each line is one item with a fault that has not been closed in the spreadsheet: the item’s name, then the note from "
  "the last report. **critical** marks an item that stops the bus; **advisory** marks one that was only ever reported as "
  "worth watching; **3 reports** means it has been reported three times. Critical items come first. Up to six are "
  "shown, then **and 2 more**.")
p("The box needs one download from the record since the app was opened. With no signal at all it may not appear. That "
  "does not stop the check.")
sub("Mileage")
p("Read the odometer and type the whole number, no commas. The line under the box shows the last reading, for example "
  "**Last recorded: 48,213 on 20/09/2026 at 09:41 by Bro Moses · 49 since**. The **since** figure is how far the bus "
  "has gone since then.")
p("If the line ends **this phone’s last copy, not just checked**, the phone could not reach the record and is showing "
  "the last reading it kept. That is fine.")
add(figure("prep-lower", "A reading lower than the last one", [
    P("The app questions a reading that cannot be right:"),
    P("**That is LOWER than the last reading of 48,213 on 20/09/2026. An odometer does not go backwards, so one of the "
      "two is wrong.**"),
    P("**That is 1,687 miles since 20/09/2026. That is a long way for this bus. Check you have not added a digit.** "
      "(more than 1,500 miles)"),
    P("Read the dashboard again. If you typed it wrong, correct it and the warning goes. If the dashboard really does say "
      "it, tick **I have read it twice and the dashboard really does say this** to carry on. The record marks the "
      "reading so the coordinator can look into it.")]))
sub("Fuel")
p("The bar has eight parts, marked **E**, **¼**, **½**, **¾** and **F**, with blank parts for the eighths in "
  "between. Tap the part that matches the gauge. Tap the same end part again to clear it.")
bl("At ¼ or below: **Low. Fill up before you set off.** in red.",
   "At 3/8: **Getting low. Worth filling.**",
   "A low tank never stops the bus. At ¼ or below, **Needs fuel** is ticked for you at the end of the check.")
sub("Where you are")
p("When this screen opens, the phone takes one location to show the check was done at the bus. It is not tracking: "
  "nothing is recorded between checks. The first time, your phone asks whether to allow it. Please allow it. Whatever "
  "happens, the check still counts.")
add(table(["The line says", "What it means"], [
    ["**Finding you…**", "Still waiting for the phone."],
    ["**Recorded to within 9 yd. You are at the buses.**", "Done."],
    ["**Recorded to within 13 yd. You are about 1.5 miles from where the buses are kept.** (amber)", "The phone is not at the buses in Chester Road. Do the check at the bus."],
    ["**Location turned off for this app. The check still counts, and the record will show it was not given.**", "You said no to location. Allow it in your phone’s settings next time."],
    ["**Could not get a location in time. Carry on: the record will show it was not available.**", "No fix within 20 seconds."],
    ["**No location available here. Carry on: the record will show it was not available.**", "The phone could not find itself."],
    ["**This phone cannot give a location. Carry on as normal.**", "An old phone or browser."]], [1.7, 1]))
add(figure("prep-ready", "Ready to start", [
    "The reading is in and the **since** figure looks right.",
    "Fuel tapped.",
    "Location recorded.",
    "**Start the check** is lit."]))
p("If **Start the check** is faded, the line above it says what is missing: **Enter the mileage**, **Check the mileage** "
  "(a warning not yet ticked) or **Tap the fuel gauge reading**. Tapping the faded button takes you to the part that "
  "needs doing.")
sec("4.4", "The walkaround")
p("The checklist comes in four stages, in the order you walk round the bus:")
add(table(["Stage", "Heading", "What the app says"], [
    [str(i + 1), "**%s**" % s["title"], "**%s**" % s["lede"]] for i, s in enumerate(CL["stages"])], [0.5, 1.4, 2.6]))
add(figure("stage1", "Stage 1 of 4", [
    "The four stages. The one you are on is highlighted.",
    "**Stage 1 of 4 · NH56 FWP**.",
    "How to go about this stage.",
    "Each item: its name, then what to check, in plain words.",
    "**Stops the bus** marks a safety critical item (see below).",
    "Your answer: **Fine**, **Advisory** or **Defect**.",
    "What is still to do: **15 left in this stage**.",
    "**DVSA daily check** marks an item on DVSA’s daily walkaround check (see below)."]))
p("The bar at the top counts as you go: **0 of 37 checked**.")
add(table(["Answer", "Use it when", "What happens"], [
    ["**Fine**", "Nothing to report.", "The item turns green and the screen moves on to the next item."],
    ["**Advisory**", "Worth watching, but not a fault. A tyre wearing faster than the others; a blade starting to smear.",
     "The item turns blue and a note box opens. The bus still runs. It goes on the record and to the coordinator."],
    ["**Defect**", "A fault. Something broken, missing, leaking or not working.",
     "The item turns amber and a note box opens. On a **Stops the bus** item it turns red and the bus does not run "
     "(section 4.8)."]], [0.8, 1.6, 1.8]))
p("You can change an answer at any time by tapping a different one. If you go back to **Fine**, the note is dropped from "
  "the record; what you typed comes back if you choose **Defect** or **Advisory** again.")
sub("Saying what you found")
add(figures([("adv-tyres", "**Advisory** on Tyres, with its note"), ("defect-body", "**Defect** on Body and glass")]))
p("**Defect** and **Advisory** both open a box, **What did you find?**, with the cursor already in it. Write a few plain "
  "words, enough for whoever books the bus in: **Nearside rear wearing on the outer edge**, **Small chip in the screen, "
  "passenger side**. The note must be at least three letters long before the stage will move on.")
sub("Items that stop the bus")
crit = [it["name"] for s in CL["stages"] for it in s["items"] if it.get("crit")]
p("%s items are marked **Stops the bus**: %s and %s. A **Defect** on any of them stops the bus. An **Advisory** on one of "
  "them does not: it is recorded and the coordinator is told, and the bus runs." %
  ({12: "Twelve"}.get(len(crit), str(len(crit))), ", ".join(crit[:-1]), crit[-1]))
sub("DVSA daily check")
p("Most items carry a quiet grey tag, **DVSA daily check**: %d on NH56 FWP and %d on YS70 PWE, which has AdBlue. They are "
  "the items on the daily walkaround check that DVSA, the Driver and Vehicle Standards Agency, publishes for buses and "
  "coaches. The tag says why the item is on the list. It is not a warning, and you answer the item the same way as any "
  "other. Appendix A marks them." % (CL["NH56 FWP pre"]["dvsa"], CL["YS70 PWE pre"]["dvsa"]))
p("Two of them are new to the list: **Mudflaps and spray guards**, near the end of stage 1, and **Driver's seat and "
  "belt**, near the end of stage 4.")
add(figures([("mudflaps", "**Mudflaps and spray guards**, stage 1"), ("driver-seat", "**Driver's seat and belt**, stage 4")]))
sub("Known history")
add(figure("known-history", "An item with Known history", [
    "**Known history**.",
    "An amber line starting **On this bus:**. It is what past MOTs and checks have found on this particular bus, written "
    "as what to do: for example **Check the lenses themselves for cracks, not only that the bulbs light up.** Give these "
    "items extra care. Appendix A lists every one for both buses."]))
sub("Moving on")
p("At the bottom: **Back** (to the previous stage, or from stage 1 to **Before you start**) and **Next stage**, which on "
  "stage 4 reads **Review**. It stays faded until every item on the stage is answered and every **Defect** and "
  "**Advisory** has its note. The line above it says what is left:")
bl("**15 left in this stage**", "**Describe what you found on Body and glass**", "**2 items still need a note**",
   "**Stage complete**")
p("Tapping it while faded shows the same words. Your answers are kept if you go back a stage.")
sec("4.5", "Before you sign")
add(figure("review", "Before you sign", [
    "The verdict: what the check found, in one box.",
    "**Anything to arrange?** Tap what the bus needs, or **Nothing needed**."]))
p("The verdict is one of four:")
add(table(["Verdict", "When", "It says"], [
    ["**No defects found** (green)", "Everything **Fine**.", "**Everything checked and clear. Sign below and the bus is good to go.**"],
    ["**Safe to drive** (amber)", "Advisories only.", "**Nothing to fix. These are on the record to watch.** and the advisories."],
    ["**Safe to drive, with defects** (amber)", "Defects, none on a **Stops the bus** item.", "**Nothing critical, but these are on the record now and need booking in.** and the list."],
    ["**The bus does not run** (red)", "A **Defect** on a **Stops the bus** item.",
     "**A safety critical item has failed. Do not carry passengers. Ring the coordinator and arrange lifts. Nobody will be "
     "upset with you for stopping the bus.** and a **Call {COORD}** button."]], [1.2, 1, 2]))
add(figure("review-signed", "Ready to sign", [
    "**Anything to arrange?**: **Needs a wash**, **Inside needs a clean**, **Needs fuel**, **Tyres need air**, or "
    "**Nothing needed**. Tap as many as apply. These are jobs, not defects.",
    "The summary of the check: **Check**, **Vehicle**, **Date**, **Driver**, **Mileage**, **Fuel**, **Items checked**, "
    "**Defects** and **Advisory**.",
    "**Type your name to sign**. This records that you did the check yourself, today.",
    "**Sign and send**."]))
p("**Sign and send** goes on when something is chosen under **Anything to arrange?** and your name is typed. If it is "
  "faded, the line above it says **Anything to arrange?** or **Type your name to sign**.")
sec("4.6", "Finished")
add(figure("complete", "Check complete", [
    "**Check complete**, or **Bus stopped** if the check stopped the bus.",
    "Whether it has reached the record (see below).",
    "The verdict again, and the summary.",
    "**Start your run**, if you are on the rota today. It opens **Stops and bookings**.",
    "**Done** goes back to the home screen and clears the check from the phone."]))
p("Under the summary: **Share a copy**, **Try sending again** (only when it has not sent), and **You are on North today.** "
  "when the rota has you driving. The box near the top says where the check has got to:")
bl("**Sending** · **Writing this check to the record.** On a poor signal it can take a while.",
   "**On the record** · **Saved to the coordinator’s sheet. Nothing else to do.** Finished.",
   "**Held on this phone** · the check could not be sent yet. See section 4.9.")
p("**Share a copy** opens your phone’s share menu with the check written out as text, ready for WhatsApp or a message. "
  "If your phone has no share menu it copies the text (**Copied.**) or asks you to take a screenshot. It works with no "
  "signal. The text reads like this:")
add(mono(SHARE))
p("When you tap **Done**, the check is cleared and so is your PIN. The next check, or starting the run, asks for the PIN "
  "again. The phone’s own back button does the same as **Done** on this screen.")
sec("4.7", "Your check and the run")
p("Starting the run (Part 5) looks for today’s check of the bus you are taking. It counts the last check made on this "
  "phone today under the name now signed in, even if it is still waiting to send. It also counts any check of that bus "
  "that has reached the record, whoever made it and on whichever phone. With no check at all, it asks you to do one "
  "first (section 5.4).")
sec("4.8", "When the check stops the bus")
add(figures([("crit-tyres", "**Defect** on Tyres"), ("bus-not-run", "The bus does not run"), ("bus-stopped", "Bus stopped")]))
p("A **Defect** on a **Stops the bus** item stops the bus straight away:")
bl("The app says **Critical defect. The bus does not run. Tap Call at the top.**",
   "The top bar turns red: **Do not run**, the item, **Ring the coordinator before anyone boards.**, and **Call {COORD} "
   "· {PHONE}**.",
   "The last button reads **Sign and stop the bus** instead of **Sign and send**. Finish the check and sign it: the record "
   "needs it.",
   "After sending, the app says **Sent. Now ring the coordinator.** and the screen is headed **Bus stopped**.",
   "On **Stops and bookings** the bus has no Start button. It says **NH56 FWP was stopped by today’s check.** **Ring {COORD}.** "
   "This shows on every phone once the check has reached the record, whoever did it.")
sub("What to do")
nl("Nobody gets on the bus.",
   "Ring the coordinator with the **Call** button, or on {PHONE}.",
   "Arrange lifts, or the other bus, as the coordinator decides. Which bus goes out is his call.",
   "If the coordinator authorises the bus to run, your **Stops and bookings** screen changes to **NH56 FWP is authorised "
   "to run by {COORD}. The defect stays open.** and the Start button comes back. If you have reminders on, your phone is "
   "also told: **NH56 FWP is authorised to run**.")
add(figure("stops-after-stop", "Stops and bookings after the stop", [
    "No Start button for the stopped bus, and who to ring.",
    P("The other bus is still offered, with a line giving its seats against the bookings."),
    P("If both buses are stopped: **No bus can be started.** **Ring {COORD}.**")]))
imp("The top bar stays red until you tap **Done** on the finished check, even after the coordinator authorises the bus. "
    "That is normal.")
sec("4.9", "No signal at the bus")
p("You can do the whole check with no signal. When you sign, the app tries to send it; if it cannot, it keeps it on the "
  "phone.")
add(figure("held", "Held on this phone", [
    "The banner: **1 check not sent yet.** with **Send now**. It stays at the top of every screen until the check has gone.",
    "**Held on this phone** · **No signal right now. It will send itself as soon as you have signal. Do not close and "
    "forget it.** The check still counts for starting the run. You do not need to wait for it to send."]))
add(figure("pending", "Waiting to send", [
    "Each check that is waiting: the bus, the date and time, the driver and what it found.",
    "**Send them all now**."]))
p("Open it from the amber **1 waiting to send** button on the home screen. When it is empty it says **Nothing waiting** "
  "· **Every check has reached the record.**")
p("The phone sends waiting checks by itself: when signal comes back while the app is open, and a moment after the app "
  "is opened. You can also tap **Send now**, **Send them all now** or **Try sending again**. What you may see:")
bl("**1 sent.**, or **1 sent, 1 still waiting.**", "**Still no connection.** Nothing went; it tries again by itself.",
   "**Still sending.** It is already busy.", "**Nothing waiting.**",
   "**Held on this phone** with **The record did not accept it.** The phone thinks it has signal but the check did not go "
   "through. Try again in a few minutes; if it keeps happening, tell the coordinator.")
imp("Do not clear the app’s data, uninstall it or reset the phone while a check is waiting. The waiting check lives "
    "only on this phone until it sends.")

# ============================================================== 5
part("5", "Stops and bookings, and the run")
p("**Stops and bookings** shows every stop on both routes with how many people have booked at each. On Sunday it is also "
  "where the driver starts the run, marks each stop as he leaves it, and ends the run at church.")
p("Open it from the home screen, from **Start your run** after the check, or from **Stops and times** on the rota. Anyone "
  "can open it and read it, signed in or not. Only the driver the rota names for a route gets the buttons for that route.")
sec("5.1", "The top of the screen")
add(figure("stops-before", "Before bookings close", [
    "**Bookings for 27 September. Updated 09:10.** The numbers are for that Sunday, and were checked at that time. They "
    "refresh every few seconds while the screen is open.",
    "**Signed in as Bro Sample · Not you?** **Not you?** goes back to **Who is driving?**.",
    "One tab per route, with how many people are booked on it.",
    "The route in one line: **North Liverpool · 9 stops · 5 with people, 9 booked of 14 on NH56 FWP**, and "
    "**Yours today** when it is your route, or the name of that route’s driver when it is not.",
    "What you can do now. Before 09:30: **Bookings close 09:30. You can start the run then.**"]))
p("Other things the top line can say:")
bl("**Last updated 10:36, 12 minutes ago.** in amber: the phone has not been able to refresh for a while. The numbers may "
   "be out of date.",
   "**Times only. The booking numbers are from an earlier Sunday and will refresh on their own.** The phone has not got "
   "today’s bookings yet. The times are right; the numbers are hidden rather than shown wrong.",
   "**Fetching the timetable…**, the first time a phone opens the screen.")
p("**9 booked of 14** compares bookings with the seats on the bus. More booked than seats is worth a call to the "
  "coordinator before you set off.")
p("**Back**, top right, returns to where you opened the screen from; so does **Done** at the bottom. During your run the "
  "bottom bar has **End trip, arrived at church** instead of **Done**. Except during your run, a round **↑** button "
  "appears at the bottom right of a long list: tap it to go back to the top.")
sec("5.2", "The stop list")
p("Each stop is one row: the time, the stop’s name, its postcode, and **2 people booked**, **1 person booked** or "
  "**Nobody booked**. The first row is the church, where the run leaves from; the last is the church again, where it "
  "ends. Appendix B lists both routes with every stop, time and postcode.")
good("A stop with **Nobody booked** can still have somebody waiting: people turn up with a flat phone or who were never "
     "told to book. Use your eyes, as you always would. The app asks for no tap at an empty stop, but offers **Someone "
     "was here** if somebody gets on (section 5.5).")
sec("5.3", "Before bookings close")
p("Passengers can book until 09:30 on Sunday. Until then the screen says **Bookings close 09:30. You can start the run "
  "then.** and there is no Start button. After 09:30 nobody can book or add a seat (a number can still go down if "
  "somebody cancels), and the Start buttons appear.")
p("The phone learns that bookings have closed from the record, so after 09:30 it needs signal each time the app is "
  "opened. If it says **Bookings close 09:30** after half nine, find signal and open the screen again.")
sec("5.4", "Starting the run")
add(figure("stops-ready", "Ready to start", [
    "One Start button per bus: **Start trip · NH56 FWP**. If you came straight from your check with **Start your run**, "
    "the bus you checked comes first; otherwise the rota’s bus does.",
    "**Tap each stop as you pull away.**"]))
p("Under a bus that is not the rota’s for your route, or has fewer seats than there are bookings, a line gives the "
  "seats: **Rota had NH56 FWP for North. YS70 PWE seats 16 and 9 are booked.**")
p("Tap the button for the bus you are actually taking, when you are ready to leave church. Starting the run records the "
  "time and one location, keeps your screen awake until the run ends, puts **End trip, arrived at church** in the bar at "
  "the bottom, and starts the passengers’ live view.")
sub("If the app asks for your PIN")
add(figure("pin-confirm", "Confirm it is you", [
    P("The run is recorded in your name, so if your PIN is not keyed the buttons are faded and a sheet opens: **Confirm "
      "it is you**, with the reason: **This run is recorded in your name.**"),
    P("Key your four digits. The sheet says **Thank you.** and closes itself."),
    P("**Not now** closes it. The buttons stay faded; tap one to bring the sheet back, and the app says **Enter your four "
      "digit PIN to confirm it is you.**"),
    P("Other reasons it gives: **Every stop you tap is recorded in your name.** and **Setting off with no check is "
      "recorded in your name.**")]))
sub("If there is no check for the bus")
add(figure("no-check", "No check today for this bus", [
    "**No check signed for NH56 FWP today.** **Do the check first.**",
    "**Do the check** takes you to the first screen, which says **Key your PIN first.** Key it, tap **Continue**, then "
    "**Vehicle check** (Part 4). Do this.",
    "**Set off anyway** starts the run without a check."]))
p("Before saying this, the app asks the record whether anybody has checked that bus today (**Checking the record…**). "
  "A check made on this phone, or on anybody’s phone once it has reached the record, counts.")
p("**Set off anyway** works, but the run goes on the record as unchecked, in your name. Only use it if the coordinator "
  "has told you to.")
sub("If the bus was stopped, or authorised")
add(figure("authorised", "A bus the coordinator has authorised", [
    "**NH56 FWP is authorised to run by {COORD}. The defect stays open.** The Start button is back.",
    P("A bus stopped by today’s check has no Start button: **NH56 FWP was stopped by today’s check.** **Ring {COORD}.** "
      "(section 4.8). If every bus is stopped: **No bus can be started.** **Ring {COORD}.**"),
    P("If the other bus is already out on the other route it is not offered: **YS70 PWE is out on South.** (If it is the "
      "only bus not stopped it is offered anyway: ring the coordinator.)")]))
sub("Other things Start can say")
add(table(["Message", "Why", "What to do"], [
    ["**Bookings close 09:30. You can start the run then.**", "Too early.", "Wait until after 09:30."],
    ["**Bro Moses is already out on North.**", "Somebody else has started this route.", "Ring the coordinator. Two buses cannot run one route."],
    ["**NH56 FWP was stopped by today’s check.** **Ring {COORD}.**", "See section 4.8.", "Ring the coordinator."]],
    [1.6, 1.1, 1.2]))
p("If you tap the bus the rota did not give you, the same question as in section 4.2 appears: **Stay with …** or "
  "**Take …**. Either carries on.")
sec("5.5", "During the run")
add(figure("run-start", "Just set off", [
    "**Running since 10:05**. Later it adds how far off the timetable you are and the last stop you marked.",
    "The next stop with people booked is highlighted, and its postcode becomes a map link: **L11 7DD ↗**.",
    "**2 people waiting at Scarisbrick Drive by Ardville Road.**",
    "**Picked up: Scarisbrick Drive by Ardville Road**. The big green button.",
    "**Nobody there**, directly under it.",
    "**End trip, arrived at church**, in the bar at the bottom."]))
sub("Marking each stop")
p("At each stop with people booked, the big green button names it. As you pull away:")
bl("**Picked up: …** if anybody got on.", "**Nobody there** if nobody did. It is directly under the green button.")
p("The stop turns green with **Picked up 10:15** or **Nobody there 10:15**, and the big button moves on to the next stop "
  "with people booked. Stops with nobody booked are shown pale green and need no tap.")
sub("Tapping too soon")
add(figure("run-too-soon", "A tap straight after setting off", [
    P("The app questions a tap that comes too early, in case your thumb slipped:"),
    P("**You set off less than a minute ago. Tap again if you are really at Scarisbrick Drive by Ardville Road.**"),
    P("**Only 1 minute since you set off. Tap again if you are really at …**"),
    P("**Too early for Grace Road bus stop, Walton Vale, timetabled 10:23. Tap again if you are there.** (less than half "
      "the timetabled time since leaving church)"),
    P("If you really are there, tap the same button again within 12 seconds and it goes through.")]))
sub("The times, the map link and Undo")
add(figure("run-one", "One stop marked, estimates showing", [
    "The stop you marked, with the time.",
    "**Undo**, in case you marked the wrong stop.",
    "A time in __bold__ is when the bus is now expected at that stop."]))
p("Each stop shows one time. Once you have marked a stop, every stop still ahead shows when the bus is now expected "
  "there, in bold. The church rows, and stops already marked, show their timetabled time, in plain type. In the picture "
  "the bus is now expected at Grace Road at **10:25**, two minutes after its timetabled 10:23, and passes the nursery at "
  "**10:32**.")
p("The line at the top of the run now reads **Running since 10:05 · 2 minutes behind schedule · last Scarisbrick "
  "Drive by Ardville Road at 10:17**. When you are off the timetable it says so in the same words: **1 minute behind "
  "schedule**, **3 minutes ahead of schedule**.")
bl("The map link is on the next booked stop only. Tap it to open the stop in maps: on Android your phone asks which map "
   "app to use; on an iPhone it opens Google Maps, or the browser if Google Maps is not installed. It goes to the exact "
   "kerb when the spreadsheet has one, otherwise to the address or postcode.",
   "**14 minutes ahead of schedule. Check the last stop you marked** in red means you are more than 12 minutes ahead of "
   "the timetable, which usually means a stop was marked before the bus got there. Undo it if so.",
   "**Undo** takes a mark back. Then mark the stop again properly.")
sub("When the bus is moving")
add(figure("run-moving", "Moving: buttons greyed", [
    "**The bus is moving. Taps come back when you pull up.**",
    P("Using the phone’s location, the app works out when the bus is moving (faster than about 5 mph for a few "
      "seconds). While it is, it will not take a stop tap, **Undo**, Start or **End trip**: the buttons go grey and come "
      "back a couple of seconds after you stop."),
    P("If a tap gets through anyway it is refused: **Not while the bus is moving. Tap it when you pull up.**"),
    P("A phone that cannot tell its speed never locks you out.")]))
sub("A stop you drove past")
add(figures([("run-skip-ask", "The app asks"), ("run-gone-past", "Gone past, not marked")]))
p("If you mark a stop further along while an earlier booked stop is still unmarked, the app asks about the earlier one, "
  "near the top of the list: **Grace Road bus stop, Walton Vale at 10:23 is not marked. 3 people booked there.** with "
  "three buttons:")
bl("**Nobody there** or **Picked up**: answer it, and the question goes.",
   "**Not now**: the question goes for this run. The stop stays amber, labelled **Gone past, not marked**, with its own "
   "**Nobody there** and **Picked up** buttons for later.")
p("The earliest missed stop is asked about first, because whoever is still standing there has been waiting longest.")
sub("Somebody at a stop nobody booked")
p("Stops with nobody booked show a **Someone was here** button during the run. Tap it if somebody got on there. It "
  "records a pick up. The church row at the top has one too; you will not need it.")
sub("If today’s numbers have not come through")
p("If the phone has no bookings for today, it cannot know which stop is next. The big button is replaced by "
  "**Today’s numbers have not come through. Mark each stop from the list above.** and every stop has its own **Nobody "
  "there** and **Picked up** buttons.")
sub("No signal on the road")
add(figure("run-offline", "Two taps waiting", [
    "**2 taps waiting to send.**",
    "**Every stop marked. End trip when you are back.**"]))
p("Every tap is kept on the phone with the time you made it, and sent when there is signal. The times on the record are "
  "always when you tapped, not when it sent. They send by themselves every few seconds while **Stops and bookings** is "
  "open. Keep it open.")
p("Your screen stays awake from Start to End so you can tap without unlocking. It does not stop you pressing the lock "
  "button yourself.")
sec("5.6", "Ending the run")
p("End the run when the bus is parked at church and everyone is off: tap **End trip, arrived at church** in the bar at "
  "the bottom. There is no question asked, so only tap it when you mean it.")
add(figures([("run-all-marked", "Every booked stop marked"), ("run-late", "Past the time due at church"),
             ("run-finished", "**Trip finished.**")]))
bl("When every booked stop is marked: **Every stop marked. End trip when you are back.**",
   "Once it is past the time the timetable has you back at church: **Still running — due at church 11:00. End trip "
   "when you are back.** The line changes by itself at that time. **End trip** is red in both cases.",
   "After ending: **Trip finished. 10:05 to 11:02, 58 minutes.** The bottom bar goes back to **Done**.")
p("Why it matters: the passengers’ page shows the bus on the road until you end it, and next Sunday opens for booking "
  "only once every route with bookings has finished. A run left open holds it back until half an hour after the bus was "
  "due at church with nothing tapped for half an hour, and never later than midday.")
sub("If you forget")
bl("__The app can end the run by itself.__ If the app is open on **Stops and bookings**, the bus has been out on the road, "
   "and it then stays at church for three minutes, the run ends on its own. With reminders on, your phone shows **Run "
   "ended, back at church** · **Open the app to undo if that is wrong.**",
   "__A reminder.__ With reminders on, if the run is still open 15 minutes after the bus was due at church and nothing "
   "has been heard from it for 10 minutes, your phone gets **End the trip** · **Your North run is still open.** It "
   "asks once more later if needed.")
add(figure("run-auto", "Ended by the app: it can be reopened", [
    "**Trip finished.** with the times.",
    "**Ended automatically, back at church.**",
    "**It has not finished, reopen it**."]))
p("If the app ends the run while you are still out, open **Stops and bookings** and tap **It has not finished, reopen "
  "it**. It is there for half an hour after the app ended the run, even if the app has been closed and opened again from "
  "the notification, and for a driver covering at short notice too (section 5.9). The run carries on where it was, **End "
  "trip** comes back, and the app says **Run reopened.**")
p("A run you ended yourself with **End trip** cannot be reopened. If that happens by mistake, ring the coordinator and "
  "carry on driving the route.")
p("**End trip** can refuse: **Not while the bus is moving.**, or **That is Bro Moses’s run. Only he can end it.** on "
  "somebody else’s run.")
sec("5.7", "If the app reloads mid-run")
p("A phone short of memory, or an update arriving, can reload the app in the middle of the run. Your run is safe: it is "
  "on the record and on the phone.")
p("Your name is kept for the day, but not your PIN. Open **Stops and bookings**: your run is there, and **Confirm it is "
  "you** asks for your PIN (**Every stop you tap is recorded in your name.**). Key it and carry on.")
add(figure("run-noname", "If the phone has lost your name as well", [
    "**Nobody is signed in.** **Your run is still going.** and **Sign in**.",
    P("If the name has been cleared too, for example because the app was opened in a different browser, the run shows "
      "with this line. Tap **Sign in**, choose your name, key your PIN, and go back to **Stops and bookings**. The first "
      "screen reminds you: **Your North run is still open. End trip when you are back.**")]))
sec("5.8", "Looking at the other route")
add(figure("other-route", "The other route, read only", [
    "**Bro Tunde is out since 10:16 · 1 minute behind schedule · last Dewsbury Road by Lynholme Road at "
      "10:25.**",
    P("Tap the other route’s tab to see where its bus is. You see its stops, its bookings and what its driver has "
      "marked, but no buttons."),
    P("When it has finished: **Bro Tunde has finished. 10:16 to 11:02, 46 minutes.**"),
    P("Before a route’s bus sets off, with nobody signed in, the screen says **Nobody is signed in.** with **Sign in**. "
      "The board is still there to read.")]))
sec("5.9", "Covering a route")
p("You get the Start button for a route when the rota names you for it that Sunday, as the driver or as the cover. So a "
  "cover arranged through the rota (section 6.3), or written into the Rota tab by the coordinator, works exactly like a "
  "normal Sunday: **Yours today**, Start, the taps and End are all yours.")
sub("Covering at short notice")
p("If you are covering and the rota does not have your name yet, open **Stops and bookings** after 09:30 and choose the "
  "route’s tab. As long as you are not on the rota for either route that morning and nobody is out on this one, the app "
  "offers you the run:")
add(figures([("cover-offer", "The offer"), ("cover-confirm", "Tap again to confirm"), ("cover-bus", "Then your bus")]))
nl("**You are not on the rota for North.** **Bro Adebola is. Nobody is out.** Tap **I am covering this run**. If your PIN "
   "is not keyed, the app asks for it first.",
   "The button turns amber: **Confirm: you are covering North**. Tap it again.",
   "The app says **Covering North. Pick your bus.** and the Start buttons appear.")
p("From here it is an ordinary run (section 5.4), and the record marks it as cover. If somebody sets off on that route "
  "in the meantime, the app says **Bro Adebola is already out on North.** and the offer goes. Either way, tell the "
  "coordinator you covered, so the rota can be put right.")
sec("5.10", "What your phone may tell you")
p("With reminders on (section 1.5), the rostered driver’s phone can be sent these, mostly on a Sunday morning. Each is "
  "worked out when it arrives on your phone, so it says what was true then.")
add(table(["Notification", "When"], [
    ["**You are driving today** · **North. Depart 10:05 after vehicle check.**", "Sunday, between 07:30 and 08:30, if your run has not started."],
    ["**North is not running today** · **Do not take the bus out.**", "The coordinator has called your route off."],
    ["**NH56 FWP was stopped by today’s check** · **Do not take it out. Ring the coordinator.**", "Your bus was stopped by a check, before your run started."],
    ["**NH56 FWP is authorised to run** · **{COORD} authorised it. The defect stays open. You can take it out.**", "The coordinator has authorised it."],
    ["**Time to set off** · **Your North run is due to leave church at 10:05. Tap Start as you pull away.**", "At the departure time, if your run has not started."],
    ["**The bus has not gone out** · **Your North run was due at 10:05. Nothing has started.**", "10 minutes after the departure time with no Start, and again later."],
    ["**End the trip** · **Your North run is still open.**", "15 minutes after the bus was due at church, with the run still open."],
    ["**Run ended, back at church** · **Open the app to undo if that is wrong.**", "The app ended the run by itself. Still out? Reopen it (section 5.6)."],
    ["**Alerts are working** · **Nothing has happened to the bus.**", "The test from the bell (section 1.5)."],
    ["**Your run is running** · **Nothing outstanding.**", "Opened during your run, when there is nothing to say."],
    ["**Dominion Transport** · **Nothing outstanding.**", "Opened when there is nothing to say."],
    ["**Sunday Bus** · **Open the app for the latest.**", "The phone could not reach the record when it arrived."]], [1.7, 1.2]))
p("**Time to set off** is the moment to tap Start as you pull away. It is what tells the passengers the bus has left: "
  "until Start is tapped, the record has the bus still at church, and five minutes after the departure time everybody "
  "booked on your route is told there is no word yet that it has left.")
sec("5.11", "A rehearsal")
add(figure("rehearsal", "During a rehearsal", [
    "**Rehearsal** **Nothing here is real. Bookings shown are test data and no bus is running. It ends at 10:30.**",
    P("Now and then the coordinator runs a rehearsal, to try the morning out. While one is on, **Stops and bookings** has "
      "this red box at the top. Nothing you tap then is real, and the bookings are test ones."),
    P("A rehearsal ends by itself, and the box says when: two hours after it starts at the most. It never runs during a "
      "real Sunday morning: one cannot be started then, and one started earlier ends before bookings close.")]))
p("When it ends, a test run on your phone is cleared and the screen goes back to the start: **The rehearsal has ended. "
  "Your test run was cleared.** If the coordinator starts it again, a new round begins: **The rehearsal was started "
  "again. Your test run was cleared.**")

# ============================================================== 6
part("6", "The driving rota")
p("**Driving rota** shows who drives each route on each Sunday, with the bus, from this Sunday for the next two years. "
  "It comes from the Rota tab in the coordinator’s spreadsheet, and the phone keeps a copy so it opens straight away "
  "and works with no signal.")
sec("6.1", "Reading the rota")
add(figure("rota", "Driving rota", [
    "**All routes** shows every Sunday, both routes.",
    "**My duties** shows only the Sundays you are on. Tap it again to see everything.",
    "**Viewing as Bro Sample**. Whose duties are marked.",
    "**Stops and times** opens **Stops and bookings**.",
    "**Earlier Sundays** adds past Sundays above, twelve at a time (**Earlier still**).",
    "**This Sunday** marks the coming Sunday, or today on a Sunday.",
    "**You** marks a route you are down for: driving, covering, or scheduled with somebody covering you.",
    "**Request change**, on your own Sundays (section 6.2)."]))
p("Each Sunday is a card: the date on the left, then one line per route with the driver’s name, **North** or "
  "**South**, and the bus for that route that day.")
add(figures([("rota-cards", "Covering, and a protected Sunday"), ("rota-swap", "A swap")]))
p("What the cards can say:")
add(table(["On the card", "Means"], [
    ["**Covering for Bro Adesina**", "The name shown is covering that Sunday for the driver named in the line."],
    ["**Swapped with Bro Abiodun**", "The driver shown has swapped Sundays with that driver."],
    ["**Protected Sunday.** **Harvest Sunday.** **This one cannot be swapped. If you cannot make it, ask for a cover.**", "The coordinator has fixed this Sunday. You can still say you cannot come."],
    ["**Holiday / planned leave** **Pending** · **Asked by Bro Sample**", "A request, with its answer: **Pending**, **Approved** (green) or **Rejected** (red)."],
    ["**No driver assigned** (red)", "Nobody is down to drive that Sunday."]], [1.5, 1.3]))
add(figure("rota-mine", "My duties", [
    P("**My duties** keeps only the Sundays you are down for. **Nothing for you here.** means none are coming up, or "
      "nobody is signed in."),
    P("If nobody is signed in the screen says **No driver chosen. Go back and pick your name to see your own duties.**"),
    P("**Done** at the bottom, or **Back** at the top, returns to the home screen. On a long list a round **↑** button at "
      "the bottom right takes you back to the top.")]))
sec("6.2", "Asking for a change")
p("Tap **Request change** on one of your own Sundays. It is there on every Sunday you are down for, as driver or cover, "
  "from this Sunday on, until you have asked about it.")
add(figure("rota-request", "Request a change", [
    P("The sheet opens with the date and your part in it: **Sunday 27 September 2026 · You are scheduled on North "
      "Liverpool this Sunday.** or … **You are covering South Liverpool this Sunday for Bro Adesina.**"),
    P("**Request type**: **Holiday / planned leave**, **Unavailable**, **Request a swap** or **Other**."),
    P("**Reason**: **Tell the coordinator what they need to know.**"),
    P("**Send request** sends it. **Cancel** closes the sheet and sends nothing.")]))
sub("Swapping a Sunday")
add(figure("rota-swap-sheet", "Request a swap", [
    P("A swap is an exchange: you drive one of their Sundays and they drive yours. Agree it with the other driver first."),
    P("**Swap with**: choose the driver."),
    P("**Take their Sunday**: choose which of their Sundays you will drive. It lists up to six coming up, with the route: "
      "**11 Oct (North)**."),
    P("Tick **Bro Moses and I have already agreed this swap.**")]))
bl("If the driver you choose is already driving on your Sunday, the app says so: **Bro Tunde is already driving on this "
   "Sunday, so he cannot take yours as well. Pick somebody else, or ask for a cover instead.**",
   "If he has no Sundays of his own coming up: **… has no Sundays of his own coming up, so there is nothing to swap. Ask "
   "for a cover instead and he can be put down for this Sunday.**",
   "A cover is different from a swap: somebody takes your Sunday and gives none back. Ask for one with **Unavailable** "
   "and the coordinator arranges it.")
sub("On a protected Sunday")
add(figure("rota-protected", "On a protected Sunday", [
    P("On a protected Sunday **Request a swap** is not offered. The sheet says **Protected Sunday.** **Harvest Sunday.** "
      "**Say you are unavailable and the coordinator will arrange cover.**")]))
sub("What the sheet can say when you send")
add(table(["Message", "What to do"], [
    ["**Choose who you are swapping with.**", "Choose a driver under **Swap with**."],
    ["**Choose which of their Sundays you are taking.**", "Choose one under **Take their Sunday**."],
    ["**Tick the box to confirm the two of you have already agreed.**", "Agree it with him first, then tick."],
    ["**Give the coordinator a short reason.**", "Write a reason of a few words."],
    ["**Choose your name on the first screen before asking for a change.**", "Sign in first."],
    ["**Not submitted. No connection. Try again when you have signal.**", "Nothing was sent. Try again with signal."],
    ["**Not submitted. You lost signal. Try again when you are back in range.**", "Signal went while sending. Try again."],
    ["**Not submitted.** followed by a reason, then **Tap Send request again.**", "Tap **Send request** again. It cannot be filed twice."],
    ["**Request sent. The coordinator decides; the rota has not changed yet.**", "Done. Wait for the answer."],
    ["**Swap sent. The coordinator decides; neither Sunday has changed yet.**", "Done. Wait for the answer."]], [1.6, 1]))
p("If your PIN is not keyed, the sheet shows **Confirm it is you.** **This request is sent in your name.** with a PIN "
  "box, and **Send request** stays faded until the PIN is in.")
sec("6.3", "After you have asked")
add(figure("rota-after-ask", "The request on the card", [
    "**Holiday / planned leave** **Pending** · **Asked by Bro Sample**",
    P("The request appears on the card straight away, and **Request change** goes: you get one request per Sunday, "
      "whatever the answer."),
    P("Nothing on the rota changes until the coordinator decides. You are still down for that Sunday until then.")]))
p("When he decides, the card shows **Approved** or **Rejected**. If the Drivers tab has your email address you are emailed "
  "too: a refusal, or an approval before anyone is named to cover, comes as **Minibus: your request for Sunday 25 October "
  "2026 was not approved** or **… has been approved**. A refusal says whether you are still down to drive, and on "
  "which bus.")
p("An approved request does not mean somebody is covering yet. Until somebody is, your name stays on that Sunday. When a "
  "cover is named or a swap is settled, the drivers involved are emailed about the change as that Sunday comes near.")
sec("6.4", "If the rota cannot be reached")
p("The rota always opens from the phone’s own copy, then checks the record. If the record cannot be reached the app "
  "says **Could not reach the shared rota. Showing the last copy.** The copy may be a little out of date; look again when "
  "you have signal.")

# ============================================================== 7
part("7", "No signal")
p("The yard at Chester Road and parts of the route can have poor signal. The app is built for it. This is what works and "
  "what waits.")
add(table(["", "With no signal"], [
    ["Opening the app", "Works, once it has been opened before on this phone. The very first time needs signal, for the "
     "list of names (section 2.1)."],
    ["Your PIN", "Works if this phone has checked it before: **Checked against this phone’s own copy.** If never: **No "
     "signal to check the PIN. Carry on: the record will show it was not checked.**"],
    ["The vehicle check", "Works completely. It is held on the phone and sends itself later (section 4.9)."],
    ["The rota", "Shows the phone’s last copy."],
    ["Stops and bookings", "Shows the last numbers it had. The top line turns amber and says how old they are."],
    ["Starting the run", "Needs signal after 09:30, each time the app is opened, to learn that bookings have closed (section "
     "5.3). After that it works."],
    ["Marking stops, **Undo**, **End trip**", "Work. The taps are kept and sent every few seconds while **Stops and "
     "bookings** is open: **2 taps waiting to send.**"],
    ["Asking for a rota change", "Does not work: **Not submitted. No connection. Try again when you have signal.** Nothing "
     "is kept to send later."],
    ["Reminders and the bell test", "Need signal."],
    ["Authorising a bus, ending another run (coordinators)", "Need signal. See Part 8."]], [1, 2.3], bold_first=True))
imp("Anything waiting to send lives only on that phone. Do not clear the app’s data, uninstall it or reset the phone "
    "until the banner and the waiting line have gone.")

# ============================================================== 8
part("8", "For coordinators")
coord("Everything in this part appears only for somebody whose role on the Drivers tab is Coordinator, Assistant "
      "Coordinator or Minister in Charge: at present {LEADS}. Nobody else sees "
      "these buttons. Which titles count is set in the spreadsheet, not in the app.")
sec("8.1", "The full inspection")
add(figure("coord-mode", "Inspection type", [
    "**Pre-drive** or **Full**.",
    P("On **Before you start** a coordinator gets a choice. **Pre-drive** is the driver’s check: **37 items. What a "
      "driver checks before carrying anyone.**"),
    P("**Full** adds the slower structural items: %d items on NH56 FWP and %d on YS70 PWE." %
      (CL["NH56 FWP full"]["items"], CL["YS70 PWE full"]["items"])),
    P("Switching type clears the answers and starts again at stage 1. **Done** or **Check another bus** sets it back to "
      "**Pre-drive**.")]))
fullonly = [it["name"] for s in CL["stages"] for it in s["items"] if it.get("full") and it["id"] != "wheelchair"]
p("The full inspection adds %s (the last two with each bus’s own wording). Rust and structure is already in NH56 "
  "FWP’s pre-drive list, because of its history." % (", ".join(fullonly[:-1]) + " and " + fullonly[-1]))
add(figure("coord-na", "Not on this bus in a full inspection", [
    P("Each item also gets a fourth answer, **Not on this bus**, for equipment a bus does not have; those items are listed "
      "on the summary as not applicable.")]))
sec("8.2", "Authorising a stopped bus")
p("A critical defect stops the bus. A coordinator can authorise it to run anyway, under his own PIN. The defect stays "
  "open on the record, and the app never closes it.")
add(figures([("coord-auth-button", "**Authorise to run** on the finished check", True), ("coord-auth-sheet", "Authorise this bus to run"),
             ("coord-authorised", "Authorised to run")]))
nl("Tap **Authorise to run** in the red box of a stopped check you have just done yourself, or **Authorise NH56 FWP to "
   "run** under the stopped bus on **Stops and bookings** (below).",
   "The sheet says **NH56 FWP. The defect stays open.** Key your own PIN under **Your PIN**.",
   "Tap **Authorise**. The app says **NH56 FWP authorised to run. The defect stays open.**")
p("The check is re-headed **Authorised to run** · **By {COORD}. The defect stays open.**, the driver’s **Stops and "
  "bookings** shows the Start button again with **NH56 FWP is authorised to run by {COORD}. The defect stays open.**, and "
  "the rostered driver’s phone is told. You may authorise a check you did yourself.")
add(figure("coord-stops", "The same button on Stops and bookings", [
    "**NH56 FWP was stopped by today’s check.**",
    "**Authorise NH56 FWP to run**. It opens the same sheet."]))
p("A coordinator sees every bus stopped by that morning’s check on **Stops and bookings**, on either route’s tab until "
  "that route’s run has started, whether or not he is driving and whatever the time. The picture is {OTHER}’s phone, "
  "before 09:30, with nobody’s run started. Drivers never see the button. Once it is authorised, the line reads **NH56 "
  "FWP is authorised to run by {COORD}. The defect stays open.**")
add(table(["The sheet says", "Meaning"], [
    ["**Key your PIN.**", "Fewer than four digits."],
    ["**No connection. Authorise it on the Checks tab of the spreadsheet instead.**", "No signal. Nothing is kept to send later."],
    ["**That PIN is not right.** (… **1 more try.**)", "Wrong PIN."],
    ["**Too many wrong tries. Wait 5 minutes.**", "Locked for five minutes after three wrong tries."],
    ["**That name cannot authorise a bus.**", "The record does not have you as a coordinator."],
    ["**No stopped check on record for that bus yet. Try again in a minute.**", "The check has not reached the record yet."],
    ["**No PIN on the Drivers tab for that name.**", "Set a PIN in the spreadsheet."],
    ["**Could not authorise it here. Use the Checks tab instead.** / **Could not reach the record. Authorise it on the "
     "Checks tab instead.**", "Use the Outcome column on the Checks tab."]], [1.7, 1]))
sec("8.3", "Ending somebody else’s run")
add(figures([("coord-endrun", "**End this run** on another driver’s route", True), ("coord-endrun-sheet", "The sheet")]))
p("A driver can only end his own run. If one is left open, a coordinator can close it: on **Stops and bookings**, on that "
  "route’s tab, tap **End this run**. The sheet reads **Bro Sample’s North run. It closes for everybody, and the "
  "record will say you ended it.** Key your PIN and tap **End the run**. The app says **North run ended. The record says "
  "you ended it.**")
bl("**That run was already finished.** Somebody ended it first.", "**That is your own run. Use End trip.**",
   "**Nothing is out on North.**",
   "**Too many tries. Wait 5 minutes.**, **That PIN is not right. 2 tries left.**, **Only a coordinator can end somebody "
   "else’s run.**, **There is no PIN against your name in the spreadsheet.**",
   "**No connection. The run is still open.**, **Could not reach the live server. The run is still open.**, **The live "
   "server would not do that. The run is still open.**")
sec("8.4", "Checking more than one bus")
p("When a coordinator finishes a check, the bottom bar also offers **Check another bus**. It clears the check and your "
  "PIN, and takes you to the first screen with **Key your PIN first.**: key it, tap **Continue**, then **Vehicle check**. "
  "**Check another bus** is not offered while a check is waiting to send; **Waiting to send** takes its place.")
sec("8.5", "The PIN check list")
p("Tapping the version line on the first screen shows a coordinator five extra lines for when a driver’s PIN box is not "
  "appearing: whether PINs are switched on, whether the phone can keep an offline copy, how many names and PINs came from "
  "the spreadsheet, whether the chosen name has a PIN, and what happened this visit. It ends **PIN box SHOULD be "
  "showing.** or **PIN box is hidden**, for the reason marked above.")
sec("8.6", "The coordinator’s app")
add(figure("hub-coordinator", "A coordinator’s home screen", [
    "**Coordinator** opens the coordinator’s app: a page of its own, on the same site, for running the morning "
    "without the spreadsheet. Its menu: **Rota**, **Rota requests**, **Bookings**, **Defects**, **Run record**, "
    "**Rehearsal**, **Have a look** and **What I have done**. **Have a look** holds the reports and the **Bus link for "
    "this Sunday**.",
    P("If your PIN has been checked on this phone, it goes with you once, so the coordinator’s app does not ask for it "
      "again. Otherwise it asks."),
    P("The other way round, its **Driver app** link brings you back here signed in, and its **Vehicle check** goes "
      "straight to choosing the bus."),
    P("Coordinator alerts reach every coordinator’s phone. Turn them on with the bell in the coordinator’s app.")]))

# ============================================================== 9
part("9", "Every message, A to Z")
p("Everything the app can say to a driver, in order of its first word (numbers are ignored). Examples use this "
  "manual’s sample names, buses and times; on your phone you will see your own.")
AZ = [
 ("Add this app to your Home Screen to get reminders.", "Home screen, iPhone", "Add the app to the Home Screen. §1.3"),
 ("Alerts are working · Nothing has happened to the bus.", "Phone notification", "The bell test worked. §1.5"),
 ("Anything to arrange?", "Before you sign", "Tap what the bus needs, or **Nothing needed**, before signing."),
 ("Bookings close 09:30. You can start the run then.", "Stops and bookings", "Too early to start. After 09:30, with signal, the Start buttons appear. §5.3"),
 ("Bro Moses is already out on North.", "Start trip, covering", "Somebody else has started this route. Ring the coordinator."),
 ("Call {COORD} · {PHONE}", "Top bar, stopped bus", "Rings the coordinator. §4.8"),
 ("1 check not sent yet. Send now", "Banner, every screen", "A check is held on this phone. It sends itself with signal. §4.9"),
 ("Check the mileage", "Before you start", "A mileage warning has not been ticked. §4.3"),
 ("Checked against this phone’s own copy.", "PIN", "No signal; the PIN matched this phone’s copy. Carry on."),
 ("Checking the record…", "Start trip", "Asking whether the bus has been checked today. Wait a moment."),
 ("Checking…", "PIN", "Waiting for an answer."),
 ("Choose a vehicle", "Which one today?", "Tap a bus card first."),
 ("Choose which of their Sundays you are taking.", "Swap request", "Pick one of his Sundays."),
 ("Choose who you are swapping with.", "Swap request", "Pick a driver."),
 ("Choose your name / Choose your name first.", "Sign in, home screen", "Choose your name on the first screen."),
 ("Choose your name on the first screen before asking for a change.", "Rota request", "Sign in first."),
 ("Confirm: you are covering North", "Stops and bookings", "Tap again to take the run. §5.9"),
 ("Copied. / Could not copy. Screenshot this page. / Screenshot this page to share it.", "Share a copy", "How the copy was made."),
 ("Could not ask for a test.", "The bell", "No signal, or reminders not set up on this phone."),
 ("Could not get a location in time. Carry on: the record will show it was not available.", "Before you start", "Carry on."),
 ("Could not reach the shared rota. Showing the last copy.", "Driving rota", "No answer from the record. Look again with signal."),
 ("Could not turn reminders on.", "Reminders", "Usually no signal. Try again."),
 ("Covering North. Pick your bus.", "Stops and bookings", "Tap the Start button for your bus. §5.9"),
 ("Critical defect. The bus does not run. Tap Call at the top.", "The walkaround", "A **Defect** on a **Stops the bus** item. §4.8"),
 ("Describe what you found on Body and glass", "Bottom of a stage", "That item’s note is missing or too short."),
 ("Do not run", "Top bar, red", "The check has stopped the bus. Nobody boards. §4.8"),
 ("DVSA daily check", "Checklist item", "The item is on DVSA’s daily walkaround check. Not a warning. §4.4"),
 ("Ended automatically, back at church. / It has not finished, reopen it", "Stops, after the run", "The app ended the run. Still out? Tap it within half an hour. §5.6"),
 ("End the trip · Your North run is still open.", "Phone notification", "End the run once parked at church. §5.6"),
 ("Enter the mileage", "Before you start", "Type the reading."),
 ("Enter your four digit PIN to confirm it is you.", "Stops and bookings", "Key your PIN in the sheet. §5.4"),
 ("Every booked stop is done.", "Stops, during the run", "No booked stop is left ahead. Answer any stop marked **Gone past, not marked**, then **End trip**."),
 ("Every stop marked. End trip when you are back.", "Stops, during the run", "End the run once parked at church. §5.6"),
 ("Fetching the timetable…", "Stops and bookings", "The first load. Wait."),
 ("Finding you…", "Before you start", "Waiting for the phone’s location."),
 ("Forgotten your PIN? Ask the coordinator.", "PIN", "The usual line under your name."),
 ("Getting low. Worth filling.", "Fuel", "3/8 of a tank."),
 ("Give the coordinator a short reason.", "Rota request", "Write a reason."),
 ("Held on this phone", "Finished check", "Not sent yet. It sends itself. Do not clear the app. §4.9"),
 ("2 items still need a note", "Bottom of a checklist stage", "Write what you found on each **Defect** or **Advisory**."),
 ("Key your PIN first.", "Vehicle check, Do the check, Check another bus", "Key your PIN on the first screen, tap **Continue**, then **Vehicle check**."),
 ("Last recorded: 48,213 on 20/09/2026 at 09:41 by Bro Moses · 49 since", "Mileage", "The last reading on the record."),
 ("Last updated 10:36, 12 minutes ago.", "Stops and bookings (amber)", "The numbers are old. Find signal."),
 ("15 left in this stage", "Bottom of a checklist stage", "Items still to answer before **Next stage**."),
 ("Location turned off for this app. The check still counts, and the record will show it was not given.", "Before you start", "Allow location in the phone’s settings next time."),
 ("Low. Fill up before you set off.", "Fuel", "¼ of a tank or less."),
 ("14 minutes ahead of schedule. Check the last stop you marked", "Stops, running line", "A stop was probably marked too early. Undo it if so."),
 ("No bus can be started.", "Stops and bookings", "Every bus has been stopped by today’s check. Ring the coordinator."),
 ("No check signed for NH56 FWP today.", "Start trip", "Do the check. §5.4"),
 ("No driver register has been set up yet.", "First screen, a new phone", "The list of names has not arrived. Find signal and open the app again. §2.1"),
 ("No location available here. Carry on: the record will show it was not available.", "Before you start", "Carry on."),
 ("No signal right now. / Still no signal.", "Held on this phone", "It sends itself once you have signal."),
 ("No signal to check the PIN. Carry on: the record will show it was not checked.", "PIN", "Carry on."),
 ("Nobody is signed in. / Sign in", "Stops and bookings", "Sign in to get your buttons."),
 ("Nobody is signed in. Your run is still going.", "Stops, during a run", "Sign in again. The run is safe. §5.7"),
 ("Nobody signed in. Vehicle check needs a name. Choose yours", "Home screen", "Choose your name."),
 ("Not sent: … / Not sent.", "The bell", "The reminder service refused. Turn reminders on again."),
 ("Not submitted. No connection. Try again when you have signal.", "Rota request", "Nothing sent. Try with signal."),
 ("Not submitted. You lost signal. Try again when you are back in range.", "Rota request", "Try again."),
 ("Not submitted. … Tap Send request again.", "Rota request", "Tap **Send request** again."),
 ("Not turned on.", "Reminders", "You said no. Allow notifications in settings to change it."),
 ("Not while the bus is moving. / … Tap it when you pull up.", "Stops, during the run", "Stop first. §5.5"),
 ("Nothing waiting.", "Send now", "Every check has been sent."),
 ("On the record", "Finished check", "Sent. Nothing else to do."),
 ("Only 1 minute since you set off. Tap again if you are really at …", "Stops, during the run", "Tap again if you are there."),
 ("PIN not keyed yet / PIN not keyed. Vehicle check needs it. Key it now", "Sign in, home screen", "Key your PIN."),
 ("Recorded to within 13 yd. You are about 1.5 miles from where the buses are kept.", "Before you start (amber)", "Do the check at the bus."),
 ("Recorded to within 9 yd. You are at the buses.", "Before you start", "Location recorded."),
 ("Rehearsal · Nothing here is real. … It ends at 10:30.", "Stops and bookings", "A rehearsal is on. Nothing is real. §5.11"),
 ("Remind me to end the trip. Turn on", "Home screen", "Turn reminders on. §1.5"),
 ("Reminders on.", "Reminders", "Done."),
 ("Renewal coming up / Renewal overdue", "Before you start", "A document is due within 30 days, or has run out. Tell the coordinator if overdue."),
 ("Renewal due soon / Renewal overdue", "Bus cards", "As above."),
 ("Request sent. The coordinator decides; the rota has not changed yet.", "Rota request", "Wait for his answer. §6.3"),
 ("Rota had NH56 FWP for North. YS70 PWE seats 16 and 9 are booked.", "Start buttons", "You are taking a bus the rota did not give, or it has too few seats."),
 ("Rota has Bro Adebola on North and Bro Tunde on South this Sunday.", "Sign in", "You are not on the rota this Sunday."),
 ("Run reopened.", "Stops and bookings", "The run carries on where it was. §5.6"),
 ("Running since 10:05 · 2 minutes behind schedule · last … at 10:17", "Stops, during the run", "Your run is going."),
 ("Sending", "Finished check", "Wait."),
 ("1 sent. / 1 sent, 1 still waiting.", "After sending held checks", "How many went. The rest try again later."),
 ("Sent. Give it a few seconds.", "The bell", "A test reminder is on its way."),
 ("Sent. Now ring the coordinator.", "Stopped check sent", "Ring him. §4.8"),
 ("Stage complete", "Bottom of a stage", "Tap **Next stage**."),
 ("Still no connection.", "Send now", "Nothing went. It tries again later."),
 ("Still running — due at church 11:00. End trip when you are back.", "Stops, during the run", "End the run once parked. §5.6"),
 ("Still sending.", "Send now", "Already busy."),
 ("Sunday Bus · Open the app for the latest.", "Phone notification", "The phone could not fetch the message. Open the app."),
 ("Swap sent. The coordinator decides; neither Sunday has changed yet.", "Swap request", "Wait for his answer."),
 ("Taken on trust: no signal to check against.", "PIN sheet", "No signal; you are let through."),
 ("Tap each stop as you pull away.", "Start buttons", "How the run works."),
 ("Tap the bus you are taking.", "Start trip", "Tap a Start button with a bus on it."),
 ("Tap the fuel gauge reading / Tap what the gauge is reading.", "Before you start", "Tap the fuel bar."),
 ("2 taps waiting to send.", "Stops, during the run", "Taps kept for lack of signal. Keep **Stops and bookings** open. §5.5"),
 ("Thank you.", "PIN sheet", "The PIN is right."),
 ("That is 1,687 miles since 20/09/2026. That is a long way for this bus. Check you have not added a digit.", "Mileage", "Read it again. §4.3"),
 ("That is Bro Moses’s run. Only he can end it.", "End trip", "Only the run’s driver can end it."),
 ("That is LOWER than the last reading of …", "Mileage", "Read it again. §4.3"),
 ("That PIN has been changed. Key the new one.", "PIN", "Key your new PIN."),
 ("That PIN is not right. (… 2 more tries before it pauses.)", "PIN", "Check the number and try again."),
 ("The bus has not gone out · Your North run was due at 10:05. Nothing has started.", "Phone notification", "Start the run, or ring the coordinator. §5.10"),
 ("The bus is moving. Taps come back when you pull up.", "Stops, during the run", "The buttons wait until you stop."),
 ("The record did not accept it.", "Held on this phone", "Try again later; tell the coordinator if it keeps happening."),
 ("The rehearsal has ended. Your test run was cleared.", "Stops and bookings", "The rehearsal is over. Nothing you tapped in it counts. §5.11"),
 ("The rehearsal was started again. Your test run was cleared.", "Stops and bookings", "A new round of the rehearsal. Start again if asked. §5.11"),
 ("The timetable did not come through. … Try again", "Stops and bookings", "Tap **Try again**."),
 ("This phone cannot give a location. Carry on as normal.", "Before you start", "Carry on."),
 ("Tick the box to confirm the two of you have already agreed.", "Swap request", "Agree it first, then tick."),
 ("Time to set off · Your North run is due to leave church at 10:05. Tap Start as you pull away.", "Phone notification", "Tap Start as you pull away. §5.10"),
 ("Times only. The booking numbers are from an earlier Sunday and will refresh on their own.", "Stops and bookings", "Today’s bookings have not arrived yet."),
 ("Today’s numbers have not come through. Mark each stop from the list above.", "Stops, during the run", "Use each stop’s own buttons."),
 ("Too early for Grace Road bus stop, Walton Vale, timetabled 10:23. Tap again if you are there.", "Stops, during the run", "Tap again if you are there."),
 ("Too many wrong tries. Wait 5 minutes, or ring the coordinator.", "PIN", "Three wrong tries pause your name for five minutes. Wait, or ring."),
 ("Trip finished. 10:05 to 11:02, 58 minutes.", "Stops and bookings", "The run is closed."),
 ("Turn your phone upright.", "Anywhere, sideways", "Hold the phone upright."),
 ("Type your name to sign", "Before you sign", "Type your name in the box."),
 ("Updated 09:58.", "Stops and bookings", "The numbers are fresh."),
 ("1 waiting to send", "Home screen button", "Opens the list of held checks. §4.9"),
 ("Works with no signal. Checks send themselves when you are back in range.", "Home screen", "A reminder, not a problem."),
 ("You are driving today · North. Depart 10:05 after vehicle check.", "Phone notification", "Your run this morning. §5.10"),
 ("You are not on the rota for North. Bro Adebola is. Nobody is out. / I am covering this run", "Stops and bookings, after 09:30", "Covering at short notice: tap it, then confirm. §5.9"),
 ("You are on North today.", "Finished check", "The rota has you driving. **Start your run** goes to the stops."),
 ("You set off less than a minute ago. Tap again if you are really at …", "Stops, during the run", "Tap again if you are there."),
 ("Your North run is still open. End trip when you are back.", "Sign in", "You have not ended today’s run. §5.6"),
 ("Your phone is not on the network just now. / The record took too long to answer. / Something went wrong at the record’s end.", "Inside other messages", "The reason something did not send. Try again."),
 ("Your run is running · Nothing outstanding.", "Phone notification", "Nothing needs doing. §5.10"),
]
import re as _re
def _az_key(t):
    t = _re.sub(r"^[\d\s]+", "", t).lower()
    return t
AZ.sort(key=lambda r: _az_key(r[0]))
add(table(["The app says", "Where", "What it means"],
          [["**%s**" % a.replace(" / ", "** / **").replace(" · ", "** · **"), b, c] for a, b, c in AZ], [1.7, 0.8, 1.3]))

# ============================================================== 10
part("10", "When something goes wrong")
p("Find what you are seeing on the left. If none of this helps, ring the coordinator on {PHONE}.")
add(table(["What you see", "What to do"], [
    ["My name is not in the list.", "You are not on the register yet. Ring the coordinator before taking a bus out."],
    ["The first screen asks me to type my name.", "The phone has not had the list of names yet. Find signal and open the app again. §2.1"],
    ["I have forgotten my PIN.", "Only the coordinator can tell you. Ring him."],
    ["Too many wrong tries.", "Wait the minutes it says, or ring the coordinator."],
    ["**Vehicle check** is faded.", "Your name or PIN is missing. Tap **Key it now** or **Choose yours**. §3.2"],
    ["I cannot get past **Before you start**.", "Type the mileage, answer any mileage warning, and tap the fuel bar. The line above the button says which. §4.3"],
    ["The mileage is questioned.", "Read the dashboard again. If it really says that, tick **I have read it twice and the dashboard really does say this**. §4.3"],
    ["**Next stage** will not go on.", "Answer every item, and write a note on every **Defect** and **Advisory**. §4.4"],
    ["**Sign and send** is faded.", "Choose something under **Anything to arrange?** and type your name. §4.5"],
    ["I tapped a bus card and my answers disappeared.", "Tapping a card starts that bus’s check again. Choose once, then **Continue**. §4.1"],
    ["The check says **Held on this phone**.", "No signal. It sends itself later. Carry on; do not clear the app. §4.9"],
    ["The check found a critical defect.", "Nobody boards. Ring the coordinator. §4.8"],
    ["There is no Start button.", "Before 09:30 there is none (§5.3). After that: are you signed in as yourself? Are you on the rota for this route today (§5.9)? Was the bus stopped (§4.8)? Does the screen still say **Bookings close 09:30** after half nine? Then find signal and open the screen again."],
    ["**No check signed for … today** but I did the check.", "Did you check this bus, under your own name, on this phone or one that has sent it? Wait a minute for it to reach the record and tap Start again. If still stuck, ring the coordinator. Use **Set off anyway** only if he says so."],
    ["I marked the wrong stop.", "Tap **Undo** on it, then mark the right one. §5.5"],
    ["The buttons are grey and say the bus is moving.", "Stop the bus. They come back a moment later."],
    ["**2 taps waiting to send.**", "Keep **Stops and bookings** open; they send when there is signal."],
    ["The numbers are amber and say **Last updated**.", "The phone has not had signal for a while. The numbers may be old."],
    ["A time on a stop is in bold.", "That is when the bus is now expected there. A plain time is the timetable. §5.5"],
    ["The app ended the run while I was still out.", "Open **Stops and bookings** and tap **It has not finished, reopen it**, within half an hour. §5.6"],
    ["I ended the run too early myself.", "There is no undo. Ring the coordinator and carry on driving the route."],
    ["**Nobody is signed in. Your run is still going.**", "Tap **Sign in**, choose your name, key your PIN, then back to **Stops and bookings**. §5.7"],
    ["I am covering and have no Start button.", "After 09:30, on the route’s tab, tap **I am covering this run** and confirm. No offer? You are on the rota for the other route, or somebody is already out: ring the coordinator. §5.9"],
    ["A red **Rehearsal** box is at the top.", "A rehearsal is on. Nothing there is real. §5.11"],
    ["The rota looks wrong.", "Open the rota again with signal. If it is still wrong, ring the coordinator; the spreadsheet is the real rota."],
    ["No reminders on my iPhone.", "Add the app to the Home Screen and open it from there, then **Turn on**. §1.5"],
    ["The reminder offer has gone.", "Notifications are blocked for the app. Allow them in the phone’s settings."],
    ["The app reloaded by itself.", "An update arrived, or the phone was short of memory. Your name is kept for the day; key your PIN again. §5.7"],
    ["Somebody else’s name is on the phone.", "Tap **Change driver** or **Not you?** and choose yours. §2.5"],
    ["The screen is covered by **Turn your phone upright.**", "Hold the phone upright."]], [1.2, 2]))

# ============================================================== Appendix A
part("Appendix A", "The checklist")
p("Every item in the walkaround, in order, with what the app asks you to check. **Stops the bus** marks a safety critical "
  "item. **Full** marks an item only in the coordinator’s full inspection. **DVSA** marks an item on DVSA’s daily "
  "walkaround check. The right hand column says where either bus differs: its own wording, its known history (**On this "
  "bus:**), or an item it does not have.")
V = {v["reg"]: v for v in CL["vehicles"]}
ORDER = ["NH56 FWP", "YS70 PWE"]
for i, s in enumerate(CL["stages"]):
    add(CondPageBreak(90), P("Stage %d · %s" % (i + 1, s["title"]), H3), P(s["lede"], SMALL), Spacer(1, 3))
    rows = []
    for it in s["items"]:
        tags = []
        if it.get("crit"): tags.append('<font name="Carlito-Bold" color="#b91c1c" size="6.4">STOPS THE BUS</font>')
        if it.get("full"): tags.append('<font color="#6b7280" size="6.4">Full</font>')
        if it.get("dvsa"): tags.append('<font color="#6b7280" size="6.4">DVSA</font>')
        name = Paragraph('<font name="Carlito-Bold">%s</font>' % md(it["name"]) + ("<br/>" + " · ".join(tags) if tags else ""), CELL)
        diffs = []
        for reg in ORDER:
            v = V[reg]
            if it["id"] in v["skip"]:
                diffs.append("__%s__: not on this bus." % reg); continue
            ov = v["override"].get(it["id"])
            if ov:
                diffs.append("__%s__: %s. %s" % (reg, ov.get("name", it["name"]), ov.get("what", "")))
            w = v["watch"].get(it["id"])
            if w:
                diffs.append("__%s__: On this bus: %s" % (reg, w) +
                             (" In this bus’s pre-drive check because of it." if it.get("full") else ""))
        rows.append([name, P(it["what"], CELL), Paragraph("<br/>".join(md(d) for d in diffs), CELL)])
    t = Table([[Paragraph(h, CELLH) for h in ["Item", "What to check", "On these buses"]]] + rows,
              colWidths=[TW * 0.24, TW * 0.4, TW * 0.36], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), DARK), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LINEBELOW", (0, 1), (-1, -1), 0.4, HAIR), ("LEFTPADDING", (0, 0), (-1, -1), 4),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5)]))
    add(t, Spacer(1, 8))
p("__How many items.__ Pre-drive: %d on each bus. Full inspection: %d on NH56 FWP and %d on YS70 PWE. NH56 FWP has no "
  "AdBlue, and neither bus has wheelchair equipment." % (CL["NH56 FWP pre"]["items"], CL["NH56 FWP full"]["items"],
                                                       CL["YS70 PWE full"]["items"]))

# ============================================================== Appendix B
part("Appendix B", "The routes")
p("Every stop on both routes, with the timetabled time, as the Bus Stops tab had them when this manual was written. The "
  "app always shows the current times.")
for rt, title in [("North", "North Liverpool"), ("South", "South Liverpool")]:
    add(P(title, H3))
    rows = []
    for s in REAL["stops"]:
        if s["route"] != rt or not s["active"]: continue
        nm = s["stop"] + (" (depart)" if s["kind"] == "depart" else " (arrive)" if s["kind"] == "arrival" else "")
        rows.append([s["time"], nm, s["postcode"]])
    add(table(["Time", "Stop", "Postcode"], rows, [0.6, 3.2, 0.9]))

# ============================================================== Appendix C
part("Appendix C", "A Sunday on one page")
nl("__Before you leave home.__ Check **Driving rota**: which route and which bus. If you have reminders on, your phone says "
   "**You are driving today** between half seven and half eight.",
   "__At the bus.__ Open the app, choose your name, key your PIN.",
   "__Vehicle check.__ Choose the bus, type the mileage, tap the fuel, then the four stages: **Fine**, **Advisory** or "
   "**Defect** for each item, with a note for anything not **Fine**.",
   "__Sign.__ **Anything to arrange?** Type your name. **Sign and send**.",
   "__A critical defect?__ Nobody boards. Ring {COORD} on {PHONE}.",
   "__After 09:30.__ **Start your run**, or **Stops and bookings**. At the departure time, with reminders on, your "
   "phone says **Time to set off**: tap **Start trip** with your bus as you pull away.",
   "__At each booked stop__, as you pull away: **Picked up** or **Nobody there**. Never while moving.",
   "__Keep Stops and bookings open__ for the whole run. The screen stays awake.",
   "__Back at church__, parked and empty: **End trip, arrived at church**.",
   "__Done.__ **Trip finished.** Next Sunday opens for booking once every run is over.")
imp("The coordinator is {COORD}, {PHONE}. Ring him for anything that stops the bus, any change to who drives, and "
    "anything this manual does not answer.")
