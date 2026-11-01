// Turn a picked image file into a small square picture (centre-cropped), ready to upload.
export function squareImage(file, size = 192) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose an image file.'));
    if (file.size > 20 * 1024 * 1024) return reject(new Error('That image is too large (over 20 MB).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      // WebP where the browser can make it (smallest), otherwise JPEG.
      let data = canvas.toDataURL('image/webp', 0.86);
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.88);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image couldn’t be opened.')); };
    img.src = url;
  });
}

/** An image file as a data URL no larger than `max` pixels on its longest side (for pasting into notes). */
export function fitImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose an image file.'));
    if (file.size > 25 * 1024 * 1024) return reject(new Error('That image is too large (over 25 MB).'));
    // Small GIFs and SVGs are kept as they are (animation / sharpness).
    if ((file.type === 'image/gif' || file.type === 'image/svg+xml') && file.size < 3 * 1024 * 1024) {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('That image couldn’t be read.'));
      return r.readAsDataURL(file);
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let data = canvas.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image couldn’t be opened.')); };
    img.src = url;
  });
}
