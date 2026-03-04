/**
 * Lightweight prompt template engine.
 * Supports {{variable}}, {{#if variable}}...{{/if}}, {{#each array}}...{{/each}}.
 */

export function renderPrompt(template: string, context: Record<string, unknown>): string {
  let result = template;

  // Process {{#each key}}...{{/each}} blocks
  result = result.replace(
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, key: string, body: string) => {
      const value = context[key];
      if (!Array.isArray(value)) return '';
      return value.map((item, index) => {
        let rendered = body;
        if (typeof item === 'object' && item !== null) {
          for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
            rendered = rendered.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? ''));
          }
        } else {
          rendered = rendered.replace(/\{\{this\}\}/g, String(item));
        }
        rendered = rendered.replace(/\{\{@index\}\}/g, String(index));
        return rendered;
      }).join('');
    },
  );

  // Process {{#if key}}...{{/if}} blocks
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, key: string, body: string) => {
      const value = context[key];
      if (!value || (Array.isArray(value) && value.length === 0)) return '';
      return body;
    },
  );

  // Process {{variable}} substitutions
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = context[key];
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });

  return result;
}
