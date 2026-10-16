# JSBSim, compiled to WebAssembly

`jsbsim_wasm.wasm` and `jsbsim_wasm.mjs` are **not** part of this project's own
source. They are a build of [JSBSim](https://github.com/JSBSim-Team/jsbsim), the
flight dynamics library, and are covered by the **GNU Lesser General Public
Licence, version 2.1** — see <https://www.gnu.org/licenses/lgpl-2.1.html>.

They are copied out of `node_modules/@0x62/jsbsim-wasm` at build time by
`scripts/sync-wasm.mjs` and are therefore not committed to this repository.

The files are loaded at runtime by URL, never bundled into the application's
JavaScript, precisely so that they can be replaced: put a different build of
JSBSim at these paths and the simulator will use it. That is the freedom the
LGPL asks for, and this layout is how it is provided.

Everything else under `public/fdm` — the aircraft and engine definitions — is
this project's own work under the MIT licence, written against published
performance figures rather than adapted from any existing flight model.
