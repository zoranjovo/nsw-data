import type { Group } from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const FALLBACK_TRAIN_MODEL_ID = "h-set";

const MODEL_ID_BY_FLEET_CODE: Record<string, string> = {
  A: "a-set",
  B: "b-set",
  D: "d-set",
  H: "h-set",
  M: "m-set",
  T: "t-set",
};

export type TrainModelVariant = "driving" | "driving-lod";

export type TrainModel = {
  id: string;
  scene: Group;
};

let loader: Promise<GLTFLoader> | null = null;
const getLoader = (): Promise<GLTFLoader> => {
  loader ??= Promise.all([
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/libs/meshopt_decoder.module.js"),
  ]).then(([{ GLTFLoader }, { MeshoptDecoder }]) =>
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  );
  return loader;
};
const modelsById = new Map<string, Promise<Group>>();

export const trainModelIdFor = (fleetCode: string | null | undefined): string =>
  MODEL_ID_BY_FLEET_CODE[fleetCode?.trim().toUpperCase() ?? ""] ?? FALLBACK_TRAIN_MODEL_ID;

export const trainModelUrl = (id: string, variant: TrainModelVariant = "driving"): string =>
  `${(import.meta.env.VITE_CDN_URL ?? "").replace(/\/+$/, "")}/train-models/${id}-${variant}.glb`;

const loadModel = (id: string, variant: TrainModelVariant): Promise<Group> => {
  const url = trainModelUrl(id, variant);
  let model = modelsById.get(url);
  if (!model) {
    model = getLoader()
      .then((gltfLoader) => gltfLoader.loadAsync(url))
      .then((gltf) => gltf.scene);
    modelsById.set(url, model);
  }
  return model;
};

export const loadTrainModel = async (
  fleetCode: string | null | undefined,
  variant: TrainModelVariant = "driving"
): Promise<TrainModel> => {
  const id = trainModelIdFor(fleetCode);
  try {
    return { id, scene: await loadModel(id, variant) };
  } catch (error) {
    if (id === FALLBACK_TRAIN_MODEL_ID) throw error;
    return {
      id: FALLBACK_TRAIN_MODEL_ID,
      scene: await loadModel(FALLBACK_TRAIN_MODEL_ID, variant),
    };
  }
};
