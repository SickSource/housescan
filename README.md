# HouseScan

A phone web app that captures a coloured 3D point cloud of a house while you walk through it. It also builds a measured top-down floor plan and exports for Unreal, Blender, Unity and Godot.

Everything runs on the phone in Chrome. There is nothing to install or compile, and no server-side processing.

## How it works

Chrome on Android exposes ARCore's tracking, per-pixel **depth** and the **camera image** to web pages through WebXR.

About 10 times a second the app samples a grid of depth values. It turns each one into a 3D point using the phone's tracked position and colours it from the camera image. Points are merged into a voxel grid (3 cm by default), so walking past the same wall twice refines it instead of duplicating it.

Once you finish:

- **Noise filter.** Isolated points ("flying pixels" at depth edges) are dropped.
- **Floor plan.**
  - The floor and ceiling are found from the height histogram.
  - A horizontal slice through the walls (1 m above the floor up to just under the ceiling) is projected top-down.
  - The plan is rotated so the walls line up with the axes, then drawn as a blueprint with overall dimensions and a tap-to-measure tool.
- **Export.** PLY or XYZ, optionally aligned so the floor sits at height 0 and the walls are square to the axes.

## Requirements

- Android phone on Google's ARCore list **with Depth API support**. Most mid/high-end phones from the last several years qualify, and no depth sensor is needed.
- **Google Play Services for AR** installed and up to date.
- **Chrome** for Android, current version.
- The page must be served over **https://** or from **http://localhost**, because WebXR refuses plain http.

The demo house and the PLY viewer work in any modern browser, including desktop.

## Running it on your phone

### Option A: GitHub Pages (easiest, gives you a permanent URL)

1. Create a new public repo, e.g. `housescan`, and upload `index.html`, `app.js`, `core.js`, `gl.js` and `floorplan.js`.
2. Open repo **Settings → Pages**, then set Source to "Deploy from a branch", branch `main`, folder `/ (root)`.
3. After a minute, open `https://<your-username>.github.io/housescan/` in Chrome on the phone.
4. Optional: Chrome menu → **Add to Home screen**.

### Option B: Termux on the phone (fully offline)

```bash
pkg install python unzip
termux-setup-storage                     # allow access to Downloads
cd ~ && unzip ~/storage/downloads/housescan.zip
cd housescan && python -m http.server 8080
```

Then open **http://localhost:8080** in Chrome on the same phone. localhost counts as a secure origin, so AR works.

### Option C: from your laptop over USB

Serve the folder on the laptop (`python3 -m http.server 8080`). Connect the phone with USB debugging enabled and open `chrome://inspect/#devices` in desktop Chrome. Add a port-forwarding rule `8080 → localhost:8080`, then open `http://localhost:8080` on the phone.

## Scanning tips

- Use good light. Tracking and depth both need texture.
- Wait for the green **Capturing** status. Moving the phone side to side helps depth start up.
- Walk slowly and sweep each wall from floor to ceiling at 0.5–3 m distance.
- At doorways, turn and look back into the room you just left, so rooms share overlap.
- Glass, mirrors, glossy and plain white walls scan poorly.
- **Tracking drift** grows over long walks. For a big house, finish where you started, or scan floor by floor / wing by wing.
- The last scan is saved automatically on the phone ("Reopen last scan"). Still, export anything you want to keep.

## Getting it into a game engine

| Target | Format | Axes | How |
|---|---|---|---|
| **Unreal Engine 5** | XYZ | Z-up | Enable the **LiDAR Point Cloud** plugin (Edit → Plugins), restart, then drag the `.xyz` into the Content Browser and drop the asset into a level. The plugin reads metres and converts to Unreal units. If the house comes in mirrored, re-export with **Mirror X**. |
| **Blender** | PLY | Z-up | File → Import → Stanford PLY. Points arrive as vertices with a colour attribute. To render them, add a Geometry Nodes *Mesh to Points* node and a material that reads the `Col` attribute. |
| **Unity** | PLY | Y-up | Needs a point-cloud importer package (e.g. Pcx). |
| **Godot / three.js** | PLY | Y-up | Load with a PLY loader / import plugin. |
| **CloudCompare / MeshLab** | PLY | Z-up | Open directly. Both can also turn the cloud into a mesh (Poisson reconstruction). |

Use the **Unreal / Blender / Unity-Godot** preset buttons on the Export tab to set these.

## Settings

| Setting | Effect |
|---|---|
| Point spacing | Voxel size. Smaller is more detail, more memory and a smaller area before the point budget fills. |
| Max points | Point budget. 2 M at 3 cm covers roughly a 6–8 room floor. |
| Max capture distance | Phone depth is most accurate under ~3 m. |
| Samples per frame | Depth samples per frame. Higher fills faster but costs battery and framerate. |
| Depth mode | *Smooth* fills gaps. *Raw* is sharper, with holes. |
| Flip camera colours | Use this if colours look upside-down on your phone. |

## Files

- `index.html`: UI and styles
- `app.js`: AR session, capture loop, 3D viewer, results screens, export
- `core.js`: math, voxel point store, depth-to-3D conversion, floor-plan analysis, PLY/XYZ read/write, demo simulator (no DOM, unit-testable in Node)
- `gl.js`: WebGL point renderer and camera-image downsampler
- `floorplan.js`: blueprint renderer, pan/zoom, measuring, PNG export

## Limits

- No loop closure. ARCore corrects its own pose over time, but points already captured aren't moved, so long scans can show doubled walls.
- Accuracy is about what phone AR depth gives: typically 1–3 cm at 1–2 m, worse further out.
- The floor plan comes from a horizontal slice, so tall furniture (fridges, bookcases) shows up as wall.
