import { gameVectorImageOperation } from "../packages/contracts/src/game-vector";

/** Authored renderer fixture, never supplied to real-model generation. */
export function vectorIllustrationFixture(output = "assets/lantern.svg") {
  return gameVectorImageOperation.parse({ type: "image.vector", output, width: 256, height: 256, shapes: [
    { kind: "ellipse", id: "shadow", cx: 128, cy: 222, rx: 76, ry: 15, fill: { type: "radial", cx: 128, cy: 222, r: 76, stops: [{ offset: 0, color: "#14352f88" }, { offset: 1, color: "#14352f00" }] } },
    { kind: "path", id: "handle", fill: null, stroke: { paint: "#234b43ff", width: 8 }, commands: [{ op: "M", x: 89, y: 78 }, { op: "C", x1: 67, y1: 4, x2: 189, y2: 4, x: 167, y: 78 }], transform: { rotation: -6, pivotX: 128, pivotY: 70 } },
    { kind: "rect", id: "housing", x: 68, y: 61, width: 120, height: 151, radius: 25, fill: { type: "linear", x1: 68, y1: 60, x2: 188, y2: 212, stops: [{ offset: 0, color: "#f3d29aff" }, { offset: .45, color: "#c18b58ff" }, { offset: 1, color: "#744b3aff" }] }, stroke: { paint: "#473e35ff", width: 3 } },
    { kind: "rect", id: "glass", x: 81, y: 78, width: 94, height: 112, radius: 19, fill: { type: "linear", x1: 81, y1: 78, x2: 175, y2: 190, stops: [{ offset: 0, color: "#176963ff" }, { offset: 1, color: "#092e37ff" }] } },
    { kind: "ellipse", id: "glow", cx: 128, cy: 134, rx: 37, ry: 43, fill: { type: "radial", cx: 128, cy: 134, r: 43, stops: [{ offset: 0, color: "#fff0aaff" }, { offset: .45, color: "#f4d571aa" }, { offset: 1, color: "#f4d57100" }] } },
    { kind: "path", id: "leaf", fill: "#a5dc9aff", stroke: { paint: "#d9efacff", width: 2 }, commands: [{ op: "M", x: 128, y: 157 }, { op: "C", x1: 99, y1: 145, x2: 101, y2: 110, x: 143, y: 110 }, { op: "Q", cx: 156, cy: 143, x: 128, y: 157 }, { op: "Z" }] },
    { kind: "path", id: "vein", fill: null, stroke: { paint: "#497f5eff", width: 2 }, commands: [{ op: "M", x: 126, y: 154 }, { op: "Q", cx: 126, cy: 134, x: 143, y: 113 }] },
    { kind: "path", id: "reflection", fill: null, opacity: .65, stroke: { paint: "#f1f4caff", width: 3 }, commands: [{ op: "M", x: 89, y: 108 }, { op: "Q", cx: 86, cy: 85, x: 109, y: 85 }, { op: "M", x: 89, y: 116 }, { op: "L", x: 89, y: 126 }] },
    { kind: "rect", id: "base-light", x: 99, y: 199, width: 58, height: 4, radius: 2, fill: "#e5ba79ff" },
  ] });
}
