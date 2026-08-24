# Version 8.4 — Market Analytics V1

Adds a first Market Analytics module without changing existing STR or Property Analytics.

## New
- Separate Active and Sold market-file uploads (CSV/XLSX/XLSM).
- Recognizes conventional STATE/COUNTY/ACRES/PRICE columns and the coded Land.com sample format used during development.
- Active inventory behaves as a snapshot: uploading a new active file replaces prior active records for the state(s) represented in that upload.
- Sold data behaves as history: sold records are upserted and retained.
- User-selectable acreage minimum/maximum with instant recalculation.
- County metrics: Active Listings, Sold Listings, Market STR (Sold / Active × 100), Average Active Price, Average Sold Price.
- New Color By options for all five Market Analytics metrics.
- Market Analytics block added to county popups.

## Formula
Market STR = SOLD listings / ACTIVE listings × 100.

## Current scope
This version imports market files manually. It does not scrape or automate third-party portals yet. The data ingestion layer is intentionally separate so an approved API/data connector can be added later without redesigning the map.
