// dates.js — Jalali (Solar Hijri) calendar helpers for the main process.
// The conversion algorithms are ported verbatim from the renderer so both
// sides always agree on month boundaries.

function gregorianToJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy > 1600 ? 979 : 0;
  let gy2 = gy > 1600 ? gy - 1600 : gy - 621;
  const gy3 = gm > 2 ? gy2 + 1 : gy2;
  let days = 365 * gy2 + Math.floor((gy3 + 3) / 4) - Math.floor((gy3 + 99) / 100) + Math.floor((gy3 + 399) / 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  let jy2 = jy + 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy2 += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy2, jm, jd];
}

function jalaliToGregorianIso(jy, jm, jd) {
  jy = Number(jy); jm = Number(jm); jd = Number(jd);
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd) || jm < 1 || jm > 12 || jd < 1 || jd > 31) return '';
  let gy;
  if (jy > 979) { gy = 1600; jy -= 979; } else { gy = 621; }
  let days = (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + 78 + jd
    + (jm < 7 ? ((jm - 1) * 31) : (((jm - 7) * 30) + 186));
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days += 1; }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const gd = days + 1;
  const leap = gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0); const sal = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1; let rem = gd; while (rem > sal[gm]) rem -= sal[gm++];
  return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(rem).padStart(2, '0')}`;
}

// ISO bounds of the Jalali month containing todayIso. The end is derived as
// the day before the next month's first day, so leap-year Esfand (30 days)
// is handled without month-length tables.
function jalaliMonthRangeIso(todayIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayIso || ''));
  if (!match) return null;
  const [jy, jm] = gregorianToJalali(Number(match[1]), Number(match[2]), Number(match[3]));
  const from = jalaliToGregorianIso(jy, jm, 1);
  const nextStart = jm === 12 ? jalaliToGregorianIso(jy + 1, 1, 1) : jalaliToGregorianIso(jy, jm + 1, 1);
  const to = new Date(new Date(`${nextStart}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  return { from, to, year: jy, month: jm };
}

// Local calendar date as ISO; new Date().toISOString() would report the
// previous day between midnight and the UTC offset.
function localDateIso(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

module.exports = { gregorianToJalali, jalaliToGregorianIso, jalaliMonthRangeIso, localDateIso };
