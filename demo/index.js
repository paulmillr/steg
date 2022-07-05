import * as steg from 'steg';
import { scrypt } from '@noble/hashes/scrypt';

function passwordToKey(password) {
  return scrypt(password, 'steg-file', { N: 2 ** 19, r: 8, p: 1 });
}
function el(selector) {
  const e = document.querySelector(selector);
  if (!e) throw new Error('Invalid element');
  return e;
}
function on(selector, event, handler) {
  el(selector).addEventListener(event, handler);
}
const formatSize = steg.utils.formatSize;

function setupEncryption() {
  const cache = { bitsTaken: 1 };
  function labelFor(id) {
    return el(`#steg-encrypt label[for="${id}"] small`);
  }
  function reformat() {
    const si = cache.stegImg;
    const hf = cache.hiddenFile;
    const bt = el('#steg-encrypt-submit-button');
    if (si) el('#steg-encrypt-data-file').disabled = false;
    if (!si || !hf || !cache.key) return (bt.disabled = true);
    if (hf.size > si.calcCapacity(cache.bitsTaken).bytes) return (bt.disabled = true);
    bt.disabled = false;
  }
  on('#steg-encrypt-image', 'change', async (ev) => {
    const img = await steg.RawFile.fromFileInput(ev.target);
    cache.stegImg = await steg.StegImage.fromBytesOrURL(img.data);
    const minSize = formatSize(cache.stegImg.calcCapacity(1).bytes);
    const maxSize = formatSize(cache.stegImg.calcCapacity(8).bytes);
    labelFor(
      'steg-encrypt-image'
    ).innerHTML = `can hide <strong>from ${minSize} to ${maxSize}</strong> of data`;
    ev.target.disabled = true;
    el('#steg-encrypt-data-file').disabled = false;
    reformat();
  });
  on('#steg-encrypt-data-file', 'change', async (ev) => {
    cache.hiddenFile = await steg.RawFile.fromFileInput(ev.target);
    labelFor('steg-encrypt-data-file').innerHTML = `with size of <strong>${formatSize(
      cache.hiddenFile.size
    )}</strong>`;
    el('#steg-encrypt-password').disabled = false;
    reformat();
  });
  on('#steg-encrypt-password', 'change', (ev) => {
    const t = ev.target;
    const l = labelFor('steg-encrypt-password');
    if (t.validity.valid) {
      cache.key = passwordToKey(t.value);
      l.innerHTML = '<strong>set<strong>';
    } else {
      l.innerHTML = 'Invalid password';
    }
    reformat();
  });
  on('#steg-encrypt-bits-taken', 'change', (ev) => {
    const val = Number.parseInt(ev.target.value);
    cache.bitsTaken = val;
    el('#steg-encrypt-bits-taken-value').textContent = val;
    const capacity = cache.stegImg.calcCapacity(val).bytes;
    labelFor('steg-encrypt-bits-taken').innerHTML = `gets capacity of ${formatSize(
      capacity
    )}`;
    reformat();
  });
  on('#steg-encrypt', 'submit', async (ev) => {
    ev.preventDefault();
    if (!(cache.stegImg && cache.hiddenFile && cache.key)) return;
    const url = await cache.stegImg.hide(cache.hiddenFile, cache.key, cache.bitsTaken);
    await steg.utils.setImageSource(el('#steg-encrypt-output'), url);
    const dl = el('#steg-encrypt-download');
    dl.removeAttribute('hidden');
    dl.addEventListener('click', (ev) => {
      ev.preventDefault();
      steg.utils.downloadFile(url);
    });
  });
}
function setupDecryption() {
  const cache = {};
  function labelFor(id) {
    return el(`#steg-decrypt label[for="${id}"] small`);
  }
  on('#steg-decrypt-file', 'change', async (ev) => {
    const image = await steg.RawFile.fromFileInput(ev.target);
    const simg = await steg.StegImage.fromBytesOrURL(image.data);
    const l = labelFor('steg-decrypt-file');
    try {
      const bitsTaken = simg.revealBitsTaken();
      const cap = simg.calcCapacity(bitsTaken);
      l.innerHTML = `amidst max size of <strong>${formatSize(cap.bytes)}</strong>`;
      cache.simg = simg;
    } catch (error) {
      l.innerHTML = 'Incorrect bitsTaken header: probably not a steg png';
    }
  });
  on('#steg-decrypt-password', 'change', (ev) => {
    const t = ev.target;
    const l = labelFor('steg-decrypt-password');
    const input = el('#steg-decrypt-submit');
    if (t.validity.valid) {
      cache.key = passwordToKey(t.value);
      l.innerHTML = '<strong>set<strong>';
      input.disabled = false;
    } else {
      l.innerHTML = 'Invalid password';
      input.disabled = true;
    }
  });
  on('#steg-decrypt', 'submit', async (ev) => {
    ev.preventDefault();
    if (!cache.key || !cache.simg) return;
    const status = el('#steg-decrypt-status');
    const cont = el('#steg-decrypt-output-container');
    let revealed;
    try {
      revealed = await cache.simg.reveal(cache.key);
    } catch (error) {
      cont.hidden = true;
      status.textContent = `Decryption error, probably invalid password: ${error.message}`;
      return;
    }
    cont.hidden = false;
    status.textContent = 'Successfully decrypted';
    el('#steg-decrypt-output-metadata').innerHTML = `hidden file <strong>${
      revealed.name
    }</strong> with size of <strong>${formatSize(revealed.size)}</strong> (${
      revealed.size
    }B)`;
    el('#steg-decrypt-download').addEventListener('click', (ev) => {
      ev.preventDefault();
      revealed.download();
    });
  });
}

function onDocumentReady() {
  function listen() {
    setupEncryption();
    setupDecryption();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', listen);
  } else {
    listen();
  }
}

onDocumentReady();
