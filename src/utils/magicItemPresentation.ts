import type { magicItems } from '../data/magicItems';

export type CatalogItem = (typeof magicItems)[number] & { materialMetadataHtml: string };
export const rarityLabels: Record<string, string> = {
  Common: 'Обычный', Uncommon: 'Необычный', Rare: 'Редкий',
  'Very Rare': 'Очень редкий', Legendary: 'Легендарный', Artifact: 'Артефакт',
};
export const tableLabels: Record<string, string> = { A: 'Магия', Ar: 'Вооружения', I: 'Инструменты', R: 'Реликвии' };
export const craftingTools: Record<number, string> = {
  0: 'См. инструменты для немагического аналога',
  1: 'Инструменты алхимика', 2: 'Инструменты гончара', 3: 'Инструменты каллиграфа',
  4: 'Инструменты каменщика', 5: 'Инструменты картографа', 6: 'Инструменты кожевника',
  7: 'Инструменты кузнеца', 8: 'Инструменты пивовара', 9: 'Инструменты плотника',
  10: 'Инструменты повара', 11: 'Инструменты резчика по дереву', 12: 'Инструменты ремонтника',
  13: 'Инструменты сапожника', 14: 'Инструменты стеклодува', 15: 'Инструменты ткача',
  16: 'Инструменты художника', 17: 'Инструменты ювелира', 18: 'Набор отравителя',
  19: 'Набор травника', 20: 'Набор для маскировки',
  98: 'Требуется доплата за немагический аналог', 99: 'Невозможно создать',
};
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}
export function renderMagicItemDetails(item: CatalogItem): string {
  const rarityClass = item.rarity.toLowerCase().replaceAll(' ', '-');
  const tools = item.craftingTools.map(index => craftingTools[index]).filter(Boolean);
  const tables = (Array.isArray(item.table) ? item.table : item.table ? [item.table] : []).map(code => tableLabels[code] || code);
  // Descriptions, base analog links and metadata are trusted, repository-owned HTML.
  return `<header class="item-header">
    <h2 id="selected-item-title" tabindex="-1">${escapeHtml(item.name)}</h2>
    <p class="item-name-en" lang="en">${escapeHtml(item.nameEn)}</p>
    <div class="item-badges"><span class="rarity ${rarityClass}">${rarityLabels[item.rarity]}</span><span>${escapeHtml(item.type)}</span></div>
    <p class="attunement-status">${item.attunement ? `Требует настройки${item.attunementRequirement ? ` ${escapeHtml(item.attunementRequirement)}` : ''}` : 'Не требует настройки'}</p>
  </header>
  <div class="item-description">${item.description}</div>
  ${item.developerComment ? `<aside class="developer-comment"><h3>Комментарий разработчика</h3>${item.developerComment}</aside>` : ''}
  <details class="item-reference"><summary>Изготовление и справочные сведения</summary><div class="item-reference-body">
    ${tables.length ? `<p><strong>Таблица:</strong> ${tables.join(', ')}</p>` : ''}
    <p><strong>Вес:</strong> ${escapeHtml(item.weight)}</p>
    ${item.baseAnalog ? `<p><strong>Базовый аналог:</strong> ${item.baseAnalog}</p>` : ''}
    ${tools.length ? `<p><strong>Инструменты для изготовления:</strong> ${tools.map(escapeHtml).join('; ')}</p>` : ''}
  </div></details>
  ${item.materialMetadataHtml}`;
}
