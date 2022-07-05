import { should } from 'micro-should';
// Inject crypto to global name space, so randomBytes can use 'crypto.getRandomValues'
import * as crypto from 'crypto';
global.crypto = crypto;
import * as steg from '../index.js';
import { deepStrictEqual } from 'assert';

class FakeStegImage extends steg.StegImage {
  createCanvas(channels) {
    const imageData = { data: channels };
    // s = imageData;
    const self = this;
    const canvas = {
      getContext() {
        return { getImageData: () => self.imageData };
      },
      toBlob(cb) {
        return cb(new Blob(new Uint8Array(self.imageData)));
      },
    };
    return { canvas, imageData };
  }
  constructor(channels) {
    super(channels);
    // this.imageData = { data: channels };
    // this.canvas = {
    //   getContext: () => {
    //     return {
    //       getImageData: () => this.imageData,
    //     };
    //   },
    //   toBlob: (cb) => cb(new Blob(new Uint8Array(this.imageData))),
    // };
    // for (const n of ['hideBlob', 'hide', 'calcCapacity', 'revealBlob', 'reveal'])
    //   this[n] = steg.StegImage.prototype[n].bind(this);
  }
  // do nothing!
  reset() {}
  clean() {
    this.imageData = new Uint8Array(0);
    this.canvas = undefined;
  }
}

const KEY = new Uint8Array(32).fill(1);

should('calcCapacity', async () => {
  // 4 pixel image
  const img = new FakeStegImage(new Uint8Array(4 * 4));
  // 3 pixel * 3 channel * 1 bits = 9 -> ok
  deepStrictEqual(img.calcCapacity(1), { bits: 9, bytes: 1 });
  deepStrictEqual(img.calcCapacity(2), { bits: 18, bytes: 2 });
  deepStrictEqual(img.calcCapacity(3), { bits: 27, bytes: 3 });
  deepStrictEqual(img.calcCapacity(4), { bits: 36, bytes: 4 });
  deepStrictEqual(img.calcCapacity(5), { bits: 45, bytes: 5 });
  deepStrictEqual(img.calcCapacity(6), { bits: 54, bytes: 6 });
  deepStrictEqual(img.calcCapacity(7), { bits: 63, bytes: 7 });
  deepStrictEqual(img.calcCapacity(8), { bits: 72, bytes: 9 });
});

should('basic hideBlob/revealBlob', async () => {
  const img = new FakeStegImage(new Uint8Array(4 * 4));
  // We can store up to 1 byte here
  // Data to encode
  const DATA = new Uint8Array([0b1010_1010]);
  const hidden = await img.hideBlob(DATA, 1);
  deepStrictEqual(
    img.imageData.data.slice(0, 14),
    new Uint8Array([
      // First 4 items are zero
      0, 0, 0, 0,
      // r=1 g=0 b=1
      1, 0, 1, 0,
      // r=0 g=1 b=0
      0, 1, 0, 0,
      // r=1 g=0 b=RANDOM
      1, 0,
    ])
  );
  deepStrictEqual(await img.revealBlob(), DATA);
});

should('hide/reveal', async () => {
  // 256 pixels
  const img = new FakeStegImage(new Uint8Array(256 * 4));
  const DATA = new Uint8Array([0b1010_1010]);
  const file = new steg.RawFile(DATA, 'a.txt');
  // We can store up to 1 byte here
  // Data to encode
  await img.hide(file, KEY, 1);
  deepStrictEqual(await img.reveal(KEY), file);
});

// Exhaustive tests, because I don't trust myself.
for (let pixels = 0; pixels < 256; pixels++) {
  // all channels are 0
  const pixelData0 = new Uint8Array(4 * pixels);
  // all pixels are 255
  const pixelData1 = new Uint8Array(4 * pixels).fill(255);
  for (let bitsTaken = 1; bitsTaken <= 8; bitsTaken++) {
    // How much bytes we can write here
    const { bytes } = new FakeStegImage(pixelData0).calcCapacity(bitsTaken);
    // 28 -- aes, 10 -- metadata (5+'a.txt'.length)
    const dataSize = bytes - (28 + 10);
    should(`exhaustive(pixels=${pixels}, bitsTaken=${bitsTaken})`, async () => {
      for (let b = 0; b < dataSize; b++) {
        let data0 = new Uint8Array(b);
        let data1 = new Uint8Array(b).fill(255);
        for (const p of [pixelData0, pixelData1]) {
          for (const d of [data0, data1]) {
            const img = new FakeStegImage(p);
            const file = new steg.RawFile(d, 'a.txt');
            await img.hide(file, KEY, bitsTaken);
            deepStrictEqual(await img.reveal(KEY), file, `bytes=${b}`);
            img.clean();
          }
        }
        data0 = new Uint8Array(0);
        data1 = new Uint8Array(0);
      }
    });
  }
}

should.run();
