/**
 * Tests for validation utility functions.
 */
import { describe, it, expect } from 'vitest';
import { validateTaskTitle } from '../validation';

describe('validateTaskTitle', () => {
  describe('valid titles', () => {
    it('accepts a normal title', () => {
      expect(validateTaskTitle('Buy groceries')).toBe(true);
    });

    it('accepts a single character title', () => {
      expect(validateTaskTitle('A')).toBe(true);
    });

    it('accepts a title with exactly 100 characters', () => {
      const title = 'a'.repeat(100);
      expect(validateTaskTitle(title)).toBe(true);
    });

    it('accepts a title with leading/trailing spaces that trims to valid length', () => {
      expect(validateTaskTitle('  hello  ')).toBe(true);
    });

    it('accepts a title with special characters', () => {
      expect(validateTaskTitle('Fix bug #123 -- urgent!')).toBe(true);
    });

    it('accepts a title with unicode characters', () => {
      expect(validateTaskTitle('完成项目报告')).toBe(true);
    });

    it('accepts a title with numbers only', () => {
      expect(validateTaskTitle('12345')).toBe(true);
    });
  });

  describe('invalid titles', () => {
    it('rejects an empty string', () => {
      expect(validateTaskTitle('')).toBe(false);
    });

    it('rejects a string with only spaces', () => {
      expect(validateTaskTitle('   ')).toBe(false);
    });

    it('rejects a string with only a tab', () => {
      expect(validateTaskTitle('\t')).toBe(false);
    });

    it('rejects a string with only newline', () => {
      expect(validateTaskTitle('\n')).toBe(false);
    });

    it('rejects a string with mixed whitespace only', () => {
      expect(validateTaskTitle(' \t \n ')).toBe(false);
    });

    it('rejects a title longer than 100 characters after trim', () => {
      const title = 'a'.repeat(101);
      expect(validateTaskTitle(title)).toBe(false);
    });

    it('rejects a title with padding that exceeds 100 chars after trim', () => {
      const title = '   ' + 'b'.repeat(101) + '   ';
      expect(validateTaskTitle(title)).toBe(false);
    });
  });

  describe('boundary cases', () => {
    it('accepts a title that trims to exactly 1 character', () => {
      expect(validateTaskTitle('  x  ')).toBe(true);
    });

    it('accepts a title that trims to exactly 100 characters', () => {
      const title = '  ' + 'c'.repeat(100) + '  ';
      expect(validateTaskTitle(title)).toBe(true);
    });

    it('rejects a title that trims to exactly 101 characters', () => {
      const title = '  ' + 'd'.repeat(101) + '  ';
      expect(validateTaskTitle(title)).toBe(false);
    });

    it('rejects a title with spaces padding that trims to empty', () => {
      expect(validateTaskTitle('     ')).toBe(false);
    });
  });
});
