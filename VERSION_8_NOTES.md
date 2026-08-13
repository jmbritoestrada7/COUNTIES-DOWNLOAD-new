# V8 – Property Analytics (OH / MO / PA ready)

This version keeps all V7 county-map features and adds a separate Property Analytics workflow.

## New
- Separate **Property File** upload (CSV/XLSX/XLSM) so STR files are not replaced.
- County metrics calculated from property records:
  - Property Count
  - Unique Owners
  - Portfolio Owners (owners with 2+ properties in the uploaded state file)
  - Portfolio Properties
  - Total Acreage
  - Average Acreage
- **Color By** selector now supports STR metrics or Property Analytics metrics.
- Property metric heatmaps support **Automatic ranges** or four editable **Custom thresholds**.
- LAT/LONG property points are displayed when:
  - Property Points layer is enabled
  - one state is selected
  - zoom is 7 or higher
- Point data is requested only for the visible map bounds; the browser does not load the entire state point set on every pan.
- Property uploads are additive by state: loading OH, then MO, then PA preserves the other states. Re-uploading a state replaces that state's old property analytics.
- Existing STR, notes, county activation, drawings, labels, R2 project persistence, and permanent links remain intact.

## Required property columns for V8
For the first Property Analytics release the file must contain:
- STATE
- COUNTY

Recommended:
- LAT / LONG (needed for points)
- ACREAGE
- APN or REF
- owner first / last name
- mailing address / city / state / ZIP

Owner identity is built from name + mailing address when those fields are available.

## OH verification dataset
`OH AUG 2026 ALL OWNERS.csv` should produce approximately:
- 8,435 properties
- 55 counties
- 8,290 unique owners statewide
- 137 portfolio owners statewide
- 282 properties belonging to portfolio owners
- ~239,442.5 total acres

The dashboard's Unique Owner totals are county-level sums, so an owner with properties in multiple counties can appear in more than one county total.

## Recommended workflow
1. Open/duplicate the existing county map project.
2. Upload the existing STR county file using the original Upload control if needed.
3. Upload OH property data using **Property File → Load Properties**.
4. Repeat for MO and PA.
5. Use State filter to select OH / MO / PA.
6. Choose `Color by Property Count`, `Unique Owners`, etc.
7. Zoom to level 7+ with one state selected to see property points.
