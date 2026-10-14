import type { Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const TRAIN_MODELS_URL = (import.meta.env.VITE_TRAIN_MODELS_URL || "/train-models").replace(
  /\/+$/,
  ""
);

export const FALLBACK_TRAIN_MODEL_ID = "h-set";

const MODEL_ID_BY_FLEET_CODE: Record<string, string> = {
  A: "a-set",
  B: "b-set",
  D: "d-set",
  H: "h-set",
  M: "m-set",
  T: "t-set",
};

export type TrainModel = {
  id: string;
  scene: Group;
};

const loader = new GLTFLoader();
const modelsById = new Map<string, Promise<Group>>();

export const trainModelIdFor = (fleetCode: string | null | undefined): string =>
  MODEL_ID_BY_FLEET_CODE[fleetCode?.trim().toUpperCase() ?? ""] ?? FALLBACK_TRAIN_MODEL_ID;

export const trainModelUrl = (id: string): string => `${TRAIN_MODELS_URL}/${id}-driving.glb`;

const loadModel = (id: string): Promise<Group> => {
  let model = modelsById.get(id);
  if (!model) {
    model = loader.loadAsync(trainModelUrl(id)).then((gltf) => gltf.scene);
    modelsById.set(id, model);
  }
  return model;
};

export const loadTrainModel = async (fleetCode: string | null | undefined): Promise<TrainModel> => {
  const id = trainModelIdFor(fleetCode);
  try {
    return { id, scene: await loadModel(id) };
  } catch (error) {
    if (id === FALLBACK_TRAIN_MODEL_ID) throw error;
    return { id: FALLBACK_TRAIN_MODEL_ID, scene: await loadModel(FALLBACK_TRAIN_MODEL_ID) };
  }
};
