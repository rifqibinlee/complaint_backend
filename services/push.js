/**
 * services/push.js
 *
 * Sends Expo push notifications. No Firebase / APNs setup required —
 * Expo's push service handles delivery for both platforms.
 *
 * Place at: /root/complaint_backend/services/push.js
 */

async function sendPushNotification(to, title, body, data = {}) {
  if (!to || !to.startsWith('ExponentPushToken')) return;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({ to, title, body, data, sound: 'default' }),
    });
    const json = await res.json();
    if (json.data?.status === 'error') {
      console.warn('[Push] Delivery error:', json.data.message);
    }
  } catch (e) {
    console.error('[Push] Failed to send notification:', e.message);
  }
}

module.exports = { sendPushNotification };
