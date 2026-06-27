import { AlertTriangle, Train } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getTrainAlerts } from "@/client-api/train";
import { PopupSheet } from "@/components/PopupSheet/PopupSheet";
import { alertsForLine } from "@/lib/alertsForLine";
import { resolveTrainLineColor } from "@/lib/trainRouteColors";
import { getRouteShortNameFromRouteId } from "@/lib/trainRouteId";
import { useAppContext } from "@/providers/AppProvider";
import type { TrainAlert } from "@/types/train/alerts";
import type { TrainTrackProperties } from "@/types/train/tracks";
import styles from "./LinesSheet.module.css";

export interface LinesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const uniqueSortedLines = (
  features: { properties: TrainTrackProperties }[]
): TrainTrackProperties[] => {
  const byShortName = new Map<string, TrainTrackProperties>();
  for (const f of features) {
    const p = f.properties;
    const key = p.route_short_name;
    if (!key || byShortName.has(key)) continue;
    byShortName.set(key, p);
  }
  const list = [...byShortName.values()];
  list.sort((a, b) =>
    a.route_short_name.localeCompare(b.route_short_name, undefined, { numeric: true })
  );
  return list;
};

const lineAlertTitle = (alert: TrainAlert): string => {
  const h = alert.headerText?.trim();
  if (h) return h;
  const id = alert.id?.trim();
  if (id) return id;
  return "Alert";
};

type AlertsFetchStatus = "idle" | "loading" | "ready" | "error";

export const LinesSheet = ({ open, onOpenChange }: LinesSheetProps) => {
  const { trainStatic, staticLoadStatus, trainRealtime } = useAppContext();
  const lines = useMemo(
    () => uniqueSortedLines(trainStatic.tracks.features),
    [trainStatic.tracks.features]
  );

  const trainCountByShortName = useMemo(() => {
    const map = new Map<string, number>();
    for (const pos of trainRealtime.positions.items) {
      const short = getRouteShortNameFromRouteId(pos.routeId);
      if (!short) continue;
      map.set(short, (map.get(short) ?? 0) + 1);
    }
    return map;
  }, [trainRealtime.positions.items]);

  const [selectedShortName, setSelectedShortName] = useState<string | null>(null);
  const [alertsStatus, setAlertsStatus] = useState<AlertsFetchStatus>("idle");
  const [alerts, setAlerts] = useState<TrainAlert[]>([]);

  const loadAlerts = useCallback(async () => {
    setAlertsStatus("loading");
    try {
      const data = await getTrainAlerts();
      setAlerts(data.alerts);
      setAlertsStatus("ready");
    } catch {
      setAlerts([]);
      setAlertsStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadAlerts();
  }, [open, loadAlerts]);

  useEffect(() => {
    if (lines.length === 0) return;
    setSelectedShortName((prev) => {
      if (prev && lines.some((l) => l.route_short_name === prev)) return prev;
      return lines[0].route_short_name;
    });
  }, [lines]);

  const selected = lines.find((l) => l.route_short_name === selectedShortName) ?? null;
  const tracksLoading = staticLoadStatus.tracks === "loading" && lines.length === 0;

  const alertCountByShortName = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      map.set(line.route_short_name, alertsForLine(line, alerts).length);
    }
    return map;
  }, [lines, alerts]);

  const selectedLineAlerts = useMemo(
    () => (selected ? alertsForLine(selected, alerts) : []),
    [selected, alerts]
  );

  const showLineAlerts =
    alertsStatus === "ready" && selected != null && selectedLineAlerts.length > 0;

  return (
    <PopupSheet open={open} onOpenChange={onOpenChange} ariaLabel="Lines">
      {tracksLoading ? (
        <p className={styles.placeholder}>Loading lines…</p>
      ) : lines.length === 0 ? (
        <p className={styles.placeholder}>No line data loaded.</p>
      ) : (
        <div className={styles.layout}>
          <nav className={styles.lineList} aria-label="Train lines">
            <ul className={styles.lineListUl}>
              {lines.map((line) => {
                const color = resolveTrainLineColor(line.route_short_name, line.route_color);
                const isSelected = line.route_short_name === selectedShortName;
                const trainCount = trainCountByShortName.get(line.route_short_name) ?? 0;
                const alertCount = alertCountByShortName.get(line.route_short_name) ?? 0;
                const statsSrText =
                  alertCount > 0
                    ? `${trainCount} trains, ${alertCount} service alerts`
                    : `${trainCount} trains`;
                return (
                  <li key={line.route_short_name} className={styles.lineListItem}>
                    <button
                      type="button"
                      className={styles.lineButton}
                      data-selected={isSelected ? "true" : "false"}
                      onClick={() => setSelectedShortName(line.route_short_name)}
                    >
                      <span
                        className={styles.lineSwatch}
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      <span className={styles.lineTextCol}>
                        <span className={styles.lineShortName}>{line.route_short_name}</span>
                        <span className={styles.lineStatsWrap}>
                          <span className="sr-only">{statsSrText}</span>
                          <span className={styles.lineStats} aria-hidden>
                            <span className={styles.lineStatGroup}>
                              <Train className={styles.lineStatIcon} size={14} aria-hidden />
                              <span className={styles.lineStatNum}>{trainCount}</span>
                            </span>
                            {alertCount > 0 ? (
                              <span className={styles.lineStatGroup}>
                                <AlertTriangle
                                  className={styles.lineStatIconAlert}
                                  size={14}
                                  aria-hidden
                                />
                                <span className={styles.lineStatNum}>{alertCount}</span>
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className={styles.detail}>
            {selected ? (
              <>
                <p className={styles.detailTitle}>
                  {selected.route_desc?.trim() || selected.route_long_name || "—"}
                </p>
                {showLineAlerts ? (
                  <details className={styles.lineAlerts}>
                    <summary className={styles.lineAlertsSummary}>
                      <AlertTriangle
                        className={styles.lineAlertsIcon}
                        size={18}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span>
                        {selectedLineAlerts.length === 1
                          ? "Service alert"
                          : `${selectedLineAlerts.length} service alerts`}
                      </span>
                    </summary>
                    <ul className={styles.lineAlertsList}>
                      {selectedLineAlerts.map((alert, index) => {
                        const url = alert.url?.trim();
                        return (
                          <li
                            key={alert.id ? alert.id : `line-alert-${index}`}
                            className={styles.lineAlertsItem}
                          >
                            <p className={styles.lineAlertsItemTitle}>{lineAlertTitle(alert)}</p>
                            {alert.descriptionText?.trim() ? (
                              <p className={styles.lineAlertsItemBody}>
                                {alert.descriptionText.trim()}
                              </p>
                            ) : null}
                            {url ? (
                              <a
                                className={styles.lineAlertsItemLink}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                More information
                              </a>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      )}
    </PopupSheet>
  );
};
