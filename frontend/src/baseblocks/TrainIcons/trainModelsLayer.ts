import {
  type CustomLayerInterface,
  type Map as MaplibreMap,
  MercatorCoordinate,
} from "maplibre-gl";
import {
  Box3,
  DirectionalLight,
  type Group,
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
import {
  type CarExtents,
  type ConsistCar,
  carOffsets,
  consistLayout,
  placeAlongTrain,
} from "./trainConsist";
import type { GetTrainMarkers, TrainMarker } from "./trainMarkers";

export const TRAIN_MODELS_ON_MAP_SETTINGS = {
  minZoom: 16,
  viewportPadding: 0.25,
  displayTextureWidth: 512,
  exposure: 1.1,
};

type CarModel = {
  id: string;
  scene: Group;
  extents: CarExtents;
};

type ConsistModels = {
  driving: CarModel;
  intermediate: CarModel;
};

type PlacedCar = {
  spec: ConsistCar;
  object: Object3D;
  modelId: string;
  display: Mesh | null;
  displayOriginal: MeshStandardMaterial | null;
  displayKey: string | null;
};

type PlacedTrain = {
  instance: TrainMarker;
  layoutKey: string;
  cars: PlacedCar[];
  offsets: number[];
  heading: number;
};

export type TrainModelsLayer = {
  layer: CustomLayerInterface;
  destroy: () => void;
};

const MODEL_UP_TO_MAP_UP = new Matrix4().makeRotationX(Math.PI / 2);

const loadCarModel = async (
  fleetCode: string | null,
  variant: "driving-lod" | "intermediate-lod"
): Promise<CarModel> => {
  const { id, scene } = await loadTrainModel(fleetCode, variant);
  const box = new Box3().setFromObject(scene);
  return { id, scene, extents: { front: box.max.x, rear: -box.min.x } };
};

const consistModelsByFleet = new Map<string, Promise<ConsistModels>>();

const loadConsistModels = (fleetCode: string | null): Promise<ConsistModels> => {
  const key = fleetCode ?? "";
  let models = consistModelsByFleet.get(key);
  if (!models) {
    models = Promise.all([
      loadCarModel(fleetCode, "driving-lod"),
      loadCarModel(fleetCode, "intermediate-lod"),
    ]).then(([driving, intermediate]) => ({ driving, intermediate }));
    consistModelsByFleet.set(key, models);
  }
  return models;
};

const layoutKeyFor = (marker: TrainMarker) => `${marker.fleetCode ?? ""}|${marker.carCount ?? ""}`;

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

  const applyDestination = (train: PlacedTrain, car: PlacedCar) => {
    if (!car.display || !car.displayOriginal) return;
    const { primary, secondary } = train.instance.destination;
    const key = `${car.modelId}|${primary}|${secondary ?? ""}`;
    if (car.displayKey === key) return;

    let shared = displayMaterials.get(key);
    if (!shared) {
      shared = createDestinationMaterial(
        car.displayOriginal,
        TRAIN_MODELS_ON_MAP_SETTINGS.displayTextureWidth
      );
      shared.update(train.instance.destination);
      displayMaterials.set(key, shared);
    }
    car.display.material = shared.material;
    car.displayKey = key;
  };

  const removeCars = (train: PlacedTrain) => {
    for (const car of train.cars) scene.remove(car.object);
    train.cars = [];
    train.offsets = [];
  };

  const buildCars = (train: PlacedTrain, models: ConsistModels) => {
    const layout = consistLayout(train.instance.fleetCode, train.instance.carCount);
    const extents: CarExtents[] = [];
    train.cars = layout.map((spec): PlacedCar => {
      const model = spec.kind === "driving" ? models.driving : models.intermediate;
      const object = model.scene.clone(true);
      object.matrixAutoUpdate = false;
      object.traverse((child) => {
        child.frustumCulled = false;
      });
      scene.add(object);
      extents.push(
        spec.reversed ? { front: model.extents.rear, rear: model.extents.front } : model.extents
      );

      const display = spec.kind === "driving" ? findDisplayMesh(object) : null;
      const displayMaterial = display?.material;
      const car: PlacedCar = {
        spec,
        object,
        modelId: model.id,
        display,
        displayOriginal:
          displayMaterial && !Array.isArray(displayMaterial)
            ? (displayMaterial as MeshStandardMaterial)
            : null,
        displayKey: null,
      };
      applyDestination(train, car);
      return car;
    });
    train.offsets = carOffsets(extents);
  };

  const loadCars = (train: PlacedTrain) => {
    const { layoutKey } = train;
    loadConsistModels(train.instance.fleetCode)
      .then((models) => {
        if (destroyed || trains.get(train.instance.key) !== train) return;
        if (train.layoutKey !== layoutKey) return;
        buildCars(train, models);
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

      const layoutKey = layoutKeyFor(instance);
      let train = trains.get(instance.key);
      if (!train) {
        train = { instance, layoutKey, cars: [], offsets: [], heading: instance.bearing ?? 0 };
        trains.set(instance.key, train);
        loadCars(train);
      }
      train.instance = instance;
      if (instance.bearing != null) train.heading = instance.bearing;
      if (train.layoutKey !== layoutKey) {
        train.layoutKey = layoutKey;
        removeCars(train);
        loadCars(train);
      }
      for (const car of train.cars) applyDestination(train, car);
    }

    for (const [key, train] of trains) {
      if (seen.has(key)) continue;
      removeCars(train);
      trains.delete(key);
    }
  };

  const placeTrains = (centre: MercatorCoordinate) => {
    const hasTerrain = map.getTerrain() != null;
    for (const train of trains.values()) {
      const { instance } = train;
      const trainCentre = {
        longitude: instance.longitude,
        latitude: instance.latitude,
        bearing: train.heading,
      };
      train.cars.forEach((car, index) => {
        const placed = placeAlongTrain(trainCentre, instance.track, train.offsets[index]);
        const elevation = hasTerrain
          ? (map.queryTerrainElevation([placed.longitude, placed.latitude]) ?? 0)
          : 0;
        const position = MercatorCoordinate.fromLngLat(
          [placed.longitude, placed.latitude],
          elevation
        );
        const metres = position.meterInMercatorCoordinateUnits();
        const carHeading = placed.bearing + (car.spec.reversed ? 180 : 0);

        car.object.matrix
          .makeTranslation(position.x - centre.x, position.y - centre.y, position.z)
          .multiply(scale.makeScale(metres, -metres, metres))
          .multiply(MODEL_UP_TO_MAP_UP)
          .multiply(heading.makeRotationY(MathUtils.degToRad(90 - carHeading)));
        car.object.matrixWorldNeedsUpdate = true;
      });
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
      renderer.resetState();
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
    for (const train of trains.values()) removeCars(train);
    trains.clear();
    for (const material of displayMaterials.values()) material.dispose();
    displayMaterials.clear();
  };

  return { layer, destroy };
};
