# Version 8.3 — All-state points + reorderable map layers

- Property points now load with **All states** selected when the map is zoomed to level 5 or closer.
- A specific state filter is no longer required to request property points; the current viewport bbox controls what is loaded.
- The existing 25,000 visible-point safety limit remains in place.
- Added a QGIS-like **Layer order** panel. Use ↑ / ↓ to move Counties, Drawn Areas, Area Labels, County Labels, and Property Points above or below one another.
- Layer order is saved with the project and synchronized in real time.
- Property Points can be moved to the very top when maximum visibility is desired.
- STR Colors remains a county styling toggle, so it is not independently reorderable from Counties.
