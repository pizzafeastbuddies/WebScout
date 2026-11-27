import { describe, expect, it } from 'vitest';
import { isCorrect, isUnanswerable, normalizeAnswer } from './normalize';

describe('normalizeAnswer', () => {
  it('uppercases, drops whitespace and the characters - . · _', () => {
    expect(normalizeAnswer(' 7-abc 123 ')).toBe('7ABC123');
    expect(normalizeAnswer('京 A·12345')).toBe('京A12345');
    expect(normalizeAnswer('a_b.c')).toBe('ABC');
  });

  it('treats null and undefined as empty', () => {
    expect(normalizeAnswer(null)).toBe('');
    expect(normalizeAnswer(undefined)).toBe('');
  });
});

describe('isCorrect', () => {
  it('accepts any listed spelling after normalisation', () => {
    expect(isCorrect('george orwell', ['George Orwell'])).toBe(true);
    expect(isCorrect('Q3 FY27', ['q3fy27'])).toBe(true);
  });

  it('rejects a sentence, a wrong value or extra words', () => {
    expect(isCorrect('The capital is Santiago', ['Santiago'])).toBe(false);
    expect(isCorrect('Valparaiso', ['Santiago'])).toBe(false);
  });

  it('passes an empty answer only for unanswerable questions', () => {
    expect(isCorrect('', [''])).toBe(true);
    expect(isCorrect(null, [''])).toBe(true);
    expect(isCorrect('', ['Santiago'])).toBe(false);
    expect(isCorrect('something', [''])).toBe(false);
  });
});

describe('isUnanswerable', () => {
  it('detects the empty-answer marker', () => {
    expect(isUnanswerable([''])).toBe(true);
    expect(isUnanswerable(['x'])).toBe(false);
    expect(isUnanswerable([])).toBe(false);
  });
});
