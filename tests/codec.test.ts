import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decode, encode } from '../src/codec';
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
});

describe('decode', () => {
  const cases: Array<[number, string | null, unknown]> = [
    [AttributeType.Boolean, 'true', true],
    [AttributeType.Boolean, 'false', false],
    [AttributeType.Bit, '1', true],
    [AttributeType.Bit, '0', false],
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
});
