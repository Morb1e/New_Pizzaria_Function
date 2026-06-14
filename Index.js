const crypto = require('crypto');

// Disable Vercel's automatic body parsing so we can read the raw body
// (needed for HMAC signature verification)
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { 8277263328:AAHavyHZP1l6YgZGJ7ypwnFdookYcT-2QLw, 6595638236, key_8f23bb88d096c9b340e07c988331 } = process.env;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Read raw body from stream
  const rawBody = await readRawBody(req);

  // Verify Retell AI webhook signature (recommended in production)
  if (RETELL_API_KEY) {
    const signature = req.headers['x-retell-signature'];
    if (!signature || !verifySignature(rawBody, signature, RETELL_API_KEY)) {
      console.warn('Rejected request: invalid Retell signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Parse JSON payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  console.log(`Received Retell event: ${payload.event}`);

  // Format and forward to Telegram
  const message = formatMessage(payload);

  try {
    await sendToTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, message);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Failed to send Telegram message:', err.message);
    return res.status(502).json({ error: 'Failed to forward to Telegram' });
  }
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read the full request body as a string */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk.toString()));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Verify Retell AI HMAC-SHA256 signature */
function verifySignature(body, signature, apiKey) {
  try {
    const expected = crypto
      .createHmac('sha256', apiKey)
      .update(body)
      .digest('hex');
    // Use timingSafeEqual to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

/** Send a message to a Telegram chat via Bot API */
async function sendToTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096), // Telegram hard limit
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.description || `Telegram API error ${response.status}`);
  }

  return response.json();
}

// ─── Message formatter ───────────────────────────────────────────────────────

/**
 * Formats a Retell AI webhook payload into a human-readable Telegram message.
 * Retell sends three main events: call_started, call_ended, call_analyzed.
 */
function formatMessage(payload) {
  const event = payload.event || 'unknown';
  const call  = payload.call  || {};

  // Shared fields
  const id       = call.call_id       ? `\n🆔 <code>${call.call_id}</code>`  : '';
  const agentId  = call.agent_id      ? `\n🤖 Agent: <code>${call.agent_id}</code>` : '';
  const fromNum  = call.from_number   ? `\n📱 From: ${call.from_number}`     : '';
  const toNum    = call.to_number     ? `\n📞 To: ${call.to_number}`         : '';

  switch (event) {

    case 'call_started':
      return `📞 <b>Call Started</b>${id}${agentId}${fromNum}${toNum}`;

    case 'call_ended': {
      const duration =
        call.start_timestamp && call.end_timestamp
          ? `\n⏱ Duration: ${formatDuration(call.end_timestamp - call.start_timestamp)}`
          : '';
      const reason = call.disconnection_reason
        ? `\n🔴 Ended by: ${call.disconnection_reason.replace(/_/g, ' ')}`
        : '';
      return `📵 <b>Call Ended</b>${id}${agentId}${fromNum}${toNum}${duration}${reason}`;
    }

    case 'call_analyzed': {
      const analysis  = call.call_analysis || {};
      const summary   = analysis.call_summary
        ? `\n\n📝 <b>Summary:</b>\n${analysis.call_summary}`
        : '';
      const sentiment = analysis.user_sentiment
        ? `\n${sentimentEmoji(analysis.user_sentiment)} Sentiment: ${analysis.user_sentiment}`
        : '';
      const success   = typeof analysis.call_successful === 'boolean'
        ? `\n${analysis.call_successful ? '✅' : '❌'} Outcome: ${analysis.call_successful ? 'Successful' : 'Unsuccessful'}`
        : '';
      const transcript =
        call.transcript
          ? `\n\n💬 <b>Transcript:</b>\n${truncate(call.transcript, 1800)}`
          : '';
      return `🎙 <b>Call Analyzed</b>${id}${agentId}${fromNum}${toNum}${sentiment}${success}${summary}${transcript}`;
    }

    // Catch-all for any future or custom Retell events
    default: {
      const preview = JSON.stringify(payload, null, 2);
      return (
        `🔔 <b>Retell Event: ${event}</b>\n\n` +
        `<pre>${truncate(preview, 3800)}</pre>`
      );
    }
  }
}

// ─── Formatting utilities ─────────────────────────────────────────────────────

function formatDuration(ms) {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function sentimentEmoji(sentiment) {
  const map = { Positive: '😊', Negative: '😟', Neutral: '😐' };
  return map[sentiment] || '🗣';
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n…(truncated)';
}
