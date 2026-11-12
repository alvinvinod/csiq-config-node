import { AttributeType } from './types';

export type EncodedValue = { type: AttributeType; json: string };

/** Pack a JS value into the protobuf type/value pair the service stores. */
export function encode(value: unknown): EncodedValue {
  if (typeof value === 'boolean') {
    return { type: AttributeType.Boolean, json: JSON.stringify(value) };
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { type: AttributeType.Number, json: JSON.stringify(value) };
  }
  if (typeof value === 'string') {
    return { type: AttributeType.String, json: JSON.stringify(value) };
  }
  return { type: AttributeType.Json, json: JSON.stringify(value) };
}

export function decode(type: number, json: string | null | undefined): unknown {
  if (json === null || json === undefined || json === '') {
    return null;
  }

  switch (type) {
    case AttributeType.Boolean:
    case AttributeType.Bit:
      return Boolean(JSON.parse(json));
    case AttributeType.Number:
      return Number.parseInt(String(JSON.parse(json)), 10);
    case AttributeType.String:
      return String(JSON.parse(json));
    case AttributeType.Date:
      return String(JSON.parse(json));
    default:
      return JSON.parse(json);
  }
}
