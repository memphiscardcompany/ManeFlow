import test from 'node:test';
import assert from 'node:assert/strict';
import { importGenericTcgCatalogCsv, importLorcastCatalog, importPokemonTcgApiCatalog, importScryfallCatalog, importTcgDexCatalog, importYgoProDeckCatalog } from '../src/services/tcg-catalog-importer.js';
import { smartCatalogAutocomplete } from '../src/services/catalog-autocomplete.js';

test('Pokemon TCG API exports normalize into ManeFlow catalog rows', () => {
  const result = importPokemonTcgApiCatalog({ data: [{
    id: 'sv3pt5-173',
    name: 'Pikachu',
    supertype: 'Pokemon',
    subtypes: ['Basic'],
    number: '173',
    rarity: 'Illustration Rare',
    set: { id: 'sv3pt5', name: 'Scarlet & Violet 151', series: 'Scarlet & Violet', releaseDate: '2023/09/22' },
    images: { small: 'https://images.pokemontcg.io/sv3pt5/173.png' },
  }] });
  assert.equal(result.summary.unique, 1);
  assert.equal(result.cards[0].sport, 'Pokemon');
  assert.equal(result.cards[0].brand, 'Pokemon');
  assert.equal(result.cards[0].cardNumber, '173');
  assert.match(result.cards[0].parallel, /Illustration Rare/);
  const auto = smartCatalogAutocomplete(result.cards, { q: 'SV 151 Pikachu 173 illustration', limit: 5 });
  assert.equal(auto.candidates[0].id, result.cards[0].id);
});

test('Scryfall bulk exports normalize Magic cards without treating prices as comps', () => {
  const result = importScryfallCatalog([{
    id: 'scryfall-black-lotus',
    name: 'Black Lotus',
    set_name: 'Limited Edition Alpha',
    set: 'lea',
    collector_number: '232',
    rarity: 'rare',
    finishes: ['nonfoil'],
    released_at: '1993-08-05',
    image_uris: { small: 'https://cards.scryfall.io/small/front/example.jpg' },
    prices: { usd: '999999.99' },
  }]);
  assert.equal(result.summary.unique, 1);
  const [card] = result.cards;
  assert.equal(card.sport, 'Magic: The Gathering');
  assert.equal(card.brand, 'Magic: The Gathering');
  assert.equal(card.cardNumber, '232');
  assert.doesNotMatch(JSON.stringify(card), /999999/);
});

test('generic TCG CSV imports popular card-game checklist rows', () => {
  const csv = [
    'game,setName,name,number,rarity,year',
    'Lorcana,The First Chapter,Elsa - Spirit of Winter,42,Legendary,2023',
    'One Piece Card Game,Romance Dawn,Monkey.D.Luffy,OP01-003,Leader,2022',
  ].join('\n');
  const result = importGenericTcgCatalogCsv(csv, { sourceName: 'authorized_tcg_csv' });
  assert.equal(result.summary.unique, 2);
  assert.equal(result.cards[0].catalogSource, 'authorized_tcg_csv');
  const auto = smartCatalogAutocomplete(result.cards, { q: 'Monkey D Luffy OP01-003', limit: 5 });
  assert.equal(auto.candidates[0].cardNumber, 'OP01-003');
});

test('Lorcast API exports normalize Lorcana cards with returned image URIs', () => {
  const result = importLorcastCatalog({ cards: [{
    id: 'crd_test_elsa',
    name: 'Elsa - Spirit of Winter',
    collector_number: '42',
    rarity: 'Legendary',
    colors: ['Amethyst'],
    image_uris: {
      digital: {
        small: 'https://cards.lorcast.io/card/digital/small/crd_test_elsa.avif?1709690747',
        normal: 'https://cards.lorcast.io/card/digital/normal/crd_test_elsa.avif?1709690747',
      },
    },
    set: { name: 'The First Chapter', released_at: '2023-08-18' },
  }] });
  assert.equal(result.summary.unique, 1);
  assert.equal(result.cards[0].sport, 'Disney Lorcana');
  assert.equal(result.cards[0].image, 'https://cards.lorcast.io/card/digital/small/crd_test_elsa.avif?1709690747');
  const auto = smartCatalogAutocomplete(result.cards, { q: 'Elsa 42 legendary', limit: 5 });
  assert.equal(auto.candidates[0].id, result.cards[0].id);
});

test('TCGdex API exports normalize Pokemon cards with remote image references', () => {
  const result = importTcgDexCatalog({
    cards: [{
      id: 'sv03-173',
      name: 'Charizard ex',
      localId: '173',
      rarity: 'Special Illustration Rare',
      category: 'Pokemon',
      image: 'https://assets.tcgdex.net/en/sv/sv03/173/low.png',
      set: { id: 'sv03', name: 'Obsidian Flames', releaseDate: '2023-08-11' },
      variants: { normal: true, reverse: true },
    }],
  });
  assert.equal(result.summary.unique, 1);
  assert.equal(result.cards[0].sport, 'Pokemon');
  assert.equal(result.cards[0].cardNumber, '173');
  assert.equal(result.cards[0].image, 'https://assets.tcgdex.net/en/sv/sv03/173/low.png');
  const auto = smartCatalogAutocomplete(result.cards, { q: 'Obsidian Flames Charizard 173 special illustration', limit: 5 });
  assert.equal(auto.candidates[0].id, result.cards[0].id);
});

test('YGOPRODeck API exports one catalog row per printed set code', () => {
  const result = importYgoProDeckCatalog({ data: [{
    id: 89631139,
    name: 'Blue-Eyes White Dragon',
    type: 'Normal Monster',
    race: 'Dragon',
    attribute: 'LIGHT',
    desc: 'This legendary dragon is a powerful engine of destruction.',
    card_images: [{ image_url_small: 'https://images.ygoprodeck.com/images/cards_small/89631139.jpg' }],
    card_sets: [
      { set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB-001', set_rarity: 'Ultra Rare' },
      { set_name: 'Starter Deck Kaiba', set_code: 'SDK-001', set_rarity: 'Ultra Rare' },
    ],
  }] });
  assert.equal(result.summary.unique, 2);
  assert.deepEqual(result.cards.map((card) => card.cardNumber), ['LOB-001', 'SDK-001']);
  assert.equal(result.cards[0].sport, 'Yu-Gi-Oh!');
  assert.equal(result.cards[0].image, 'https://images.ygoprodeck.com/images/cards_small/89631139.jpg');
});
