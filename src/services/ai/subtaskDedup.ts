const TITLE_NOISE_RE = /[\s　"'`“”‘’、，。！？,.!?:：;；\-_/()（）[\]【】·]+/g;
const TITLE_PARTICLE_RE = /[的地得]/g;

export function normalizeSubtaskTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(TITLE_NOISE_RE, '')
    .replace(TITLE_PARTICLE_RE, '');
}

export function isSemanticDuplicateTitle(left: string, right: string): boolean {
  const normalizedLeft = normalizeSubtaskTitle(left);
  const normalizedRight = normalizeSubtaskTitle(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const [shorter, longer] = normalizedLeft.length <= normalizedRight.length
    ? [normalizedLeft, normalizedRight]
    : [normalizedRight, normalizedLeft];

  if (shorter.length < 2) return false;

  return longer.includes(shorter);
}
