import { describe, it, expect } from 'vitest';
import { coerceToArray } from '../../src/extraction/claudeProvider.js';

describe('coerceToArray', () => {
  it('wraps a string in a single-element array', () => {
    expect(coerceToArray('Москва')).toEqual(['Москва']);
  });

  it('passes an existing array through unchanged', () => {
    const arr = ['Москва', 'Санкт-Петербург'];
    expect(coerceToArray(arr)).toEqual(arr);
  });

  it('returns undefined for undefined', () => {
    expect(coerceToArray(undefined)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(coerceToArray(null)).toBeUndefined();
  });
});
