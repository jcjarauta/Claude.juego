import * as Phaser from "phaser";

// Marcadores del mapa (G3c, P2): anillo sobre el destino del objetivo, flecha en el borde cuando queda fuera de la vista,
// cámara que solo se desplaza si la persona lo pide y control de superposición de etiquetas.
// El marcador es una ayuda visual; la alternativa textual (dirección y distancia) está en la zona C y en la Guía.

export interface MapTarget {
  x: number;
  y: number;
  label: string;
}

export const reducedMotion = () => document.documentElement.dataset.movimiento === "reducido";

const EDGE = 26;

/** Destello corto de celebración sobre el personaje (anillo que crece y se desvanece); con «menos movimiento» no se dibuja. */
export function createFlash(scene: Phaser.Scene, tile: number) {
  const g = scene.add.graphics().setDepth(55).setVisible(false);
  let plays = 0;
  return {
    /** Veces que se ha lanzado un destello (las pruebas lo leen). */
    get plays() { return plays; },
    play(x: number, y: number) {
      if (reducedMotion()) return;
      plays++;
      g.clear().lineStyle(6, 0x000000, 0.9).strokeCircle(0, 0, tile / 2 + 2).lineStyle(3, 0xffffff, 1).strokeCircle(0, 0, tile / 2 + 2);
      g.setPosition(x, y).setScale(0.6).setAlpha(1).setVisible(true);
      scene.tweens.add({ targets: g, scale: 2.2, alpha: 0, duration: 600, ease: "Sine.easeOut", onComplete: () => g.setVisible(false) });
    },
  };
}

export function createTargetMarker(scene: Phaser.Scene, tile: number) {
  const ring = scene.add.graphics().setDepth(50).setVisible(false);
  const arrow = scene.add.graphics().setDepth(60).setScrollFactor(0).setVisible(false);
  let target: MapTarget | undefined;
  let tween: Phaser.Tweens.Tween | undefined;

  const center = (cell: number) => cell * tile + tile / 2;

  function drawRing() {
    ring.clear();
    // Doble contorno (oscuro y claro) para que se vea sobre cualquier fondo; no depende del color.
    ring.lineStyle(6, 0x000000, 0.9).strokeCircle(0, 0, tile / 2 + 4);
    ring.lineStyle(3, 0xffffff, 1).strokeCircle(0, 0, tile / 2 + 4);
  }

  function restartPulse() {
    tween?.remove();
    tween = undefined;
    ring.setScale(1);
    // Con «menos movimiento» el anillo queda fijo.
    if (!reducedMotion() && target) tween = scene.tweens.add({ targets: ring, scale: 1.25, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  return {
    get target() { return target; },
    setTarget(next: MapTarget | undefined) {
      if (target && next && target.x === next.x && target.y === next.y) { target = next; return; }
      target = next;
      if (!next) { ring.setVisible(false); arrow.setVisible(false); tween?.remove(); tween = undefined; return; }
      drawRing();
      ring.setPosition(center(next.x), center(next.y)).setVisible(true);
      restartPulse();
    },
    /** Se llama al cambiar la preferencia de movimiento. */
    refreshMotion: restartPulse,
    /** Cada fotograma: la flecha del borde si el destino queda fuera de la vista. */
    update(cam: Phaser.Cameras.Scene2D.Camera) {
      if (!target) return;
      const tx = center(target.x);
      const ty = center(target.y);
      const view = cam.worldView;
      if (tx >= view.x && tx <= view.right && ty >= view.y && ty <= view.bottom) { arrow.setVisible(false); return; }
      const cx = view.centerX;
      const cy = view.centerY;
      const dx = tx - cx;
      const dy = ty - cy;
      const halfW = view.width / 2 - EDGE;
      const halfH = view.height / 2 - EDGE;
      const k = Math.min(halfW / Math.max(Math.abs(dx), 1e-6), halfH / Math.max(Math.abs(dy), 1e-6));
      const sx = (cam.width / 2) + dx * k;
      const sy = (cam.height / 2) + dy * k;
      arrow.clear();
      arrow.setPosition(sx, sy).setRotation(Math.atan2(dy, dx) + Math.PI / 2).setVisible(true);
      arrow.fillStyle(0xffffff, 1).lineStyle(3, 0x000000, 1);
      arrow.fillTriangle(0, -14, -11, 10, 11, 10).strokeTriangle(0, -14, -11, 10, 11, 10);
    },
  };
}
