// IST clock helpers and the 09:45-11:45 checkpoint schedule.
const IST = 19800; // seconds east of UTC
const FIRST = 9 * 60 + 45;
const LAST = 11 * 60 + 45;
const STEP = 5;
const CHECKPOINTS = [];
for (let m = FIRST; m <= LAST; m += STEP) CHECKPOINTS.push(m);

const nowIst = (ms = Date.now()) => {
  const s = ms / 1000 + IST;
  return { day: Math.floor(s / 86400), min: Math.floor((s % 86400) / 60), secOfDay: Math.floor(s % 86400), weekday: new Date(Math.floor(s / 86400) * 86400000).getUTCDay() };
};
const dayOf = (t) => Math.floor((t + IST) / 86400);
const utcOf = (day, min) => day * 86400 + min * 60 - IST;
const hhmm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
const timeOf = (t) => hhmm(Math.floor(((t + IST) % 86400) / 60));
const dateOf = (day) => new Date(day * 86400000).toISOString().slice(0, 10);

// The latest checkpoint whose candle has closed at least `graceSec` ago, or null before 09:45.
function dueCheckpoint(secOfDay, graceSec) {
  let due = null;
  for (const m of CHECKPOINTS) if (m * 60 + graceSec <= secOfDay) due = m;
  return due;
}

module.exports = { IST, FIRST, LAST, STEP, CHECKPOINTS, nowIst, dayOf, utcOf, hhmm, timeOf, dateOf, dueCheckpoint };
