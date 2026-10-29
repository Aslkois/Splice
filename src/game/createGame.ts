import Phaser from 'phaser';
import { PlayScene } from './PlayScene';

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1b2a31',
    antialias: true,
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: true, touch: false, gamepad: false },
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 1280, height: parent.clientHeight || 720 },
    scene: [PlayScene],
  });
}
