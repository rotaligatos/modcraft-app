# Wufoo webhook — capture every attachment, not the first two

The Wufoo form has **eleven** file fields. The webhook read two of them and
discarded the rest on arrival, with nothing logged and nothing shown — which is
why an order can look like it is "lacking attachment" when the client uploaded
everything correctly.

Confirmed from the raw POSTs the webhook itself stored:

```
Field128-url  Field129-url  Field132-url  Field133-url  Field134-url  Field135-url
Field136-url  Field137-url  Field138-url  Field139-url  Field140-url
```

All eleven arrive on every submission. Only the first two were ever read.

**Already done, no action needed:** the 67 existing orders have had their full
lists recovered from those stored POSTs — nothing was permanently lost — and the
Supabase insert now accepts an `attachments` list. The app has rendered every
attachment (not just two) since 1 August, so once this script is updated the
whole chain works end to end.

**What is left is this file, which lives in the Apps Script project, not in the
app.** Two edits.

---

## Edit 1 — replace the two hardcoded uploads

Find:

```js
    var att1 = _uploadAttachment(p['Field128-url'] || p['Field128'] || '', entryId, 1);
    var att2 = _uploadAttachment(p['Field129-url'] || p['Field129'] || '', entryId, 2);
```

Replace with:

```js
    // Every file field on the form, in the order the client sees them. Listed
    // explicitly rather than scanned for, so a new field on the form is a
    // deliberate addition here and not a silent behaviour change.
    var FILE_FIELDS = ['Field128','Field129','Field132','Field133','Field134',
                       'Field135','Field136','Field137','Field138','Field139','Field140'];
    var atts = [];
    for (var fi = 0; fi < FILE_FIELDS.length; fi++) {
      var src = p[FILE_FIELDS[fi] + '-url'] || p[FILE_FIELDS[fi]] || '';
      if (!src) continue;
      var moved = _uploadAttachment(src, entryId, atts.length + 1);
      if (moved) atts.push({ path: moved, name: p[FILE_FIELDS[fi]] || '' });
    }
    // The Sheets columns and older rows still expect exactly these two.
    var att1 = atts.length > 0 ? atts[0].path : '';
    var att2 = atts.length > 1 ? atts[1].path : '';
    if (atts.length > 2) Logger.log('Order ' + entryId + ': ' + atts.length + ' files (2 in Sheets, all in Supabase)');
```

## Edit 2 — pass the full list to Supabase

Find:

```js
    _supaInsertOrder({entryId: entryId, receivedAt: receivedAt, p: p, att1: att1, att2: att2, sourceCompany: sourceCompany});
```

Replace with:

```js
    _supaInsertOrder({entryId: entryId, receivedAt: receivedAt, p: p, att1: att1, att2: att2, atts: atts, sourceCompany: sourceCompany});
```

Then in `_supaInsertOrder`, find:

```js
      attachment_1: fields.att1,
      attachment_2: fields.att2,
```

and add one line after them:

```js
      attachment_1: fields.att1,
      attachment_2: fields.att2,
      attachments:  fields.atts || [],
```

---

## Deploying

In the Apps Script project: paste the edits, then **Deploy → Manage deployments
→ edit the existing deployment → New version**.

⚠ Use **New version of the existing deployment**, not "New deployment". A new
deployment mints a different `/exec` URL and quietly leaves the old code serving
Wufoo — that has caught this project before.

## Checking it worked

Submit a Wufoo test with three or more files. The order card should list each
file by its own name. If it still shows two, the deployment is serving the old
version.

## Note on the recovered links

The 67 recovered orders point at the original Wufoo cabinet URLs rather than
Drive copies, because only the link was stored, not the file. Those open for a
signed-in Wufoo user. Orders arriving after this change are copied to Drive as
before — all of them now, not just the first two.
