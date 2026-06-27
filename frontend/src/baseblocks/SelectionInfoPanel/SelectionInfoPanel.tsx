import { X } from "lucide-react";
import { DateTime } from "luxon";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { resolveTrainLineColor } from "@/lib/trainRouteColors";
import { getRouteShortNameFromRouteId } from "@/lib/trainRouteId";
import { useAppContext } from "@/providers/AppProvider";
import type { TrainPosition } from "@/types/train/train";
import styles from "./SelectionInfoPanel.module.css";
import { TripTimeline } from "./TripTimeline/TripTimeline";

const TRANSITION_DURATION_MS = 280;

const formatUpdatedAt = (timestamp: number | null, nowEpochSeconds: number): string => {
  if (timestamp == null) return "—";
  const secAgo = Math.max(0, nowEpochSeconds - timestamp);
  if (secAgo < 60) return `${secAgo}s ago`;
  if (secAgo < 3600) {
    const m = Math.floor(secAgo / 60);
    const s = secAgo % 60;
    return `${m}m ${s}s ago`;
  }
  const h = Math.floor(secAgo / 3600);
  const rem = secAgo % 3600;
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  return `${h}h ${m}m ${s}s ago`;
};

const formatSpeed = (speed: number | null): string =>
  speed == null ? "—" : `${Math.round(speed)} km/h`;

const formatBearing = (bearing: number | null): string =>
  bearing == null ? "—" : `${Math.round(bearing)}°`;

const RawDetails = ({
  train,
  nowEpochSeconds,
}: {
  train: TrainPosition;
  nowEpochSeconds: number;
}) => {
  const timestampStr =
    train.timestamp != null
      ? DateTime.fromSeconds(train.timestamp).toLocaleString({
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })
      : "—";
  return (
    <dl className={styles.details}>
      <dt>Route ID</dt>
      <dd>{train.routeId || "—"}</dd>
      <dt>Vehicle ID</dt>
      <dd>{train.vehicleId || "—"}</dd>
      <dt>Trip ID</dt>
      <dd>{train.tripId || "—"}</dd>
      <dt>Speed</dt>
      <dd>{formatSpeed(train.speed ?? null)}</dd>
      <dt>Bearing</dt>
      <dd>{formatBearing(train.bearing ?? null)}</dd>
      <dt>Timestamp</dt>
      <dd>{timestampStr}</dd>
      <dt>Updated</dt>
      <dd>{formatUpdatedAt(train.timestamp, nowEpochSeconds)}</dd>
    </dl>
  );
};

const PanelContent = ({
  train,
  nowEpochSeconds,
  onClose,
  isDesktop,
  showRaw,
  onToggleShowRaw,
  routeColor,
  routeShortName,
}: {
  train: TrainPosition;
  nowEpochSeconds: number;
  onClose: () => void;
  isDesktop?: boolean;
  showRaw: boolean;
  onToggleShowRaw: () => void;
  routeColor: string;
  routeShortName: string | null;
}) => {
  return (
    <div
      className={styles.panelInner}
      style={{ "--route-color": routeColor } as React.CSSProperties}
    >
      <div className={styles.header}>
        <div className={styles.headerGlow} aria-hidden="true" />
        <div className={styles.headerTopRow}>
          <div className={styles.routeBadge}>{routeShortName ?? "??"}</div>
          <div className={styles.trainIdentity}>
            <p className={styles.vehicleLabel}>{train.vehicleLabel || train.vehicleId || "—"}</p>
            <p className={styles.routeIdLabel}>{train.routeId || "—"}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close selection panel"
            className={styles.closeBtn}
          >
            <X />
          </Button>
        </div>
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Speed</span>
            <span className={styles.statValue}>{formatSpeed(train.speed ?? null)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Bearing</span>
            <span className={styles.statValue}>{formatBearing(train.bearing ?? null)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Updated</span>
            <span className={styles.statValue}>
              {formatUpdatedAt(train.timestamp, nowEpochSeconds)}
            </span>
          </div>
        </div>
      </div>

      {showRaw && (
        <div className={styles.rawSection}>
          <RawDetails train={train} nowEpochSeconds={nowEpochSeconds} />
        </div>
      )}

      <div className={styles.timelineSection}>
        <div className={styles.timelineHeader}>
          <span className={styles.timelineLabel}>Trip Stops</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={styles.rawToggle}
            aria-pressed={showRaw}
            onClick={onToggleShowRaw}
          >
            {showRaw ? "Hide raw" : "Raw data"}
          </Button>
        </div>
        <div className={styles.timelineScroll}>
          <TripTimeline
            key={train.tripId}
            tripId={train.tripId}
            showRaw={showRaw}
            routeColor={routeColor}
          />
          {isDesktop && <div className={styles.desktopSpacer} />}
        </div>
      </div>
    </div>
  );
};

export const SelectionInfoPanel = () => {
  const { selectedItem, setSelectedItem, trainStatic } = useAppContext();
  const isMobile = useIsMobile();

  const [displayedTrain, setDisplayedTrain] = useState<TrainPosition | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  const displayedTripIdRef = useRef<string | null>(null);

  const [nowEpochSeconds, setNowEpochSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [showRaw, setShowRaw] = useState(false);

  const pendingTrainRef = useRef<TrainPosition | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const routeShortName = useMemo(() => {
    if (!displayedTrain) return null;
    return getRouteShortNameFromRouteId(displayedTrain.routeId) ?? displayedTrain.routeId ?? null;
  }, [displayedTrain]);

  const routeColor = useMemo(() => {
    if (!displayedTrain) return "#6b7280";
    const routeIdPrefix = displayedTrain.routeId?.split("_")[0] ?? "";
    const track =
      (routeIdPrefix &&
        trainStatic.tracks.features.find(
          (f) => f.properties.route_id.split("_")[0] === routeIdPrefix
        )) ||
      (routeShortName &&
        trainStatic.tracks.features.find(
          (f) => f.properties.route_short_name === routeShortName
        )) ||
      undefined;
    return resolveTrainLineColor(
      track?.properties.route_short_name ?? routeShortName ?? "",
      track?.properties.route_color ?? ""
    );
  }, [displayedTrain, routeShortName, trainStatic.tracks.features]);

  useEffect(() => {
    const id = setInterval(() => setNowEpochSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    displayedTripIdRef.current = displayedTrain?.tripId ?? null;
    setShowRaw(false);
  }, [displayedTrain]);

  useEffect(() => {
    if (selectedItem !== null && selectedItem.type !== "train") return;

    const train = selectedItem?.type === "train" ? (selectedItem.data as TrainPosition) : null;

    if (train === null) {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      pendingTrainRef.current = null;
      setIsOpen(false);
      return;
    }

    const isSameTrain = displayedTripIdRef.current === train.tripId;

    if (!isOpenRef.current) {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      pendingTrainRef.current = null;
      displayedTripIdRef.current = train.tripId;
      setDisplayedTrain(train);
      setIsOpen(true);
      return;
    }

    if (isSameTrain) return;

    if (transitionTimerRef.current) {
      pendingTrainRef.current = train;
      return;
    }

    pendingTrainRef.current = train;
    setIsOpen(false);

    transitionTimerRef.current = setTimeout(() => {
      transitionTimerRef.current = null;
      const next = pendingTrainRef.current;
      pendingTrainRef.current = null;
      if (next) {
        displayedTripIdRef.current = next.tripId;
        setDisplayedTrain(next);
        setIsOpen(true);
      }
    }, TRANSITION_DURATION_MS);
  }, [selectedItem]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
  }, []);

  const handleClose = () => setSelectedItem(null);

  if (isMobile) {
    if (!displayedTrain) return null;
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <SheetContent side="right" showCloseButton={false} className={styles.mobileSheetContent}>
          <SheetHeader className="sr-only">
            <SheetTitle>Selected train</SheetTitle>
            <SheetDescription>Train details panel</SheetDescription>
          </SheetHeader>
          <PanelContent
            train={displayedTrain}
            nowEpochSeconds={nowEpochSeconds}
            onClose={handleClose}
            showRaw={showRaw}
            onToggleShowRaw={() => setShowRaw((v) => !v)}
            routeColor={routeColor}
            routeShortName={routeShortName}
          />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className={styles.desktopPanelWrap} data-open={isOpen}>
      <div className={styles.desktopSidebar}>
        {displayedTrain && (
          <PanelContent
            train={displayedTrain}
            nowEpochSeconds={nowEpochSeconds}
            onClose={handleClose}
            isDesktop
            showRaw={showRaw}
            onToggleShowRaw={() => setShowRaw((v) => !v)}
            routeColor={routeColor}
            routeShortName={routeShortName}
          />
        )}
      </div>
    </aside>
  );
};
