export type TrainTrackCoordinate = [longitude: number, latitude: number];

export type TrainTrackGeometry = {
  type: "LineString";
  coordinates: TrainTrackCoordinate[];
};

export type TrainTrackProperties = {
  objectid: number;
  shape_id: string;
  route_id: string;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
  route_desc: string;
  route_type: string;
  route_color: string;
  route_text_color: string;
  route_type_text: string;
  length: number;
};

export type TrainTrackFeature = {
  type: "Feature";
  geometry: TrainTrackGeometry;
  properties: TrainTrackProperties;
};

export type TrainTracksResponse = {
  type: "FeatureCollection";
  name: string;
  features: TrainTrackFeature[];
};
