/* Paste into the browser console or load via <script> to populate test data. */
(() => {
  const items = [
    { id: 'milk',    name: 'Milk',    category: 'Dairy',  stock: 0, lowAt: 1, tracked: true, onList: false, checked: false, listQty: 1, unit: 'gal', prices: [] },
    { id: 'eggs',    name: 'Eggs',    category: 'Dairy',  stock: 2, lowAt: 3, tracked: true, onList: false, checked: false, listQty: 1, unit: 'doz', prices: [] },
    { id: 'butter',  name: 'Butter',  category: 'Dairy',  stock: 1, lowAt: 1, tracked: true, onList: false, checked: false, listQty: 1, unit: '',    prices: [] },
    { id: 'bread',   name: 'Bread',   category: 'Bakery', stock: 0, lowAt: 1, tracked: true, onList: false, checked: false, listQty: 1, unit: '',    prices: [] },
    { id: 'chicken', name: 'Chicken', category: 'Meat',   stock: 0, lowAt: 1, tracked: true, onList: false, checked: false, listQty: 2, unit: 'lb',  prices: [] },
    { id: 'rice',    name: 'Rice',    category: 'Pantry', stock: 3, lowAt: 2, tracked: true, onList: false, checked: false, listQty: 1, unit: 'bag', prices: [] },
    { id: 'onions',  name: 'Onions',  category: 'Produce',stock: 0, lowAt: 2, tracked: true, onList: false, checked: false, listQty: 3, unit: '',    prices: [] },
  ];

  const meals = [
    { id: 'meal-breakfast', name: 'Breakfast',     itemIds: ['milk', 'eggs', 'bread', 'butter'] },
    { id: 'meal-stirfry',   name: 'Chicken Stir Fry', itemIds: ['chicken', 'rice', 'onions'] },
  ];

  state.items = items;
  state.meals = meals;
  render();
  console.log(`Seeded ${items.length} items, ${meals.length} meals`);
})();
