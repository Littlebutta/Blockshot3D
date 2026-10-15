// v1.2.4: shared geometry for character and unit models. Every model used to build its own boxes, spheres and
// cylinders, so each spawn (critters, raiders, drones arriving mid-fight) made dozens of new GPU buffers, and each
// death left them for the garbage collector. Geometries with the same shape are now built once and shared; the
// few that get bent or moved after creation still use new THREE.*Geometry directly. Never dispose these.
import * as THREE from '/vendor/three/build/three.module.js';
const cache = new Map();
const MAX = 6000;   // shapes with random sizes would otherwise grow the cache forever
export const GEO = new Proxy({}, {
  get(_, kind) {
    return (...args) => {
      const key = kind + '|' + args.join(',');
      let g = cache.get(key);
      if (!g) { g = new THREE[kind + 'Geometry'](...args); g.userData.keep = true; if (cache.size < MAX) cache.set(key, g); }
      return g;
    };
  },
});
