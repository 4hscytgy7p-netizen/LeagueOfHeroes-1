export type SpellFilterState = 'neutral' | 'include' | 'exclude';

export interface SpellFilterOption {
  value: string;
  state: SpellFilterState;
}

export function matchesSpellFilter(
  values: readonly string[],
  options: readonly SpellFilterOption[],
  requireAll = false,
): boolean {
  const included = options.filter(option => option.state === 'include');
  if (options.some(option => option.state === 'exclude' && values.includes(option.value))) return false;
  if (!included.length) return true;
  return requireAll
    ? included.every(option => values.includes(option.value))
    : included.some(option => values.includes(option.value));
}

export function getMaterialComponentTraits(material = '') {
  const text = material.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  // Accept spaced prices, a trailing '+', all coin denominations, and explicit coin counts.
  const price = /\d[\d\s.,]*\+?\s*(?:(?:зм|см|мм|эм|пм|gp|sp|cp|ep|pp)(?![\p{L}])|(?:медн|серебрян|золот|электрум|платинов)[а-яё]*\s+монет[а-яё]*)/iu;
  let hasPricedConsumable = false;
  let clauseStart = 0;
  // Consumption qualifies the preceding components, up to the previous consumption clause.
  // This keeps an unpriced consumed reagent separate from a later, reusable priced focus.
  for (const match of text.matchAll(/(?:не\s+)?расход[а-яё]*/gu)) {
    if (!match[0].startsWith('не ') && price.test(text.slice(clauseStart, match.index))) {
      hasPricedConsumable = true;
    }
    clauseStart = match.index + match[0].length;
  }
  return { hasPrice: price.test(text), hasPricedConsumable };
}
