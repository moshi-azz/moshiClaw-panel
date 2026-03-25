// modules/productivity.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data/productivity');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const EMAIL_FILE = path.join(DATA_DIR, 'emails.json');
const CALENDAR_FILE = path.join(DATA_DIR, 'calendar.json');

function getData(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file)); } catch { return []; }
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  sendEmail: (to, subject, body) => {
    const emails = getData(EMAIL_FILE);
    const newEmail = { id: Date.now(), to, subject, body, sentAt: new Date().toISOString() };
    emails.push(newEmail);
    saveData(EMAIL_FILE, emails);
    return newEmail;
  },
  addCalendarEvent: (title, startTime, duration) => {
    const events = getData(CALENDAR_FILE);
    const newEvent = { id: Date.now(), title, startTime, duration, createdAt: new Date().toISOString() };
    events.push(newEvent);
    saveData(CALENDAR_FILE, events);
    return newEvent;
  },
  listCalendarEvents: () => {
    return getData(CALENDAR_FILE);
  }
};
