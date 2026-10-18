// Date-only values must use the computer's local calendar day. UTC conversion
// can shift the date around midnight in positive or negative time zones.
export function localDateIso(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
