/**
 * Trading Sessions / Killzones
 * Identifies active market sessions and killzones where institutional activity peaks
 * 
 * Sessions (UTC):
 * - Asian: 00:00 - 08:00
 * - London: 07:00 - 16:00
 * - New York: 12:00 - 21:00
 * 
 * Killzones (UTC) - highest probability windows:
 * - London Open KZ: 02:00 - 05:00
 * - New York Open KZ: 07:00 - 10:00
 * - London Close KZ: 10:00 - 12:00
 */

const SESSIONS = {
  asian: { start: 0, end: 8, label: 'Asia', color: 'rgba(156, 39, 176, 0.08)' },
  london: { start: 7, end: 16, label: 'Londres', color: 'rgba(33, 150, 243, 0.08)' },
  newYork: { start: 12, end: 21, label: 'New York', color: 'rgba(255, 152, 0, 0.08)' }
};

const KILLZONES = {
  londonOpen: { start: 2, end: 5, label: 'London Open KZ', color: 'rgba(33, 150, 243, 0.15)' },
  nyOpen: { start: 7, end: 10, label: 'NY Open KZ', color: 'rgba(255, 152, 0, 0.15)' },
  londonClose: { start: 10, end: 12, label: 'London Close KZ', color: 'rgba(171, 71, 188, 0.15)' }
};

function getCurrentSession() {
  const now = new Date();
  const utcHour = now.getUTCHours();

  const activeSessions = [];
  const activeKillzones = [];

  for (const [key, session] of Object.entries(SESSIONS)) {
    if (isInRange(utcHour, session.start, session.end)) {
      activeSessions.push({ id: key, ...session });
    }
  }

  for (const [key, kz] of Object.entries(KILLZONES)) {
    if (isInRange(utcHour, kz.start, kz.end)) {
      activeKillzones.push({ id: key, ...kz });
    }
  }

  const isKillzoneActive = activeKillzones.length > 0;

  return {
    utcHour,
    activeSessions,
    activeKillzones,
    isKillzoneActive,
    sessionLabel: activeSessions.map(s => s.label).join(' / ') || 'Off-hours',
    killzoneLabel: activeKillzones.map(k => k.label).join(' / ') || 'Ninguna'
  };
}

function isInRange(hour, start, end) {
  if (start <= end) {
    return hour >= start && hour < end;
  }
  // Wrap around midnight
  return hour >= start || hour < end;
}

function getSessionForTime(timestamp) {
  const date = new Date(timestamp * 1000);
  const utcHour = date.getUTCHours();

  for (const [key, kz] of Object.entries(KILLZONES)) {
    if (isInRange(utcHour, kz.start, kz.end)) {
      return { inKillzone: true, killzone: key, ...kz };
    }
  }

  return { inKillzone: false, killzone: null };
}

module.exports = { getCurrentSession, getSessionForTime, SESSIONS, KILLZONES };
