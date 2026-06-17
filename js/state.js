// state.js — cross-module mutable UI state.
//
// ES module live bindings are read-only for importers, so the three pieces of
// view state that multiple modules need to *write* (the active list filter, the
// open detail-panel id, and per-section collapse flags) live on this single
// mutable object instead of as module-scoped `let`s. Everyone reads/writes
// `ui.currentFilter`, `ui.detailId`, `ui.sectionState`.

export const ui = {
  currentFilter: 'all',
  detailId: null,
  sectionState: {}, // tracks collapsed state per status section
};
