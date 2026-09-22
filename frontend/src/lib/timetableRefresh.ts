import type { TimetableData } from "@/types/train/timetable";

const TIMETABLE_REFRESH_MS = 30_000;

export const isTimetableStale = (timetable: TimetableData, tripUpdatesFetchedAt: number): boolean =>
  tripUpdatesFetchedAt - (timetable.tripUpdatesFetchedAt ?? 0) >= TIMETABLE_REFRESH_MS;
