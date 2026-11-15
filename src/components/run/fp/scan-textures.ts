// The set's surface textures (issue 118): CC0 sets from ambientCG, in
// public/textures (CREDITS.md), loaded once per tab and shared. Each is used
// for its detail only (brightness over its own average), tinted by the colour
// each room's photographs give, so the rooms keep their own colours.
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from "three";

const cache = new Map<string, Texture>();

function load(file: string, colour: boolean): Texture {
  const known = cache.get(file);
  if (known) return known;
  const texture = new TextureLoader().load(`/textures/${file}`);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  cache.set(file, texture);
  return texture;
}

export const SET_TEXTURES = {
  carpet: () => load("carpet.jpg", false),
  carpetNormal: () => load("carpet-normal.jpg", false),
  woodFloor: () => load("wood-floor.jpg", false),
  tile: () => load("tile.jpg", false),
  ceiling: () => load("ceiling.jpg", false),
  plaster: () => load("plaster.jpg", false),
  /** The doors' veneer, drawn as it is (in colour, under the door's tint). */
  doorWood: () => load("door-wood.jpg", true),
};
