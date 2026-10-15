import {
  type CustomLayerInterface,
  type Map as MaplibreMap,
  MercatorCoordinate,
} from "maplibre-gl";
import {
  DirectionalLight,
  MathUtils,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  NeutralToneMapping,
  type Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  type Texture,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadTrainModel } from "@/lib/trainModels";
import { isWithinBounds, paddedVisibleBounds } from "../MapView/mapViewport";
import {
  createDestinationMaterial,
  type DestinationMaterial,
  findDisplayMesh,
} from "../SelectionInfoPanel/TrainModelPreview/destinationDisplay";
import { TRAIN_MODELS_LAYER_ID } from "../trainMapLayers";
import type { GetTrainMarkers, TrainMarker } from "./trainMarkers";

export const TRAIN_MODELS_ON_MAP_SETTINGS = {
  minZoom: 16,
  viewportPadding: 0.25,
  displayTextureWidth: 512,
  exposure: 1.1,
};

type PlacedTrain = {
  instance: TrainMarker;
  object: Object3D | null;
  modelId: string | null;
  display: Mesh | null;
  displayOriginal: MeshStandardMaterial | null;
  displayKey: string | null;
  heading: number;
};

export type TrainModelsLayer = {
  layer: CustomLayerInterface;
  destroy: () => void;
};

const MODEL_UP_TO_MAP_UP = new Matrix4().makeRotationX(Math.PI / 2);

export const createTrainModelsLayer = (
  map: MaplibreMap,
  getMarkers: GetTrainMarkers
): TrainModelsLayer => {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(0.4, 1, 0.6);
  scene.add(sun);

  const trains = new Map<string, PlacedTrain>();
  const displayMaterials = new Map<string, DestinationMaterial>();
  const centreOffset = new Matrix4();
  const scale = new Matrix4();
  const heading = new Matrix4();
  let renderer: WebGLRenderer | null = null;
  let environment: Texture | null = null;
  let destroyed = false;

  const applyDestination = (train: PlacedTrain) => {
    if (!train.display || !train.displayOriginal || !train.modelId) return;
    const { primary, secondary } = train.instance.destination;
    const key = `${train.modelId}|${primary}|${secondary ?? ""}`;
    if (train.displayKey === key) return;

    let shared = displayMaterials.get(key);
    if (!shared) {
      shared = createDestinationMaterial(
        train.displayOriginal,
        TRAIN_MODELS_ON_MAP_SETTINGS.displayTextureWidth
      );
      shared.update(train.instance.destination);
      displayMaterials.set(key, shared);
    }
    train.display.material = shared.material;
    train.displayKey = key;
  };

  const loadInto = (train: PlacedTrain) => {
    loadTrainModel(train.instance.fleetCode, "driving-lod")
      .then(({ id, scene: model }) => {
        if (destroyed || trains.get(train.instance.key) !== train) return;
        const object = model.clone(true);
        object.matrixAutoUpdate = false;
        object.traverse((child) => {
          child.frustumCulled = false;
        });
        train.object = object;
        train.modelId = id;
        train.display = findDisplayMesh(object);
        const displayMaterial = train.display?.material;
        train.displayOriginal =
          displayMaterial && !Array.isArray(displayMaterial)
            ? (displayMaterial as MeshStandardMaterial)
            : null;
        applyDestination(train);
        scene.add(object);
        map.triggerRepaint();
      })
      .catch(() => {});
  };

  const seen = new Set<string>();
  const syncVisibleTrains = () => {
    const bounds = paddedVisibleBounds(map, TRAIN_MODELS_ON_MAP_SETTINGS.viewportPadding);
    seen.clear();
    for (const instance of getMarkers()) {
      if (!instance.isNearView) continue;
      if (!isWithinBounds(bounds, instance.longitude, instance.latitude)) continue;
      seen.add(instance.key);
      let train = trains.get(instance.key);
      if (!train) {
        train = {
          instance,
          object: null,
          modelId: null,
          display: null,
          displayOriginal: null,
          displayKey: null,
          heading: instance.bearing ?? 0,
        };
        trains.set(instance.key, train);
        loadInto(train);
      }
      train.instance = instance;
      if (instance.bearing != null) train.heading = instance.bearing;
      applyDestination(train);
    }

    for (const [key, train] of trains) {
      if (seen.has(key)) continue;
      if (train.object) scene.remove(train.object);
      trains.delete(key);
    }
  };

  const placeTrains = (centre: MercatorCoordinate) => {
    const hasTerrain = map.getTerrain() != null;
    for (const train of trains.values()) {
      if (!train.object) continue;
      const { longitude, latitude } = train.instance;
      const elevation = hasTerrain ? (map.queryTerrainElevation([longitude, latitude]) ?? 0) : 0;
      const position = MercatorCoordinate.fromLngLat([longitude, latitude], elevation);
      const metres = position.meterInMercatorCoordinateUnits();

      train.object.matrix
        .makeTranslation(position.x - centre.x, position.y - centre.y, position.z)
        .multiply(scale.makeScale(metres, -metres, metres))
        .multiply(MODEL_UP_TO_MAP_UP)
        .multiply(heading.makeRotationY(MathUtils.degToRad(90 - train.heading)));
      train.object.matrixWorldNeedsUpdate = true;
    }
  };

  const layer: CustomLayerInterface = {
    id: TRAIN_MODELS_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd: (_map, gl) => {
      renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      renderer.toneMapping = NeutralToneMapping;
      renderer.toneMappingExposure = TRAIN_MODELS_ON_MAP_SETTINGS.exposure;
      const pmrem = new PMREMGenerator(renderer);
      environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      scene.environment = environment;
      renderer.resetState();
    },
    render: (gl, options) => {
      if (!renderer) return;
      if (map.getZoom() < TRAIN_MODELS_ON_MAP_SETTINGS.minZoom) return;
      syncVisibleTrains();
      if (trains.size === 0) return;

      // Positions are kept relative to the map centre so float32 precision holds at high zoom
      const centre = MercatorCoordinate.fromLngLat(map.getCenter());
      camera.projectionMatrix
        .fromArray(options.defaultProjectionData.mainMatrix)
        .multiply(centreOffset.makeTranslation(centre.x, centre.y, 0));
      placeTrains(centre);

      renderer.resetState();
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      renderer.render(scene, camera);
    },
    onRemove: () => {
      environment?.dispose();
      environment = null;
      renderer?.dispose();
      renderer = null;
    },
  };

  const destroy = () => {
    destroyed = true;
    for (const train of trains.values()) {
      if (train.object) scene.remove(train.object);
    }
    trains.clear();
    for (const material of displayMaterials.values()) material.dispose();
    displayMaterials.clear();
  };

  return { layer, destroy };
};
