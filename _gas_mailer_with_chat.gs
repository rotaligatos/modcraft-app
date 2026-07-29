/**
 * Modcraft notifier — email + Google Chat relay.
 *
 * Replaces doPost in your existing mailer Apps Script project (the one whose /exec URL is
 * already in Settings → Lami → Messaging). Everything it did before still works: a body with
 * {to,subject,body} still sends mail exactly as it does today. The only addition is that a body
 * carrying {chatWebhook,chatText} is forwarded to Google Chat.
 *
 * Why the relay exists: a browser cannot POST to chat.googleapis.com directly. The API wants
 * Content-Type: application/json, which makes it a preflighted CORS request, and Google Chat
 * does not answer the preflight. Apps Script has no such restriction.
 *
 * Deploy: paste over doPost → Deploy → Manage deployments → edit → New version → Deploy.
 * The /exec URL does not change, so nothing needs updating in Modcraft.
 */
function doPost(e) {
  var out = { ok: true, email: false, chat: false };
  try {
    var data = {};
    try { data = JSON.parse(e.postData.contents); } catch (err) { data = {}; }

    // ── Email (unchanged behaviour) ──────────────────────────────────────
    if (data.to && data.subject) {
      MailApp.sendEmail({ to: data.to, subject: data.subject, body: data.body || '' });
      out.email = true;
    }

    // ── Google Chat ─────────────────────────────────────────────────────
    // The webhook URL is sent per-request rather than hard-coded, so it can be changed in
    // Modcraft's Settings without editing and redeploying this script.
    if (data.chatWebhook && data.chatText) {
      var resp = UrlFetchApp.fetch(data.chatWebhook, {
        method: 'post',
        contentType: 'application/json; charset=UTF-8',
        payload: JSON.stringify({ text: data.chatText }),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      out.chat = (code >= 200 && code < 300);
      // Modcraft posts no-cors and cannot read this reply, so a failure is only visible here.
      // Executions (left sidebar) is where to look when a message does not arrive.
      if (!out.chat) Logger.log('Chat webhook failed (' + code + '): ' + resp.getContentText());
    }
  } catch (err) {
    out.ok = false;
    out.error = err.toString();
    Logger.log('doPost error: ' + err);
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Health check — opening the /exec URL in a browser should show this. */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok', service: 'Modcraft notifier (email + chat)' })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this once from the editor to prove the Chat side works before involving Modcraft.
 * Paste your space's webhook URL in first. Authorise when prompted.
 */
function testChat() {
  var WEBHOOK = 'PASTE_YOUR_CHAT_WEBHOOK_URL_HERE';
  var resp = UrlFetchApp.fetch(WEBHOOK, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text: '✅ Modcraft notifier connected.' }),
    muteHttpExceptions: true
  });
  Logger.log(resp.getResponseCode() + ' ' + resp.getContentText());
}
