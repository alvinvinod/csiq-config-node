import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decode, encode } from '../src/codec';
import { ConfigurationException } from '../src/exception';
import { AttributeType } from '../src/types';

describe('encode', () => {
  const cases: Array<[unknown, AttributeType, string]> = [
    [true, AttributeType.Boolean, 'true'],
    [false, AttributeType.Boolean, 'false'],
    [5, AttributeType.Number, '5'],
    [-3, AttributeType.Number, '-3'],
    ['x', AttributeType.String, '"x"'],
    ['', AttributeType.String, '""'],
    [['en-US', 'es-US'], AttributeType.Json, '["en-US","es-US"]'],
    [{ a: 1 }, AttributeType.Json, '{"a":1}'],
    [1.5, AttributeType.Json, '1.5'],
    [null, AttributeType.Json, 'null'],
  ];

  for (const [value, type, json] of cases) {
    it(`encodes ${json}`, () => {
      assert.deepEqual(encode(value), { type, json });
    });
  }

  it('wraps stringify failures as ConfigurationException', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => encode(cyclic, 'flag'), (err: unknown) => {
      assert.ok(err instanceof ConfigurationException);
      assert.match(err.message, /cannot encode value for flag/);
      return true;
    });
  });
});

describe('decode', () => {
  const cases: Array<[number, string | null, unknown]> = [
    [AttributeType.Boolean, 'true', true],
    [AttributeType.Boolean, 'false', false],
    [AttributeType.Bit, 'true', true],
    [AttributeType.Bit, 'false', false],
    [AttributeType.Number, '42', 42],
    [AttributeType.String, '"hello"', 'hello'],
    [AttributeType.Date, '"2026-10-30T00:00:00"', '2026-10-30T00:00:00'],
    [AttributeType.Json, '{"a":[1,2]}', { a: [1, 2] }],
    [AttributeType.Json, '["en-US"]', ['en-US']],
    [AttributeType.String, '', null],
    [AttributeType.Boolean, null, null],
  ];

  for (const [type, json, expected] of cases) {
    it(`decodes type ${type} ${String(json)}`, () => {
      assert.deepEqual(decode(type, json), expected);
    });
  }

  it('round-trips bool int string list and map', () => {
    for (const value of [true, 1234, '^\\+1\\d{10}$', ['en-US', 'es-US'], { languages: ['en-US'], limit: 3 }]) {
      const encoded = encode(value);
      assert.deepEqual(decode(encoded.type, encoded.json), value);
    }
  });

  const corrupt: Array<[number, string]> = [
    [AttributeType.Number, '1.5'],
    [AttributeType.Number, '99999999999999999999'],
    [AttributeType.Boolean, '"false"'],
    [AttributeType.String, '{"a":1}'],
    [AttributeType.String, 'not-json'],
  ];

  for (const [type, json] of corrupt) {
    it(`throws ConfigurationException for ${json} as type ${type}`, () => {
      assert.throws(() => decode(type, json, 'flag'), (err: unknown) => {
        assert.ok(err instanceof ConfigurationException);
        assert.match(err.message, /bad value for flag/);
        return true;
      });
    });
  }
});
