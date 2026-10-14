import { describe, expect, it } from "vitest";
import { describeTrainDestination } from "./trainDestination";

describe("describeTrainDestination", () => {
  it("shows the timetable headsign, splitting off the via line", () => {
    expect(describeTrainDestination({ tripHeadsign: "Hornsby via Strathfield" })).toEqual({
      primary: "Hornsby",
      secondary: "via Strathfield",
    });
    expect(describeTrainDestination({ tripHeadsign: "Central" })).toEqual({
      primary: "Central",
      secondary: null,
    });
  });

  it("keeps headsigns that are not destinations as they are", () => {
    expect(describeTrainDestination({ tripHeadsign: "Empty Train" }).primary).toBe("Empty Train");
  });

  it("falls back to the destination in the trip label", () => {
    expect(
      describeTrainDestination({
        tripHeadsign: null,
        vehicleLabel: "21:35 Hornsby Station to Central Station ",
      })
    ).toEqual({ primary: "Central", secondary: null });
    expect(
      describeTrainDestination({
        tripHeadsign: "  ",
        vehicleLabel: "20:12 Wollongong Station to Newcastle Interchange Station",
      }).primary
    ).toBe("Newcastle Interchange");
  });

  it("then falls back to the last stop's name", () => {
    expect(
      describeTrainDestination({ vehicleLabel: "", lastStopName: "Kiama Station Platform 2" })
    ).toEqual({ primary: "Kiama", secondary: null });
  });

  it("shows not in service when nothing is known", () => {
    expect(describeTrainDestination({})).toEqual({ primary: "Not in service", secondary: null });
  });
});
