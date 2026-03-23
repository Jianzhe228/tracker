/**
 * Tests for promptEngine template rendering.
 */
import { describe, it, expect } from 'vitest';
import { renderPrompt } from '../promptEngine';

describe('renderPrompt', () => {
  describe('variable substitution {{var}}', () => {
    it('replaces string variable', () => {
      expect(renderPrompt('Hello {{name}}', { name: 'World' })).toBe('Hello World');
    });

    it('replaces number variable', () => {
      expect(renderPrompt('Count: {{num}}', { num: 42 })).toBe('Count: 42');
    });

    it('replaces boolean variable', () => {
      expect(renderPrompt('Flag: {{flag}}', { flag: true })).toBe('Flag: true');
    });

    it('replaces null with empty string', () => {
      expect(renderPrompt('Value: {{val}}', { val: null })).toBe('Value: ');
    });

    it('replaces undefined with empty string', () => {
      expect(renderPrompt('Value: {{val}}', { val: undefined })).toBe('Value: ');
    });

    it('joins array with comma-space', () => {
      expect(renderPrompt('Items: {{items}}', { items: ['a', 'b', 'c'] })).toBe('Items: a, b, c');
    });

    it('JSON-encodes object', () => {
      expect(renderPrompt('Data: {{obj}}', { obj: { x: 1, y: 2 } })).toBe('Data: {"x":1,"y":2}');
    });

    it('replaces multiple variables', () => {
      expect(renderPrompt('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 })).toBe('1 + 2 = 3');
    });

    it('leaves unknown variable as empty string', () => {
      expect(renderPrompt('Hello {{unknown}}', {})).toBe('Hello ');
    });

    it('returns template unchanged when no variables', () => {
      expect(renderPrompt('Hello World', {})).toBe('Hello World');
    });

    it('handles empty template', () => {
      expect(renderPrompt('', { name: 'test' })).toBe('');
    });
  });

  describe('conditional blocks {{#if}}...{{/if}}', () => {
    it('renders body when value is truthy string', () => {
      expect(renderPrompt('{{#if show}}visible{{/if}}', { show: 'yes' })).toBe('visible');
    });

    it('renders body when value is non-zero number', () => {
      expect(renderPrompt('{{#if count}}visible{{/if}}', { count: 1 })).toBe('visible');
    });

    it('renders body when value is true', () => {
      expect(renderPrompt('{{#if flag}}visible{{/if}}', { flag: true })).toBe('visible');
    });

    it('removes block when value is false', () => {
      expect(renderPrompt('{{#if flag}}visible{{/if}}', { flag: false })).toBe('');
    });

    it('removes block when value is empty string', () => {
      expect(renderPrompt('{{#if text}}visible{{/if}}', { text: '' })).toBe('');
    });

    it('removes block when value is zero', () => {
      expect(renderPrompt('{{#if count}}visible{{/if}}', { count: 0 })).toBe('');
    });

    it('removes block when value is null', () => {
      expect(renderPrompt('{{#if val}}visible{{/if}}', { val: null })).toBe('');
    });

    it('removes block when value is undefined', () => {
      expect(renderPrompt('{{#if val}}visible{{/if}}', {})).toBe('');
    });

    it('removes block when value is empty array', () => {
      expect(renderPrompt('{{#if items}}visible{{/if}}', { items: [] })).toBe('');
    });

    it('renders body when value is non-empty array', () => {
      expect(renderPrompt('{{#if items}}visible{{/if}}', { items: [1] })).toBe('visible');
    });

    it('handles multiple if blocks', () => {
      const tmpl = '{{#if a}}A{{/if}}{{#if b}}B{{/if}}{{#if c}}C{{/if}}';
      expect(renderPrompt(tmpl, { a: true, b: false, c: true })).toBe('AC');
    });
  });

  describe('each blocks {{#each}}...{{/each}}', () => {
    it('iterates over array of primitives with {{this}}', () => {
      const tmpl = '{{#each items}}- {{this}}\n{{/each}}';
      expect(renderPrompt(tmpl, { items: ['apple', 'banana'] })).toBe('- apple\n- banana\n');
    });

    it('renders object properties with {{field}}', () => {
      const tmpl = '{{#each users}}{{name}}:{{age}} {{/each}}';
      expect(renderPrompt(tmpl, { users: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }] }))
        .toBe('Alice:30 Bob:25 ');
    });

    it('provides {{@index}}', () => {
      const tmpl = '{{#each items}}{{@index}}:{{this}} {{/each}}';
      expect(renderPrompt(tmpl, { items: ['a', 'b', 'c'] })).toBe('0:a 1:b 2:c ');
    });

    it('renders empty string for empty array', () => {
      const tmpl = '{{#each items}}item{{/each}}';
      expect(renderPrompt(tmpl, { items: [] })).toBe('');
    });

    it('handles null value for each', () => {
      const tmpl = '{{#each items}}item{{/each}}';
      expect(renderPrompt(tmpl, { items: null })).toBe('');
    });

    it('handles undefined value for each', () => {
      const tmpl = '{{#each items}}item{{/each}}';
      expect(renderPrompt(tmpl, {})).toBe('');
    });

    it('nested if inside each (if not processed inside each body)', () => {
      // #if inside #each is not supported — #each is processed first,
      // then #if looks up context keys (not each-item "this").
      // The {{#if this}} block remains unresolved after #each, then #if
      // treats "this" as a context key (undefined) → removed.
      const tmpl = '{{#each items}}{{#if this}}{{this}}{{/if}}{{/each}}';
      expect(renderPrompt(tmpl, { items: ['a', '', 'c'] })).toBe('');
    });
  });

  describe('complex templates', () => {
    it('each with object having null fields', () => {
      const tmpl = '{{#each users}}{{name}}|{{/each}}';
      expect(renderPrompt(tmpl, { users: [{ name: 'A' }, { name: null }, { name: 'C' }] }))
        .toBe('A||C|');
    });

    it('variable substitution after each', () => {
      const tmpl = '{{#each items}}{{this}} {{/each}}Total: {{count}}';
      expect(renderPrompt(tmpl, { items: ['a', 'b'], count: 2 })).toBe('a b Total: 2');
    });

    it('if outside each with variable from context', () => {
      const tmpl = '{{#if show}}{{#each items}}{{this}}{{/each}}{{/if}}';
      expect(renderPrompt(tmpl, { show: true, items: ['x', 'y'] })).toBe('xy');
      expect(renderPrompt(tmpl, { show: false, items: ['x', 'y'] })).toBe('');
    });

    it('template with mixed syntax', () => {
      const tmpl = `
Project: {{project}}
{{#if tasks}}Tasks:{{/if}}
{{#each tasks}}  - {{this}}{{@index}}{{/each}}
Status: {{status}}
`.trim();
      const result = renderPrompt(tmpl, {
        project: 'Test',
        tasks: ['task1', 'task2'],
        status: 'active',
      });
      expect(result).toBe('Project: Test\nTasks:\n  - task10  - task21\nStatus: active');
    });
  });

  describe('edge cases', () => {
    it('handles malformed each block (non-array value)', () => {
      const tmpl = '{{#each items}}{{this}}{{/each}}';
      expect(renderPrompt(tmpl, { items: 'not an array' })).toBe('');
    });

    it('handles object as value (JSON fallback)', () => {
      const tmpl = '{{#each items}}{{this}}{{/each}}';
      expect(renderPrompt(tmpl, { items: { a: 1 } })).toBe('');
    });

    it('preserves whitespace in template', () => {
      // {{a}} (4 chars) replaced by 'x' (1 char), spacing between vars preserved
      expect(renderPrompt('  {{a}}  {{b}}  ', { a: 'x', b: 'y' })).toBe('  x  y  ');
    });

    it('handles duplicate variable names', () => {
      expect(renderPrompt('{{a}} {{a}}', { a: 'same' })).toBe('same same');
    });
  });
});
