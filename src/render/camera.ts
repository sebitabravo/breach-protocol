/**
 * Camera rig: the menu orbit and the first-person pose (eye height, recoil,
 * grounded bob and roll). The rig only moves the camera; it never reads the
 * simulation directly, so it can be driven from plain numbers in tests.
 */
import * as THREE from 'three';
/** Dueño único: src/core/constants.ts replica core/src/player.rs (drift test).
 * La snapshot trae el y de los PIES del jugador (core/src/sim.rs escribe
 * `player.pos.y`); la cámara en primera persona necesita el ojo, así que el
 * renderer lo levanta por PLAYER.eyeHeight. */
import { PLAYER } from '../core/constants';
import type { Pose } from './interp';

const ORBIT_RADIUS = 13.4;
const ORBIT_HEIGHT = 3.6;
const ORBIT_SPEED = 0.085;
/** Derivada del dueño único (src/core/constants.ts). */
export const EYE_HEIGHT = PLAYER.eyeHeight;
const BOB_AMPLITUDE = 0.035;

/** Subset of the snapshot the first-person pose needs. */
export interface ViewInput {
  grounded: boolean;
  speed: number;
  recoilPitch: number;
  recoilYaw: number;
}

export class CameraRig {
  private orbitAngle = 1.11;
  private bobPhase = 0;
  private bobAmp = 0;

  /** Menu/loading camera: slow orbit over the arena. */
  orbit(camera: THREE.PerspectiveCamera, dt: number): void {
    this.orbitAngle += dt * ORBIT_SPEED;
    const angle = 1.45 - 0.22 * Math.sin(this.orbitAngle);
    camera.position.set(Math.cos(angle) * ORBIT_RADIUS, ORBIT_HEIGHT, Math.sin(angle) * ORBIT_RADIUS);
    camera.lookAt(0, 2.05, 0);
    camera.updateMatrixWorld();
  }

  /**
   * Places the camera at the interpolated pose plus recoil and grounded bob.
   * Returns the vertical bob offset so the viewmodel can follow it.
   */
  firstPerson(
    camera: THREE.PerspectiveCamera,
    pose: Pose,
    view: ViewInput,
    dt: number,
    reducedMotion: boolean,
  ): number {
    let bobY = 0;
    let roll = 0;
    if (!reducedMotion && view.grounded) {
      const target = Math.min(Math.max(view.speed / 6, 0), 1);
      this.bobAmp += (target - this.bobAmp) * Math.min(dt * 8, 1);
      this.bobPhase += dt * (4 + view.speed * 1.6);
      bobY = Math.sin(this.bobPhase) * BOB_AMPLITUDE * this.bobAmp;
      roll = Math.sin(this.bobPhase * 0.5) * 0.008 * this.bobAmp;
    } else {
      this.bobAmp += (0 - this.bobAmp) * Math.min(dt * 8, 1);
    }
    camera.position.set(pose.px, pose.py + EYE_HEIGHT + bobY, pose.pz);
    camera.rotation.set(pose.pitch + view.recoilPitch, pose.yaw + view.recoilYaw, roll);
    camera.updateMatrixWorld();
    return bobY;
  }
}
