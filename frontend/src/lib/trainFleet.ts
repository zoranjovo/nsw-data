import type { TrainPosition } from "@/types/train/train";

export type TrainFleetKind = "passenger" | "cargo" | "other" | "unknown";

export type TrainFleet = {
  kind: TrainFleetKind;
  name: string;
  detail: string | null;
};

type FleetType = {
  kind: TrainFleetKind;
  name: string;
  isLetteredSet?: boolean;
};

// Set type codes from the TfNSW RTTA technical documentation (section 2.2.2)
const FLEET_TYPES: Record<string, FleetType> = {
  A: { kind: "passenger", name: "Waratah", isLetteredSet: true },
  B: { kind: "passenger", name: "Waratah Series 2", isLetteredSet: true },
  C: { kind: "passenger", name: "C Set", isLetteredSet: true },
  D: { kind: "passenger", name: "Mariyung", isLetteredSet: true },
  H: { kind: "passenger", name: "OSCar", isLetteredSet: true },
  J: { kind: "passenger", name: "Hunter" },
  K: { kind: "passenger", name: "K Set", isLetteredSet: true },
  M: { kind: "passenger", name: "Millennium", isLetteredSet: true },
  N: { kind: "passenger", name: "Endeavour" },
  P: { kind: "passenger", name: "Xplorer" },
  S: { kind: "passenger", name: "S Set", isLetteredSet: true },
  T: { kind: "passenger", name: "Tangara", isLetteredSet: true },
  V: { kind: "passenger", name: "V Set", isLetteredSet: true },
  X: { kind: "passenger", name: "XPT" },
  Z: { kind: "passenger", name: "Heritage" },
  G: { kind: "cargo", name: "Cargo" },
  W: { kind: "cargo", name: "Cargo" },
  I: { kind: "other", name: "Track Inspection" },
  L: { kind: "other", name: "Light Locomotive" },
  Q: { kind: "other", name: "Track Machine" },
};

const UNKNOWN_FLEET: TrainFleet = { kind: "unknown", name: "Unknown", detail: null };

export const describeTrainFleet = ({
  fleetCode,
  carCount,
}: Pick<TrainPosition, "fleetCode" | "carCount">): TrainFleet => {
  const code = fleetCode?.trim().toUpperCase() ?? "";
  const fleetType = FLEET_TYPES[code];
  if (!fleetType) return UNKNOWN_FLEET;

  const detailParts: string[] = [];
  if (fleetType.isLetteredSet) detailParts.push(`${code} set`);
  if (fleetType.kind !== "cargo" && carCount != null && carCount > 0) {
    detailParts.push(`${carCount} ${carCount === 1 ? "car" : "cars"}`);
  }

  return {
    kind: fleetType.kind,
    name: fleetType.name,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
  };
};
