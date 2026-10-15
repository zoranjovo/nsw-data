export type TrainDestination = {
  primary: string;
  secondary: string | null;
};

const NOT_IN_SERVICE: TrainDestination = { primary: "Not in service", secondary: null };

const stripStationSuffix = (name: string): string =>
  name
    .replace(/\s+Platform\s+\S+$/i, "")
    .replace(/\s+Station$/i, "")
    .trim();

const fromHeadsign = (headsign: string): TrainDestination => {
  const viaIndex = headsign.search(/\svia\s/i);
  if (viaIndex < 0) return { primary: headsign, secondary: null };
  return {
    primary: headsign.slice(0, viaIndex).trim(),
    secondary: headsign.slice(viaIndex).trim(),
  };
};

// Trip labels look like "21:35 Hornsby Station to Central Station"
const fromVehicleLabel = (label: string): string | null => {
  const match = label.match(/\sto\s+(.+?)\s*$/i);
  return match ? stripStationSuffix(match[1]) || null : null;
};

export const describeTrainDestination = ({
  tripHeadsign,
  vehicleLabel,
  lastStopName,
}: {
  tripHeadsign?: string | null;
  vehicleLabel?: string | null;
  lastStopName?: string | null;
}): TrainDestination => {
  const headsign = tripHeadsign?.trim();
  if (headsign) return fromHeadsign(headsign);

  const labelDestination = vehicleLabel ? fromVehicleLabel(vehicleLabel) : null;
  if (labelDestination) return { primary: labelDestination, secondary: null };

  const stopDestination = lastStopName ? stripStationSuffix(lastStopName) : "";
  if (stopDestination) return { primary: stopDestination, secondary: null };

  return NOT_IN_SERVICE;
};
