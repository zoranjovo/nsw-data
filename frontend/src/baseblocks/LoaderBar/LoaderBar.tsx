import { AlertCircle } from "lucide-react";
import { Loader } from "@/baseblocks/Loader/Loader";
import { useAppContext } from "@/providers/AppProvider";
import styles from "./LoaderBar.module.css";

type StaticResource = "tracks" | "stops" | "timetable";

const STATIC_LABELS: Record<StaticResource, string> = {
  tracks: "Tracks",
  stops: "Stops",
  timetable: "Timetable",
};

export const LoaderBar = () => {
  const { currentPage, staticLoadStatus, trainRealtime } = useAppContext();

  if (currentPage !== "trains") {
    return null;
  }

  const staticRows = (Object.keys(STATIC_LABELS) as StaticResource[])
    .map((resource) => ({
      resource,
      label: STATIC_LABELS[resource],
      status: staticLoadStatus[resource],
    }))
    .filter(
      (row) => row.status === "loading" || row.status === "error" || row.status === "ratelimited"
    );

  const showRealtimeRatelimited = trainRealtime.error === "Ratelimited";
  const showRealtimeError = trainRealtime.error !== null && !showRealtimeRatelimited;

  if (staticRows.length === 0 && !showRealtimeError && !showRealtimeRatelimited) {
    return null;
  }

  return (
    <div className={styles.container}>
      <ul className={styles.list} aria-live="polite">
        {staticRows.map((row) => (
          <li
            key={row.resource}
            className={`${styles.row} ${row.status === "error" ? styles.errorRow : ""} ${
              row.status === "ratelimited" ? styles.ratelimitedRow : ""
            }`}
          >
            {row.status === "loading" ? (
              <Loader size={14} aria-hidden />
            ) : (
              <AlertCircle size={14} aria-hidden />
            )}
            <span>
              {row.status === "loading"
                ? `Loading ${row.label}`
                : row.status === "ratelimited"
                  ? `Ratelimited ${row.label}`
                  : `Failed loading ${row.label}`}
            </span>
          </li>
        ))}

        {showRealtimeRatelimited ? (
          <li className={`${styles.row} ${styles.ratelimitedRow}`}>
            <AlertCircle size={14} aria-hidden />
            <span>Ratelimited</span>
          </li>
        ) : null}

        {showRealtimeError ? (
          <li className={`${styles.row} ${styles.errorRow}`}>
            <AlertCircle size={14} aria-hidden />
            <span>{trainRealtime.error}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
};
