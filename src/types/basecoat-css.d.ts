// basecoat-css ships untyped JS side-entry modules (tabs, combobox — loaded
// on demand from Base.astro). They self-register behavior as a side effect;
// nothing is meaningfully imported from them.

declare module 'basecoat-css/tabs';
declare module 'basecoat-css/combobox';
