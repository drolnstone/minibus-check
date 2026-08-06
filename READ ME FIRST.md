# Minibus transport — complete set

**RCCG Dominion Assembly Liverpool**

Everything as at 6 August 2026. This replaces all earlier versions.

```
documents/
  Minibus_Operations_Pack_v4.docx     Coordinator's document. Both vehicles.
  Check_Sheet_YS70PWE.docx            Printed backup sheet, 2 pages.
  Check_Sheet_NH56FWP.docx            Printed backup sheet, 2 pages.

app/
  index.html            The app
  config.js             Drivers, vehicles, dates, endpoint  ← the file you edit
  sw.js                 Offline cache
  manifest.webmanifest  Home screen install
  icon-192.png
  icon-512.png
  icon-512-maskable.png
  logo.png              Church logo used in the app
  README.md             Full setup and maintenance guide
  apps-script/
    Code.gs             Goes into Google Apps Script, NOT the repo root
```

## Order of work

1. **Read** `documents/Minibus_Operations_Pack_v4.docx`. Section C is the outstanding work.
2. **Print** both check sheets double sided. A dozen of each, one pile per glovebox.
3. **Set up the record**: new Google Sheet → Extensions → Apps Script → paste `apps-script/Code.gs` → set `COORDINATOR_EMAIL` → Deploy as Web app → copy the `/exec` URL.
4. **Edit** `app/config.js`: paste the URL into `endpoint`.
5. **Push** the contents of `app/` to a GitHub repo root, turn on Pages.
6. **Test it yourself** before Sunday. One full check on your own phone, and confirm a row lands in the sheet.
7. **Then** send the link to the other six drivers.

Full detail for steps 3 to 5 is in `app/README.md`.

## Already set for you

- Apps Script URL is in `config.js`
- `COORDINATOR_EMAIL` is set to asimbassey@yahoo.com in `Code.gs`
- Both MOT dates, verified from DVSA
- Driver register, all seven names with roles
- Seat counts: YS70 has 16 passenger seats, NH56 has 14

## Still outstanding

- **Redeploy the Apps Script.** It has changed since you last deployed. Deploy → Manage deployments → pencil → Version: **New version**. Saving alone does not update the live URL.
- **The printed check sheets are one version behind the app.** The app now has three extra checks (cleanliness, reversing camera, radio and display) and vehicle-specific wording for mirrors. Ask for the sheets to be regenerated so paper and phone match.
- Service, insurance and parking permit dates for both buses. The MOT dates are real; the other six are placeholders set close to today so you can see both banner states working. **NH56 will show a red overdue banner until you replace them.**
- Gross weight from both V5C documents. For NH56 this decides whether D1 is required or whether a car licence holder can drive it under the volunteer concession.
- Licence category evidence for all seven names on the register
