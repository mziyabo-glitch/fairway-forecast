/** Shift a saved round's date and clock without rescoring. */

export function applyRoundEdit(round, { date, tee, holes } = {}) {
  let teeTime = Number(round?.teeTime);
  if (!Number.isFinite(teeTime)) teeTime = null;

  if (date && round?.date && date !== round.date && teeTime != null) {
    const prev = round.date.split("-").map(Number);
    const next = date.split("-").map(Number);
    if (prev.length === 3 && next.length === 3 && prev.concat(next).every(Number.isFinite)) {
      const delta = Math.round(
        (Date.UTC(next[0], next[1] - 1, next[2]) - Date.UTC(prev[0], prev[1] - 1, prev[2])) / 86400000
      );
      teeTime += delta * 86400;
    }
  }

  const match = /^(\d{2}):(\d{2})$/.exec(String(tee || ""));
  if (match && teeTime != null) {
    const d = new Date(teeTime * 1000);
    d.setUTCHours(Number(match[1]), Number(match[2]), 0, 0);
    teeTime = Math.floor(d.getTime() / 1000);
  }

  return {
    date: date || round?.date || null,
    teeTime,
    holes: holes === 9 ? 9 : 18,
  };
}
