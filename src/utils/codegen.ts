export function escapeWithQuotes(text: string, char = '\'') {
  const stringified = JSON.stringify(text);
  const escapedText = stringified.substring(1, stringified.length - 1).replace(/\\"/g, '"');
  if (char === '\'')
    return char + escapedText.replace(/[']/g, `\\'`) + char;
  if (char === '"')
    return char + escapedText.replace(/[\"]/g, '\\"') + char;
  if (char === '`')
    return char + escapedText.replace(/[`]/g, '\\`') + char;
  throw new Error('Invalid escape char');
}

export function quote(text: string) {
  return escapeWithQuotes(text, '\'');
}

export function formatObject(value: any, indent = '  '): string {
  if (typeof value === 'string')
    return quote(value);
  if (Array.isArray(value))
    return `[${value.map(o => formatObject(o)).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    if (!keys.length)
      return '{}';
    const tokens = [];
    for (const key of keys)
      tokens.push(`${key}: ${formatObject(value[key])}`);
    return `{\n${indent}${tokens.join(`,\n${indent}`)}\n}`;
  }
  return String(value);
}
