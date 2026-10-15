import {
  type CustomLayerInterface,
  type Map as MaplibreMap,
  MercatorCoordinate,
} from "maplibre-gl";
import { TRAIN_POSITIONS_LAYER_ID } from "../trainMapLayers";
import {
  drawTrainIconAtlas,
  TRAIN_ICON_COLUMN_COUNT,
  TRAIN_ICON_COLUMNS,
  TRAIN_ICON_ROW_COUNT,
  TRAIN_ICON_ROWS,
} from "./trainIconImages";
import { type GetTrainMarkers, type TrainMarker, trainIconSizePx } from "./trainMarkers";

const ATLAS_CELL_PX = 128;
const ATLAS_GUTTER_PX = 16;
const STALE_OPACITY = 0.4;
const FLOATS_PER_INSTANCE = 11;
const WORLD_SIZE_AT_ZOOM_0 = 512;

const VERTEX_SHADER = `#version 300 es
in vec2 a_corner;
in vec3 a_position;
in vec2 a_rotation;
in vec3 a_style;
in vec3 a_tint;
uniform mat4 u_matrix;
uniform float u_size;
out vec2 v_cell;
flat out float v_column;
flat out float v_opacity;
flat out float v_delay;
flat out vec3 v_tint;
void main() {
  vec2 corner = a_corner * u_size;
  float s = a_rotation.x;
  float c = a_rotation.y;
  vec2 east_north = vec2(corner.x * c + corner.y * s, -corner.x * s + corner.y * c);
  gl_Position = u_matrix * vec4(a_position.xy + vec2(east_north.x, -east_north.y), a_position.z, 1.0);
  v_cell = vec2(a_corner.x + 0.5, 0.5 - a_corner.y);
  v_column = a_style.x;
  v_opacity = a_style.y;
  v_delay = a_style.z;
  v_tint = a_tint;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_cell;
flat in float v_column;
flat in float v_opacity;
flat in float v_delay;
flat in vec3 v_tint;
uniform sampler2D u_atlas;
uniform vec2 u_grid;
uniform float u_inset;
out vec4 fragColor;
vec4 layer(float row) {
  vec2 cell = vec2(v_column, row) + u_inset + v_cell * (1.0 - 2.0 * u_inset);
  return texture(u_atlas, cell / u_grid);
}
void main() {
  vec4 body = layer(${TRAIN_ICON_ROWS.body}.0);
  body.rgb *= v_tint;
  vec4 color = body + layer(${TRAIN_ICON_ROWS.under}.0) * (1.0 - body.a);
  vec4 over = layer(${TRAIN_ICON_ROWS.over}.0);
  color = over + color * (1.0 - over.a);
  if (v_delay > 0.5) {
    vec4 delay = layer(${TRAIN_ICON_ROWS.firstDelay - 1}.0 + v_delay);
    color = delay + color * (1.0 - delay.a);
  }
  fragColor = color * v_opacity;
}`;

type GlResources = {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  quad: WebGLBuffer;
  instances: WebGLBuffer;
  atlas: WebGLTexture;
  uniforms: {
    matrix: WebGLUniformLocation | null;
    size: WebGLUniformLocation | null;
    grid: WebGLUniformLocation | null;
    inset: WebGLUniformLocation | null;
    atlas: WebGLUniformLocation | null;
  };
};

export type TrainMarkersLayer = {
  layer: CustomLayerInterface;
  hideFromZoom: (minZoom: number | null) => void;
};

const compile = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed to compile");
  }
  return shader;
};

const createResources = (gl: WebGL2RenderingContext): GlResources => {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Shader program failed to link");
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    gl.STATIC_DRAW
  );
  const corner = gl.getAttribLocation(program, "a_corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  const stride = FLOATS_PER_INSTANCE * 4;
  const instanceAttributes: [string, number, number][] = [
    ["a_position", 3, 0],
    ["a_rotation", 2, 3],
    ["a_style", 3, 5],
    ["a_tint", 3, 8],
  ];
  for (const [name, size, offset] of instanceAttributes) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);

  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    drawTrainIconAtlas(ATLAS_CELL_PX, ATLAS_GUTTER_PX)
  );
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return {
    program,
    vao,
    quad,
    instances,
    atlas,
    uniforms: {
      matrix: gl.getUniformLocation(program, "u_matrix"),
      size: gl.getUniformLocation(program, "u_size"),
      grid: gl.getUniformLocation(program, "u_grid"),
      inset: gl.getUniformLocation(program, "u_inset"),
      atlas: gl.getUniformLocation(program, "u_atlas"),
    },
  };
};

const iconColumn = (marker: TrainMarker): number => {
  if (marker.bearing == null) {
    return marker.isSelected ? TRAIN_ICON_COLUMNS.dotSelected : TRAIN_ICON_COLUMNS.dot;
  }
  return marker.isSelected ? TRAIN_ICON_COLUMNS.arrowSelected : TRAIN_ICON_COLUMNS.arrow;
};

export const createTrainMarkersLayer = (
  map: MaplibreMap,
  getMarkers: GetTrainMarkers
): TrainMarkersLayer => {
  let gl: WebGL2RenderingContext | null = null;
  let resources: GlResources | null = null;
  let instanceData = new Float32Array(FLOATS_PER_INSTANCE * 256);
  let hiddenFromZoom: number | null = null;
  const matrix = new Float32Array(16);

  const writeInstance = (index: number, marker: TrainMarker, centre: MercatorCoordinate) => {
    const elevation = map.getTerrain()
      ? (map.queryTerrainElevation([marker.longitude, marker.latitude]) ?? 0)
      : 0;
    const position = MercatorCoordinate.fromLngLat([marker.longitude, marker.latitude], elevation);
    const bearing = ((marker.bearing ?? 0) * Math.PI) / 180;
    const offset = index * FLOATS_PER_INSTANCE;
    instanceData[offset] = position.x - centre.x;
    instanceData[offset + 1] = position.y - centre.y;
    instanceData[offset + 2] = position.z;
    instanceData[offset + 3] = Math.sin(bearing);
    instanceData[offset + 4] = Math.cos(bearing);
    instanceData[offset + 5] = iconColumn(marker);
    instanceData[offset + 6] = marker.isStale ? STALE_OPACITY : 1;
    instanceData[offset + 7] = marker.delayLevel;
    instanceData.set(marker.lineColor, offset + 8);
  };

  const layer: CustomLayerInterface = {
    id: TRAIN_POSITIONS_LAYER_ID,
    type: "custom",
    renderingMode: "2d",
    onAdd: (_map, context) => {
      gl = context as WebGL2RenderingContext;
      resources = createResources(gl);
    },
    render: (_gl, options) => {
      if (!gl || !resources) return;
      const zoom = map.getZoom();
      if (hiddenFromZoom != null && zoom >= hiddenFromZoom) return;

      const markers = getMarkers();
      if (markers.length === 0) return;
      if (instanceData.length < markers.length * FLOATS_PER_INSTANCE) {
        instanceData = new Float32Array(markers.length * FLOATS_PER_INSTANCE * 2);
      }

      const centre = MercatorCoordinate.fromLngLat(map.getCenter());
      let index = 0;
      for (const marker of markers) {
        if (marker.isNearView && !marker.isSelected) writeInstance(index++, marker, centre);
      }
      for (const marker of markers) {
        if (marker.isNearView && marker.isSelected) writeInstance(index++, marker, centre);
      }

      // Positions are relative to the map centre so float32 precision holds at high zoom
      const main = options.defaultProjectionData.mainMatrix;
      for (let i = 0; i < 12; i++) matrix[i] = main[i];
      for (let row = 0; row < 4; row++) {
        matrix[12 + row] = main[row] * centre.x + main[4 + row] * centre.y + main[12 + row];
      }

      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
      gl.useProgram(resources.program);
      gl.bindVertexArray(resources.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.instances);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        instanceData.subarray(0, index * FLOATS_PER_INSTANCE),
        gl.DYNAMIC_DRAW
      );
      gl.uniformMatrix4fv(resources.uniforms.matrix, false, matrix);
      gl.uniform1f(
        resources.uniforms.size,
        trainIconSizePx(zoom) / (WORLD_SIZE_AT_ZOOM_0 * 2 ** zoom)
      );
      gl.uniform2f(resources.uniforms.grid, TRAIN_ICON_COLUMN_COUNT, TRAIN_ICON_ROW_COUNT);
      gl.uniform1f(
        resources.uniforms.inset,
        ATLAS_GUTTER_PX / (ATLAS_CELL_PX + ATLAS_GUTTER_PX * 2)
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resources.atlas);
      gl.uniform1i(resources.uniforms.atlas, 0);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, index);

      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
    onRemove: () => {
      if (gl && resources) {
        gl.deleteProgram(resources.program);
        gl.deleteVertexArray(resources.vao);
        gl.deleteBuffer(resources.quad);
        gl.deleteBuffer(resources.instances);
        gl.deleteTexture(resources.atlas);
      }
      resources = null;
      gl = null;
    },
  };

  return {
    layer,
    hideFromZoom: (minZoom) => {
      hiddenFromZoom = minZoom;
      map.triggerRepaint();
    },
  };
};
