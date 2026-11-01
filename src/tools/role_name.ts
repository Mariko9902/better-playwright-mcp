function parseRegexLikeString(value: string): RegExp | undefined {
  const raw = String(value);
  if (!raw.startsWith('/') || raw.length < 2)
    return undefined;
  const lastSlash = raw.lastIndexOf('/');
  if (lastSlash <= 0)
    return undefined;
  const pattern = raw.slice(1, lastSlash);
  const flags = raw.slice(lastSlash + 1);
  if (!/^[gimsuy]*$/.test(flags))
    return undefined;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return undefined;
  }
}

export function parseRoleNameOption(value: any): string | RegExp {
  const raw = String(value);
  const re = parseRegexLikeString(raw);
  if (re)
    return re;
  const hasSpace = /\s/.test(raw);
  if (!hasSpace && raw.length >= 2 && /^[\u3400-\u9FFF]+$/.test(raw)) {
    const pattern = raw.split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    return new RegExp(`^${pattern}$`);
  }
  return raw;
}

export function buildFuzzyRoleNameOption(value: any): RegExp | undefined {
  const raw = String(value).trim();
  if (!raw)
    return undefined;
  const explicitRe = parseRegexLikeString(raw);
  if (explicitRe) {
    const source = explicitRe.source.replace(/^\^/, '').replace(/\$$/, '');
    return new RegExp(`.*(?:${source}).*`, explicitRe.flags);
  }
  const hasSpace = /\s/.test(raw);
  if (!hasSpace && raw.length >= 2 && /^[\u3400-\u9FFF]+$/.test(raw)) {
    const pattern = raw.split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    return new RegExp(`.*(?:${pattern}).*`);
  }
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\s+/g, '\\s*');
  return new RegExp(`.*(?:${pattern}).*`);
}
