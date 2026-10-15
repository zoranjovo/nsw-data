import { Locate, LocateFixed } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppContext } from "@/providers/AppProvider";
import { FOLLOW_MIN_ZOOM } from "../TrainIcons/trainFollow";
import { isMapRemoved, useMapLibre } from "./MapContext";
import styles from "./MapView.module.css";

export const FollowTrainButton = () => {
  const map = useMapLibre();
  const { selectedItem, followSelectedTrain, setFollowSelectedTrain } = useAppContext();
  const [zoomedIn, setZoomedIn] = useState(() => (map?.getZoom() ?? 0) >= FOLLOW_MIN_ZOOM);

  useEffect(() => {
    if (!map || isMapRemoved(map)) return;
    const syncZoom = () => setZoomedIn(map.getZoom() >= FOLLOW_MIN_ZOOM);
    syncZoom();
    map.on("zoom", syncZoom);
    return () => {
      if (!isMapRemoved(map)) map.off("zoom", syncZoom);
    };
  }, [map]);

  if (selectedItem?.type !== "train") return null;

  const waitingForZoom = followSelectedTrain && !zoomedIn;
  const label = followSelectedTrain
    ? waitingForZoom
      ? "Zoom in to follow the train"
      : "Stop following the train"
    : "Follow the train";

  return (
    <button
      type="button"
      className={styles.followButton}
      aria-pressed={followSelectedTrain}
      data-waiting={waitingForZoom}
      title={label}
      aria-label={label}
      onClick={() => setFollowSelectedTrain((following) => !following)}
    >
      {followSelectedTrain ? <LocateFixed size={17} /> : <Locate size={17} />}
    </button>
  );
};
