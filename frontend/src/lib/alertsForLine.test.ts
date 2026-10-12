import { describe, expect, it } from "vitest";
import type { TrainAlert } from "@/types/train/alerts";
import type { TrainTrackProperties } from "@/types/train/tracks";
import { alertsForLine } from "./alertsForLine";

const nowSeconds = Math.floor(Date.now() / 1000);

const line = { route_short_name: "T8" } as TrainTrackProperties;
const lookup = (routeId: string | null | undefined) => (routeId === "APS_1a" ? "T8" : "T1");

const alert = (
  id: string,
  activePeriods: { start: number | null; end: number | null }[],
  routeId = "APS_1a"
): TrainAlert => ({
  id,
  cause: null,
  effect: null,
  headerText: id,
  descriptionText: null,
  url: null,
  activePeriods,
  informedEntities: [{ routeId, tripId: null, stopId: null }],
});

const matchedIds = (alerts: TrainAlert[]) =>
  alertsForLine(line, alerts, lookup).map((alert) => alert.id);

describe("alertsForLine", () => {
  it("matches alerts by line rather than by route id", () => {
    expect(matchedIds([alert("this line", []), alert("another line", [], "NSN_1a")])).toEqual([
      "this line",
    ]);
  });

  it("keeps alerts that are active now, or have no period at all", () => {
    expect(
      matchedIds([
        alert("no periods", []),
        alert("current", [{ start: nowSeconds - 60, end: nowSeconds + 60 }]),
        alert("open ended", [{ start: nowSeconds - 60, end: 0 }]),
        alert("no start", [{ start: null, end: nowSeconds + 60 }]),
      ])
    ).toEqual(["no periods", "current", "open ended", "no start"]);
  });

  it("drops trackwork that has finished or has not started", () => {
    expect(
      matchedIds([
        alert("finished", [{ start: nowSeconds - 7200, end: nowSeconds - 3600 }]),
        alert("tomorrow", [{ start: nowSeconds + 86400, end: nowSeconds + 90000 }]),
      ])
    ).toEqual([]);
  });

  it("keeps an alert when any of its periods is active", () => {
    expect(
      matchedIds([
        alert("second period", [
          { start: nowSeconds - 7200, end: nowSeconds - 3600 },
          { start: nowSeconds - 10, end: nowSeconds + 10 },
        ]),
      ])
    ).toEqual(["second period"]);
  });

  it("lists an alert once even when it names the line twice", () => {
    const duplicate = alert("same alert", []);
    duplicate.informedEntities = [
      { routeId: "APS_1a", tripId: null, stopId: null },
      { routeId: "APS_1a", tripId: null, stopId: null },
    ];
    expect(matchedIds([duplicate, { ...duplicate }])).toEqual(["same alert"]);
  });
});
