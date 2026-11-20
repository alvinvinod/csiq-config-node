import { ConfigurationException } from './exception';
import { AttributeType } from './types';

export type EncodedValue = { type: AttributeType; json: string };

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** Pack a JS value into the protobuf type/value pair the service stores. */
export function encode(value: unknown, name = ''): EncodedValue {
  try {
    if (typeof value === 'boolean') {
      return { type: AttributeType.Boolean, json: JSON.stringify(value) };
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      return { type: AttributeType.Number, json: JSON.stringify(value) };
    }
    if (typeof value === 'string') {
      return { type: AttributeType.String, json: JSON.stringify(value) };
    }
    const json = JSON.stringify(value);
    if (typeof json !== 'string') {
      throw new ConfigurationException(encodeError(name));
    }
    return { type: AttributeType.Json, json };
  } catch (err) {
    if (err instanceof ConfigurationException) {
      throw err;
    }
    throw new ConfigurationException(encodeError(name), 0);
  }
}

export function decode(type: number, json: string | null | undefined, name = ''): unknown {
  if (json === null || json === undefined || json === '') {
    return null;
  }

  try {
    const decoded = JSON.parse(json);
    switch (type) {
      case AttributeType.Boolean:
      case AttributeType.Bit:
        return expectBool(decoded, name);
      case AttributeType.Number:
        return expectInt32Number(decoded, name);
      case AttributeType.String:
      case AttributeType.Date:
        return expectString(decoded, name);
      default:
        return decoded;
    }
  } catch (err) {
    if (err instanceof ConfigurationException) {
      throw err;
    }
    throw new ConfigurationException(decodeError(name), 0);
  }
}

function expectBool(decoded: unknown, name: string): boolean {
  if (typeof decoded !== 'boolean') {
    throw new ConfigurationException(decodeError(name));
  }
  return decoded;
}

function expectInt32Number(decoded: unknown, name: string): number {
  if (typeof decoded !== 'number' || !Number.isInteger(decoded) || decoded < INT32_MIN || decoded > INT32_MAX) {
    throw new ConfigurationException(decodeError(name));
  }
  return decoded;
}

function expectString(decoded: unknown, name: string): string {
  if (typeof decoded !== 'string') {
    throw new ConfigurationException(decodeError(name));
  }
  return decoded;
}

function decodeError(name: string): string {
  return name ? `bad value for ${name}` : 'bad stored value';
}

function encodeError(name: string): string {
  return name ? `cannot encode value for ${name}` : 'cannot encode value';
}
