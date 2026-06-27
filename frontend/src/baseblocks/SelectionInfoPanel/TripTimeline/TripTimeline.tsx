import { DateTime } from "luxon";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getTrainTimetable } from "@/client-api/train";
import { effectiveStopTimeEpoch, getStopOrderingMoment } from "@/lib/timetableStopMoments";
import { resolveTrainLineColor } from "@/lib/trainRouteColors";
import { getRouteShortNameFromRouteId } from "@/lib/trainRouteId";
import { useAppContext } from "@/providers/AppProvider";
import type { TimetableData, TimetableStop } from "@/types/train/timetable";
import styles from "./TripTimeline.module.css";

type TripTimelineProps = {
  tripId: string;
  showRaw: boolean;
  routeColor?: string;
};

type StopState = "past" | "next" | "future" | "unknown";
type StopTimingEventType = "Arr" | "Dep";

type StopTimingEvent = {
  type: StopTimingEventType;
  scheduledTime: string | null;
  realtimeTime: string | null;
  delaySeconds: number | null;
  isDelayed: boolean;
};

const ACTIVE_VEHICLE_SIGNAL_WINDOW_SECONDS = 10 * 60;
const FUTURE_CLOCK_SKEW_ALLOWANCE_SECONDS = 2 * 60;

const formatScheduledTime = (value: string | null): string => {
  if (!value) return "—";
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})/);
  if (!match) return "—";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    minutes > 59 ||
    seconds > 59
  ) {
    return "—";
  }
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  if (totalSeconds < 0) return "—";
  const dt = DateTime.fromObject(
    { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    { zone: "utc" }
  ).plus({ seconds: totalSeconds });
  if (!dt.isValid) return "—";
  return dt.toFormat("h:mm:ss a");
};

const formatTimestamp = (value: number | null): string | null => {
  if (!value) return null;
  return DateTime.fromSeconds(value).toFormat("h:mm:ss a");
};

const formatRawScalar = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
};

const formatEpochField = (value: number | null): string => {
  if (value == null || value === 0) return "—";
  const human = formatTimestamp(value);
  return human ? `${value} · ${human}` : String(value);
};

const StopRawDetails = ({ stop }: { stop: TimetableStop }) => {
  const rows: [string, string][] = [
    ["Stop ID", stop.stopId],
    ["Stop name (data)", formatRawScalar(stop.stopName)],
    ["Sequence", String(stop.stopSequence)],
    ["Has realtime update", formatRawScalar(stop.hasRealtimeStopUpdate)],
    ["Scheduled arrival", formatRawScalar(stop.scheduledArrival)],
    ["Scheduled departure", formatRawScalar(stop.scheduledDeparture)],
    ["Sched. arrival (s)", formatRawScalar(stop.scheduledArrivalSeconds)],
    ["Sched. departure (s)", formatRawScalar(stop.scheduledDepartureSeconds)],
    ["Sched. arrival (epoch)", formatEpochField(stop.scheduledArrivalTimestamp)],
    ["Sched. departure (epoch)", formatEpochField(stop.scheduledDepartureTimestamp)],
    ["Realtime arrival (epoch)", formatEpochField(stop.realtimeArrivalTimestamp)],
    ["Realtime departure (epoch)", formatEpochField(stop.realtimeDepartureTimestamp)],
    ["Arrival delay (s)", formatRawScalar(stop.arrivalDelaySeconds)],
    ["Departure delay (s)", formatRawScalar(stop.departureDelaySeconds)],
    ["Latitude", formatRawScalar(stop.latitude)],
    ["Longitude", formatRawScalar(stop.longitude)],
  ];

  return (
    <dl className={styles.stopRawData}>
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
};

const createStopTimingEvent = (
  type: StopTimingEventType,
  scheduledValue: string | null,
  scheduledTimestamp: number | null,
  realtimeTimestamp: number | null,
  delaySeconds: number | null
): StopTimingEvent | null => {
  const scheduledTime = scheduledValue ? formatScheduledTime(scheduledValue) : null;
  const derivedEpoch = effectiveStopTimeEpoch(realtimeTimestamp, scheduledTimestamp, delaySeconds);
  const realtimeTime = formatTimestamp(derivedEpoch);
  const hasDelay = delaySeconds != null && delaySeconds !== 0;
  const isDelayed = hasDelay && scheduledTime != null && realtimeTime != null;

  if (!scheduledTime && !realtimeTime) {
    return null;
  }

  return {
    type,
    scheduledTime,
    realtimeTime,
    delaySeconds,
    isDelayed,
  };
};

const getStopTimingEvents = (
  stop: TimetableStop,
  options?: { includeDeparture?: boolean }
): StopTimingEvent[] => {
  const includeDeparture = options?.includeDeparture ?? true;
  const arrivalEvent = createStopTimingEvent(
    "Arr",
    stop.scheduledArrival,
    stop.scheduledArrivalTimestamp,
    stop.realtimeArrivalTimestamp,
    stop.arrivalDelaySeconds
  );
  const departureEvent = includeDeparture
    ? createStopTimingEvent(
        "Dep",
        stop.scheduledDeparture,
        stop.scheduledDepartureTimestamp,
        stop.realtimeDepartureTimestamp,
        stop.departureDelaySeconds
      )
    : null;

  return [arrivalEvent, departureEvent].filter((event): event is StopTimingEvent => event != null);
};

const formatDelaySeconds = (value: number | null): string => {
  if (value == null || value === 0) return "0s";
  const absSeconds = Math.abs(value);
  const sign = value > 0 ? "+" : "-";

  if (absSeconds <= 60) {
    return `${sign}${absSeconds}s`;
  }

  const minutes = Math.floor(absSeconds / 60);
  const seconds = absSeconds % 60;
  return `${sign}${minutes}m ${seconds}s`;
};

const getEffectiveDepartureTimestamp = (stop: TimetableStop): number | null => {
  return effectiveStopTimeEpoch(
    stop.realtimeDepartureTimestamp,
    stop.scheduledDepartureTimestamp,
    stop.departureDelaySeconds
  );
};

const getEffectiveArrivalTimestamp = (stop: TimetableStop): number | null => {
  return effectiveStopTimeEpoch(
    stop.realtimeArrivalTimestamp,
    stop.scheduledArrivalTimestamp,
    stop.arrivalDelaySeconds
  );
};

const hasStopCompleted = (
  stop: TimetableStop,
  nowEpochSeconds: number,
  isLastStop: boolean
): boolean => {
  const completionTimestamp = isLastStop
    ? (getEffectiveArrivalTimestamp(stop) ?? getEffectiveDepartureTimestamp(stop))
    : getEffectiveDepartureTimestamp(stop);
  return completionTimestamp != null && completionTimestamp <= nowEpochSeconds;
};

const isWaitingToDepart = (stop: TimetableStop, nowEpochSeconds: number): boolean => {
  const arr = getEffectiveArrivalTimestamp(stop);
  if (arr == null) return false;
  return nowEpochSeconds >= arr;
};

const getStopState = (
  stop: TimetableStop,
  nextStopSequence: number | null,
  nowEpochSeconds: number,
  isLastStop: boolean,
  options?: { allowPastInferenceWhenNoNextStop?: boolean }
): StopState => {
  if (nextStopSequence == null) {
    if (options?.allowPastInferenceWhenNoNextStop === false) {
      return "unknown";
    }
    const completed = hasStopCompleted(stop, nowEpochSeconds, isLastStop);
    return completed ? "past" : "unknown";
  }
  if (stop.stopSequence < nextStopSequence) return "past";
  if (stop.stopSequence === nextStopSequence) return "next";
  return "future";
};

const isTimetableData = (value: unknown): value is TimetableData => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TimetableData>;
  return typeof candidate.tripId === "string" && Array.isArray(candidate.stops);
};

export const TripTimeline = ({
  tripId,
  showRaw,
  routeColor: routeColorProp,
}: TripTimelineProps) => {
  const { trainStatic, trainRealtime, cacheTimetable } = useAppContext();
  const [nowEpochSeconds, setNowEpochSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const nextStopRef = useRef<HTMLLIElement | null>(null);
  const stopNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const stop of trainStatic.stops) {
      if (stop.stopName) {
        map.set(stop.stopId, stop.stopName);
      }
    }
    return map;
  }, [trainStatic.stops]);

  const contextTimetable = useMemo(
    () =>
      trainStatic.timetables.find((item) => isTimetableData(item) && item.tripId === tripId) ??
      null,
    [trainStatic.timetables, tripId]
  );

  const [fetchedTimetable, setFetchedTimetable] = useState<TimetableData | null>(null);
  const [timetableFetchStatus, setTimetableFetchStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  );

  useEffect(() => {
    setFetchedTimetable(null);
    setTimetableFetchStatus("idle");

    if (!tripId) return;
    if (contextTimetable != null) return;

    let cancelled = false;

    const fetchTimetable = async () => {
      setTimetableFetchStatus("loading");
      try {
        const data = await getTrainTimetable(tripId);
        if (cancelled) return;
        if (!isTimetableData(data)) {
          setFetchedTimetable(null);
          setTimetableFetchStatus("error");
          return;
        }
        cacheTimetable(data);
        setFetchedTimetable(data);
        setTimetableFetchStatus("idle");
      } catch {
        if (cancelled) return;
        setFetchedTimetable(null);
        setTimetableFetchStatus("error");
      }
    };

    void fetchTimetable();

    return () => {
      cancelled = true;
    };
  }, [tripId, contextTimetable, cacheTimetable]);

  const timetable = contextTimetable ?? fetchedTimetable;
  const routeShortName = useMemo(
    () => timetable?.routeShortName ?? getRouteShortNameFromRouteId(timetable?.routeId),
    [timetable]
  );
  const resolvedRouteColor = useMemo(() => {
    if (!routeShortName) return "#999999";

    const matchingTrack = trainStatic.tracks.features.find(
      (feature) => feature.properties.route_short_name === routeShortName
    );
    return resolveTrainLineColor(routeShortName, matchingTrack?.properties.route_color ?? "");
  }, [routeShortName, trainStatic.tracks.features]);

  const routeColor = routeColorProp ?? resolvedRouteColor;

  const stops = useMemo(
    () => (timetable ? [...timetable.stops].sort((a, b) => a.stopSequence - b.stopSequence) : []),
    [timetable]
  );
  const visibleStops = useMemo(() => {
    if (stops.length === 0) {
      return stops;
    }

    const hasRealtimePattern = stops.some((stop) => stop.hasRealtimeStopUpdate);
    if (!hasRealtimePattern) {
      return stops;
    }

    const firstRealtimeIndex = stops.findIndex((stop) => stop.hasRealtimeStopUpdate);
    return stops.filter((stop, index) => index < firstRealtimeIndex || stop.hasRealtimeStopUpdate);
  }, [stops]);

  const nextStopSequence = useMemo(() => {
    if (stops.length === 0) return null;

    const nextStop = stops.find((stop) => {
      const moment = getStopOrderingMoment(stop);
      return moment != null && moment >= nowEpochSeconds;
    });

    return nextStop?.stopSequence ?? null;
  }, [stops, nowEpochSeconds]);
  const latestStopMoment = useMemo(() => {
    const moments = stops
      .map((stop) => getStopOrderingMoment(stop))
      .filter((moment): moment is number => moment != null);
    if (moments.length === 0) return null;
    return Math.max(...moments);
  }, [stops]);
  const tripVehicleTimestamp = useMemo(() => {
    const trainPosition = trainRealtime.positions.items.find((item) => item.tripId === tripId);
    return trainPosition?.timestamp ?? null;
  }, [trainRealtime.positions.items, tripId]);
  const hasRecentVehicleSignal = useMemo(() => {
    if (tripVehicleTimestamp == null) return false;
    const ageSeconds = nowEpochSeconds - tripVehicleTimestamp;
    return (
      ageSeconds >= -FUTURE_CLOCK_SKEW_ALLOWANCE_SECONDS &&
      ageSeconds <= ACTIVE_VEHICLE_SIGNAL_WINDOW_SECONDS
    );
  }, [tripVehicleTimestamp, nowEpochSeconds]);
  const shouldDisablePastInference = useMemo(() => {
    if (nextStopSequence != null) return false;
    if (!hasRecentVehicleSignal) return false;
    if (latestStopMoment == null) return false;
    return latestStopMoment < nowEpochSeconds - ACTIVE_VEHICLE_SIGNAL_WINDOW_SECONDS;
  }, [nextStopSequence, hasRecentVehicleSignal, latestStopMoment, nowEpochSeconds]);

  const nextStopIndex = useMemo(() => {
    if (nextStopSequence == null) return null;
    const idx = visibleStops.findIndex((s) => s.stopSequence === nextStopSequence);
    return idx >= 0 ? idx : null;
  }, [visibleStops, nextStopSequence]);

  useEffect(() => {
    if (nextStopIndex == null) return;
    if (nextStopRef.current) {
      nextStopRef.current.scrollIntoView({ behavior: "instant", block: "center" });
    }
  }, [nextStopIndex]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowEpochSeconds(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  if (timetableFetchStatus === "loading" && timetable == null) {
    return <p className={styles.empty}>Loading timetable…</p>;
  }

  if (timetableFetchStatus === "error" && timetable == null) {
    return <p className={styles.empty}>Could not load timetable.</p>;
  }

  if (!timetable || visibleStops.length === 0) {
    return <p className={styles.empty}>No timetable available.</p>;
  }

  const lastVisibleStop = visibleStops[visibleStops.length - 1];

  return (
    <div className={styles.root} style={{ "--route-color": routeColor } as React.CSSProperties}>
      <ol className={styles.list}>
        {visibleStops.map((stop) => {
          const isLastStop = stop === lastVisibleStop;
          const stopName = stopNamesById.get(stop.stopId) ?? stop.stopName ?? `Stop ${stop.stopId}`;
          const stopState = getStopState(stop, nextStopSequence, nowEpochSeconds, isLastStop, {
            allowPastInferenceWhenNoNextStop: !shouldDisablePastInference,
          });
          const timingEvents = getStopTimingEvents(stop, { includeDeparture: !isLastStop });
          const showFallbackTiming = timingEvents.length === 0;

          return (
            <li
              key={`${stop.stopId}-${stop.stopSequence}`}
              ref={stopState === "next" ? nextStopRef : null}
              className={styles.item}
              data-state={stopState}
            >
              <div className={styles.rail}>
                <span className={styles.marker} />
                {!isLastStop && <span className={styles.connector} />}
              </div>
              <div className={styles.content}>
                {stopState === "next" && (
                  <span className={styles.nextBadge}>
                    {isWaitingToDepart(stop, nowEpochSeconds) ? "Waiting to depart" : "Next stop"}
                  </span>
                )}
                <p className={styles.stopName}>{stopName}</p>
                {showFallbackTiming && <p className={styles.stopTiming}>—</p>}
                {!showFallbackTiming && (
                  <div className={styles.stopTimings}>
                    {timingEvents.map((event) => (
                      <div key={event.type} className={styles.stopTimingEvent}>
                        {event.isDelayed && event.realtimeTime ? (
                          <p className={styles.stopTiming}>
                            {event.type}{" "}
                            <span className={styles.scheduledDelayed}>
                              {event.scheduledTime ?? "—"}
                            </span>
                            {" → "}
                            {event.realtimeTime}
                            <span
                              className={styles.delaySeconds}
                              data-late={(event.delaySeconds ?? 0) > 0}
                            >
                              {formatDelaySeconds(event.delaySeconds)}
                            </span>
                          </p>
                        ) : (
                          <p className={styles.stopTiming}>
                            {event.type}{" "}
                            <span className={event.isDelayed ? styles.scheduledDelayed : undefined}>
                              {event.scheduledTime ?? "—"}
                            </span>
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {showRaw && <StopRawDetails stop={stop} />}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
