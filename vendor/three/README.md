# Three.js runtime

Vendored from the npm `three@0.185.1` package (MIT; see LICENSE).
These are unmodified upstream files. Import maps in index.html resolve them
locally, including on GitHub Pages under `/pacific-skies/`.

- build/three.module.min.js and build/three.core.min.js → this directory
- examples/jsm/loaders/GLTFLoader.js → addons/loaders/
- examples/jsm/utils/{BufferGeometryUtils,SkeletonUtils}.js → addons/utils/

To update, obtain a pinned official `three` npm package, replace all of these
files together, check loader imports for added dependencies, and run npm test.
No CDN or npm install is required to play the deployed game.
