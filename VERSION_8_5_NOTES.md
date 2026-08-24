# V8.5 — Marketing Activity + Configurable County Cards

Adds a Marketing Activity upload that aggregates county activity by channel and date without duplicating repeated county/channel/date uploads.

Supported channels:
- Mailer Sent + Mailer Date
- RVM + RVM Date
- AI Texting + AI Texting Date
- Cold Calling + Cold Calling Date
- Neutral Postcard + Neutral Postcard Date

Required fields: STATE and COUNTY.
Counts can be numeric or Yes/Sent/True. If a date is present and the count field is blank, each row counts as one activity.

County popups now have a saved field chooser so each project can decide what the county card displays. Existing STR, property, portfolio, market, and marketing metrics are selectable independently. Marketing rows include the date history and count sent on each date.

Marketing activity counts can also be selected in Color By.

Uploads are upserted by STATE + COUNTY + CHANNEL + DATE. Re-uploading the same event updates the count instead of duplicating it. New dates are added to history.
