function parseWecomXml(xml) {
  const source = String(xml || "").trim();
  if (!source) {
    return {};
  }

  const bodyMatch = source.match(/<xml[^>]*>([\s\S]*?)<\/xml>/i);
  const body = bodyMatch ? bodyMatch[1] : source;
  const result = {};
  const tagRegex = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let match;

  while ((match = tagRegex.exec(body)) !== null) {
    const [, key, rawValue] = match;
    const value = normalizeXmlValue(rawValue);
    if (value.includes("<") && value.includes(">")) {
      result[key] = parseWecomXml(value);
      continue;
    }
    result[key] = value;
  }

  return result;
}

function normalizeXmlValue(value) {
  const input = String(value || "").trim();
  const cdataMatch = input.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch) {
    return cdataMatch[1];
  }
  return input;
}

module.exports = {
  parseWecomXml,
};
