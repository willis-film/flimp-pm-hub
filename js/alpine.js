// alpine.js — Alpine.js 3 integration layer.
//
// Alpine is the reactive shell around the app. In this build it does three jobs:
//   1. Owns startup: <body x-data="flimpApp" x-init="boot()"> calls into app.init().
//   2. Exposes the shared `ui` view-state as an Alpine store ($store.ui), so future
//      markup can bind reactively (e.g. x-text="$store.ui.currentFilter") without
//      reaching into module internals.
//   3. Provides the x-data component object used by <body>.
//
// The heavy lifting (the imperative render() and all handlers) is untouched —
// Alpine sits on top, it does not replace the existing rendering pipeline.

import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/module.esm.js';
import { ui } from './state.js';
import { init } from './app.js';

// Register the body component + the ui store before Alpine starts.
document.addEventListener('alpine:init', () => {
  Alpine.store('ui', ui);

  Alpine.data('flimpApp', () => ({
    boot() {
      // Defer one tick so Alpine has finished initializing the DOM tree the
      // imperative render() will populate.
      queueMicrotask(() => init());
    },
  }));
});

window.Alpine = Alpine;
Alpine.start();
