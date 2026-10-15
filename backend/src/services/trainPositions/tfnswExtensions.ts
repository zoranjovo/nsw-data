export type TfnswVehicleExtension = {
  vehicleModel: string | null;
  carriageCount: number;
};

type ProtoField = {
  number: number;
  wireType: number;
  start: number;
  end: number;
};

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

const FEED_MESSAGE_ENTITY = 2;
const FEED_ENTITY_ID = 1;
const FEED_ENTITY_VEHICLE = 4;
const VEHICLE_POSITION_VEHICLE = 8;
const TFNSW_EXTENSION = 1007;
const TFNSW_VEHICLE_MODEL = 3;

const textDecoder = new TextDecoder();

const readVarint = (binary: Uint8Array, offset: number): [number, number] => {
  let value = 0;
  let scale = 1;
  let position = offset;
  let byte: number;
  do {
    if (position >= binary.length) {
      throw new Error("Truncated protobuf varint");
    }
    byte = binary[position++];
    value += (byte & 0x7f) * scale;
    scale *= 128;
  } while (byte & 0x80);
  return [value, position];
};

function* readFields(binary: Uint8Array, start: number, end: number): Generator<ProtoField> {
  let offset = start;
  while (offset < end) {
    const [tag, afterTag] = readVarint(binary, offset);
    const wireType = tag % 8;
    let valueStart = afterTag;
    let valueEnd: number;
    switch (wireType) {
      case WIRE_VARINT:
        valueEnd = readVarint(binary, afterTag)[1];
        break;
      case WIRE_FIXED64:
        valueEnd = afterTag + 8;
        break;
      case WIRE_LENGTH_DELIMITED: {
        const [length, afterLength] = readVarint(binary, afterTag);
        valueStart = afterLength;
        valueEnd = afterLength + length;
        break;
      }
      case WIRE_FIXED32:
        valueEnd = afterTag + 4;
        break;
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
    if (valueEnd > end) {
      throw new Error("Truncated protobuf field");
    }
    yield { number: Math.floor(tag / 8), wireType, start: valueStart, end: valueEnd };
    offset = valueEnd;
  }
}

const isMessageField = (field: ProtoField, number: number) =>
  field.number === number && field.wireType === WIRE_LENGTH_DELIMITED;

const readVehicleModel = (binary: Uint8Array, descriptor: ProtoField): string | null => {
  for (const field of readFields(binary, descriptor.start, descriptor.end)) {
    if (!isMessageField(field, TFNSW_EXTENSION)) continue;
    for (const tfnswField of readFields(binary, field.start, field.end)) {
      if (isMessageField(tfnswField, TFNSW_VEHICLE_MODEL)) {
        const model = textDecoder.decode(binary.subarray(tfnswField.start, tfnswField.end)).trim();
        return model || null;
      }
    }
  }
  return null;
};

const readVehiclePosition = (
  binary: Uint8Array,
  vehiclePosition: ProtoField
): TfnswVehicleExtension => {
  let vehicleModel: string | null = null;
  let carriageCount = 0;
  for (const field of readFields(binary, vehiclePosition.start, vehiclePosition.end)) {
    if (isMessageField(field, VEHICLE_POSITION_VEHICLE)) {
      vehicleModel = readVehicleModel(binary, field) ?? vehicleModel;
    } else if (isMessageField(field, TFNSW_EXTENSION)) {
      carriageCount++;
    }
  }
  return { vehicleModel, carriageCount };
};

export const readTfnswVehicleExtensions = (
  binary: Uint8Array
): Map<string, TfnswVehicleExtension> => {
  const extensionsByEntityId = new Map<string, TfnswVehicleExtension>();

  for (const entity of readFields(binary, 0, binary.length)) {
    if (!isMessageField(entity, FEED_MESSAGE_ENTITY)) continue;

    let entityId: string | null = null;
    let extension: TfnswVehicleExtension | null = null;
    for (const field of readFields(binary, entity.start, entity.end)) {
      if (isMessageField(field, FEED_ENTITY_ID)) {
        entityId = textDecoder.decode(binary.subarray(field.start, field.end));
      } else if (isMessageField(field, FEED_ENTITY_VEHICLE)) {
        extension = readVehiclePosition(binary, field);
      }
    }

    if (entityId != null && extension != null) {
      extensionsByEntityId.set(entityId, extension);
    }
  }

  return extensionsByEntityId;
};
