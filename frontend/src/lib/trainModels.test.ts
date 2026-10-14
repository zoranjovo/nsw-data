import { beforeEach, describe, expect, it, vi } from "vitest";

const loadAsync = vi.hoisted(() => vi.fn());

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    loadAsync = loadAsync;
  },
}));

const sceneFor = (url: string) => ({ scene: { name: url } });

beforeEach(() => {
  vi.resetModules();
  loadAsync.mockReset();
});

describe("trainModelIdFor", () => {
  it("maps fleet codes to their model and everything else to the H set", async () => {
    const { trainModelIdFor } = await import("./trainModels");

    expect(trainModelIdFor("D")).toBe("d-set");
    expect(trainModelIdFor("t")).toBe("t-set");
    expect(trainModelIdFor("X")).toBe("h-set");
    expect(trainModelIdFor(null)).toBe("h-set");
  });
});

describe("loadTrainModel", () => {
  it("loads the driving car for the train's fleet", async () => {
    loadAsync.mockImplementation(async (url: string) => sceneFor(url));
    const { loadTrainModel } = await import("./trainModels");

    const model = await loadTrainModel("D");

    expect(model.id).toBe("d-set");
    expect(loadAsync).toHaveBeenCalledWith("/train-models/d-set-driving.glb");
  });

  it("falls back to the H set when the fleet's model is missing", async () => {
    loadAsync.mockImplementation(async (url: string) => {
      if (url.includes("a-set")) throw new Error("404");
      return sceneFor(url);
    });
    const { loadTrainModel } = await import("./trainModels");

    const model = await loadTrainModel("A");

    expect(model.id).toBe("h-set");
    expect(model.scene.name).toBe("/train-models/h-set-driving.glb");
  });

  it("loads the lighter variant when asked", async () => {
    loadAsync.mockImplementation(async (url: string) => sceneFor(url));
    const { loadTrainModel } = await import("./trainModels");

    await loadTrainModel("D", "driving-lod");

    expect(loadAsync).toHaveBeenCalledWith("/train-models/d-set-driving-lod.glb");
  });

  it("only downloads each model once", async () => {
    loadAsync.mockImplementation(async (url: string) => sceneFor(url));
    const { loadTrainModel } = await import("./trainModels");

    await loadTrainModel("H");
    await loadTrainModel("H");

    expect(loadAsync).toHaveBeenCalledTimes(1);
  });
});
