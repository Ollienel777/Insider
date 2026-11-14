#!/usr/bin/env node
// Renders the map screen's static basemaps (SPEC §2 beat 1, DESIGN.md "Map")
// from OpenStreetMap data, so the map needs no tile server and carries no
// proprietary imagery. The data is © OpenStreetMap contributors, under the
// ODbL (https://www.openstreetmap.org/copyright); the map screen shows that
// attribution on every basemap.
//
//   node scripts/basemap/render.mjs            every city in basemaps.json
//   node scripts/basemap/render.mjs LA         one city
//
// It asks the public Overpass API for the roads, water and parks inside each
// city's bounds (src/components/map/basemaps.json, which the app projects
// pins with), draws them with Web Mercator onto a canvas in Playwright's
// Chromium, in DESIGN.md's neutral tones, and writes public/basemaps/*.webp.
// Run it by hand when the bounds change; the app and the gate never run it.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(path.join(root, "src/components/map/basemaps.json"), "utf8"));
const OVERPASS = "https://overpass-api.de/api/interpreter";

// DESIGN.md's slate neutrals, kept within --n-950..--n-600 so the map sits
// behind the pins ("desaturated to --n-800 tones").
const INK = {
  ground: "#07090c", // --n-950, the board backdrop
  park: "#0b1110",
  water: "#0b1119",
  building: "#0e1218",
  minor: "#151a22",
  street: "#1b222c",
  major: "#232b37", // --n-700
  motorway: "#2c3542",
};

const ROADS = {
  street: {
    motorway: ["motorway", 9], trunk: ["motorway", 8], primary: ["major", 6], secondary: ["major", 5],
    tertiary: ["street", 4], residential: ["street", 3], unclassified: ["street", 3], living_street: ["minor", 2],
    service: ["minor", 1.5], pedestrian: ["minor", 2], motorway_link: ["major", 4], trunk_link: ["major", 4],
    primary_link: ["major", 3], secondary_link: ["street", 3],
  },
  metro: {
    motorway: ["motorway", 5], trunk: ["motorway", 4], primary: ["major", 2.5], secondary: ["street", 1.8],
    tertiary: ["minor", 1.2], motorway_link: ["major", 1.5], trunk_link: ["major", 1.5],
  },
};

function query({ south, west, north, east }, detail) {
  const bbox = `${south},${west},${north},${east}`;
  const highways = Object.keys(ROADS[detail]).join("|");
  return `[out:json][timeout:180];
(
  way["highway"~"^(${highways})$"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["waterway"~"^(river|canal|stream)$"](${bbox});
  way["leisure"~"^(park|golf_course)$"](${bbox});
  ${detail === "street" ? `way["building"](${bbox});` : ""}
);
out geom;`;
}

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function projector({ bounds, width, height }) {
  const top = mercY(bounds.north);
  const span = top - mercY(bounds.south);
  return ([lng, lat]) => [
    ((lng - bounds.west) / (bounds.east - bounds.west)) * width,
    ((top - mercY(lat)) / span) * height,
  ];
}

/** Overpass elements → draw commands, each a list of pixel paths with a style. */
function commands(elements, city) {
  const project = projector(city);
  const roads = ROADS[city.detail];
  const scale = city.width / 2080;
  const layers = { park: [], water: [], building: [], waterway: [], roads: [] };
  const line = (geometry) => geometry.map((p) => project([p.lon, p.lat]).map((v) => Math.round(v * 10) / 10));

  for (const el of elements) {
    const tags = el.tags ?? {};
    const rings =
      el.type === "way"
        ? [el.geometry ?? []]
        : (el.members ?? []).filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry);
    if (tags.highway && roads[tags.highway]) {
      const [ink, w] = roads[tags.highway];
      layers.roads.push({ ink, width: w * scale, rank: w, path: line(rings[0]) });
    } else if (tags.waterway) {
      layers.waterway.push({ ink: "water", width: (tags.waterway === "stream" ? 2 : 6) * scale, path: line(rings[0]) });
    } else if (tags.natural === "water") {
      for (const ring of rings) layers.water.push({ ink: "water", path: line(ring) });
    } else if (tags.leisure) {
      layers.park.push({ ink: "park", path: line(rings[0]) });
    } else if (tags.building) {
      layers.building.push({ ink: "building", path: line(rings[0]) });
    }
  }
  layers.roads.sort((a, b) => a.rank - b.rank);
  return layers;
}

async function fetchOsm(city) {
  const body = new URLSearchParams({ data: query(city.bounds, city.detail) });
  const response = await fetch(OVERPASS, {
    method: "POST",
    body,
    headers: { "User-Agent": "basemap-render/1.0" },
  });
  if (!response.ok) throw new Error(`Overpass answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).elements;
}

async function draw(page, city, layers) {
  return page.evaluate(
    ({ width, height, layers, INK }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = INK.ground;
      ctx.fillRect(0, 0, width, height);
      const trace = (path, close) => {
        ctx.beginPath();
        path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (close) ctx.closePath();
      };
      for (const key of ["park", "water", "building"]) {
        for (const shape of layers[key]) {
          ctx.fillStyle = INK[shape.ink];
          trace(shape.path, true);
          ctx.fill();
        }
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const key of ["waterway", "roads"]) {
        for (const stroke of layers[key]) {
          ctx.strokeStyle = INK[stroke.ink];
          ctx.lineWidth = stroke.width;
          trace(stroke.path, false);
          ctx.stroke();
        }
      }
      return canvas.toDataURL("image/webp", 0.82);
    },
    { width: city.width, height: city.height, layers, INK },
  );
}

const wanted = process.argv.slice(2);
const cities = Object.entries(config).filter(([name]) => wanted.length === 0 || wanted.includes(name));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name, city] of cities) {
    const elements = await fetchOsm(city);
    const url = await draw(page, city, commands(elements, city));
    const out = path.join(root, "public", city.file);
    writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
    console.log(`${name}: ${elements.length} OSM elements → ${path.relative(root, out)}`);
  }
} finally {
  await browser.close();
}
