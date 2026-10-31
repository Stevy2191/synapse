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
