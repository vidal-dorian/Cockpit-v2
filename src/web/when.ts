/** The elapsed time alone, as the mockups write it: « 4 min », « 1 h », « 2 j ». */
export function elapsed(iso: string, now = Date.now()) {
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(iso).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} j`;
}

/** How long ago, in words: « à l'instant », « il y a 20 min », « il y a 3 h », « hier », « il y a 4 j ». */
export function ago(iso: string, now = Date.now()) {
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(iso).getTime()) / 60_000),
  );
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hier" : `il y a ${days} j`;
}
