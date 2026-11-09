# Vehicle cover photos

RoadFit serves real vehicle photographs sourced from Wikimedia Commons. The
[CarImages rights index](https://carimages.org/data/) provides candidate file
names, classifications, and rights metadata in a CC0 compilation. Targeted
searches through the Wikimedia Commons API can supply additional candidates.
Each file has its own license. See the
[Wikimedia Commons reuse guide](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).

## Matching and presentation

The importer checks an explicit year and make/model label against the U.S.
catalog. For CarImages entries, the archive classification and Commons filename
must agree. For targeted Commons results, the title and description must both
identify the vehicle. Rules screen out ambiguous market names and known
non-exterior subjects such as interiors, illustrations, replicas, and details.
The importer uses body style when available and prefers exterior front views.

- **Model year photo** means the photo metadata matches the model year and
  model. Trim and regional details can vary.
- **Same generation** means the pictured year and requested model year fall
  within a sourced U.S. model-year interval in
  [`pipeline/photo-generations.json`](../pipeline/photo-generations.json).
  The interface displays the pictured year. This is a representative photo of
  the generation, with potential differences in trim, equipment, and styling.
- A branded placeholder appears when a match or image file is unavailable.

The browser reads `public/data/vehicle-images.json` separately from the vehicle
catalog. That file maps EPA configuration IDs to photo metadata, so a single
photo can serve multiple eligible configurations. WebP copies under
`public/assets/vehicles/` are hosted with the site. Users can open the photo
credit from a card and see the source file, creator, license, and display
changes in the vehicle detail caption.

## Refresh locally

The published app serves the checked-in photos. To regenerate them, run these
commands from the repository root with Python 3.10 or newer and a generated
catalog in `public/data/`.

```bash
python -m pip install Pillow
python scripts/data/build_vehicle_photos.py --plan
python scripts/data/build_vehicle_photos.py
python scripts/data/build_vehicle_photos.py --validate
```

`--plan` calculates candidate coverage without downloading photo files or
updating the published index. The first run downloads the rights metadata to
`pipeline/cache/carimages-rights.csv`. Use `--refresh-rights` to fetch a newer
rights manifest. Use `--rights path/to/snapshot.csv` to reproduce a build from a
local snapshot. Existing optimized files are reused. When a refresh produces a
substantial coverage drop, the importer preserves the previous index.
The monthly **Refresh vehicle cover photos** workflow checks for newer files
and publishes a new index after validation. Failed refreshes preserve the last
published site.

To collect additional Commons candidates, provide a CSV with `year`, `make`,
and `model` columns, then pass the output to the builder. The source search
caches successful requests and accepts `--limit` for smaller passes.

```bash
python scripts/data/fetch_commons_vehicle_photos.py --targets targets.csv --output pipeline/cache/commons-vehicle-photos.csv
python scripts/data/build_vehicle_photos.py --additional pipeline/cache/commons-vehicle-photos.csv --plan
python scripts/data/build_vehicle_photos.py --additional pipeline/cache/commons-vehicle-photos.csv
```

`--additional` can also read a reviewed CSV with Commons `source_page_url`,
`source_url`, `source_filename`, `license_name`, `license_url`, `creator_name`,
`width`, and `height` fields. A manually verified exterior uses `match_make`,
`match_model`, `depicted_year`, `verified_exterior`, and an optional `body_hint`.
Use that path for photos with independent evidence of the pictured model year
and body, especially where U.S. and overseas versions share a nameplate.

Retain the photo index when redistributing the optimized assets. Use each
photo's own license and credit, including ShareAlike where applicable.
